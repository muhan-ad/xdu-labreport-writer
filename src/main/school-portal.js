'use strict';
const path = require('path');
const atomic = require('./atomic-store');
const { pathToFileURL } = require('url');
const { trustedSender } = require('./security');
const { createCredentialClipboard } = require('./credential-clipboard');
const { autofillScript } = require('./school-autofill');
const { SYSTEMS, getSystem, allowedUrl, allowedRequest, systemForUrl, blockedTarget } = require('./school-systems');

const SCHOOL_URL = 'http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu';
const PARTITION = 'school-portal'; // 无 persist: 前缀，登录状态不落盘。
const TOOLBAR_HEIGHT = 120;

function createSchoolPortal({ electron, root, getParent, credentials, credentialClipboard, preferencesFile, log = () => {} }) {
  const { BrowserWindow, WebContentsView, session, dialog, ipcMain, clipboard, ClipboardItem } = electron;
  const secretClipboard = credentialClipboard || createCredentialClipboard({ clipboard, ClipboardItem });
  const toolbarUrl = pathToFileURL(path.join(root, 'src/school-portal.html')).href;
  let win = null, view = null, opening = null, clearing = false, managing = false, credentialBusy = false, revision = 0;
  let selectedSystem = getSystem(), loadSequence = 0, settingsOpen = false, dropdownOpen = false, autoTimer = null, autoFilledRevision = -1;
  let embedded=false,embeddedVisible=true,embeddedBounds=null,toolbarView=null,disposeWindow=null;
  const controls=()=>toolbarView?.webContents||win?.webContents;
  let autoFillEnabled = true;
  try { if (preferencesFile) autoFillEnabled = atomic.readJson(preferencesFile, {}).autoFillEnabled !== false; } catch (_) { /* Default on, no credentials in preferences. */ }
  function scheduleAutoFill(attempt = 0) {
    clearTimeout(autoTimer);
    if (!autoFillEnabled || !live() || attempt > 3) return;
    const expectedRevision = revision, expectedWindow = win;
    autoTimer = setTimeout(async () => {
      if (!autoFillEnabled || !live() || win !== expectedWindow || revision !== expectedRevision || autoFilledRevision === revision) return;
      if (clearing || credentialBusy || managing || settingsOpen || dropdownOpen || state.loading || state.error) return;
      const status = await credentials.status(selectedSystem.id).catch(() => null);
      if (!status?.configured || !status.available || !live() || win !== expectedWindow || revision !== expectedRevision || !autoFillEnabled) return;
      const result = await credentialAction('autofill', { automatic: true });
      if (result.ok) { autoFilledRevision = expectedRevision; if (result.message) controls().send('school-portal-notice', result.message); }
      else if (attempt < 3 && revision === expectedRevision) scheduleAutoFill(attempt + 1);
      else if (live() && win === expectedWindow) controls().send('school-portal-notice', result.error);
    }, attempt ? 900 : 150);
    autoTimer.unref?.();
  }
  const popups = new Set(), ownedContents = new Set();
  let state = { loading: false, canBack: false, secure: false, error: '' };

  const live = () => !!(win && !win.isDestroyed() && view && !view.webContents.isDestroyed());
  function publish() {
    if (!live()) return;
    const contents = view.webContents;
    state.canBack = contents.navigationHistory.canGoBack();
    state.secure = contents.getURL().startsWith('https:');
    toolbarView?.setVisible(embeddedVisible);
    view.setVisible(embeddedVisible && !state.error && !managing && !settingsOpen && !dropdownOpen);
    if (!controls().isDestroyed()) controls().send('school-portal-state', {
      ...state, embedded, clearing, managing, autoFillEnabled, systemId: selectedSystem.id, systems: (embedded?SYSTEMS.filter(s=>s.id==='report'):SYSTEMS).map(({ id, name, url }) => ({ id, name, url })),
      domain: new URL(contents.getURL() || selectedSystem.url).hostname || new URL(selectedSystem.url).hostname, busy: clearing || credentialBusy });
  }
  function fail(message) { state.error = message; state.loading = false; publish(); }
  function blocked(url) {
    const target = blockedTarget(url);
    log(`学校系统阻止访问 [${selectedSystem.id}] ${target}`);
    if (live()) controls().send('school-portal-blocked', target);
  }
  function load(url) {
    if (!live() || clearing || !allowedUrl(url)) return;
    const sequence = ++loadSequence; revision++;
    state.error = ''; state.loading = true; publish();
    const contents = view.webContents;
    contents.loadURL(url).catch(error => {
      if (error.code !== 'ERR_ABORTED' && sequence === loadSequence && live() && view.webContents === contents)
        fail('网站暂时无法连接。请检查网络或校园网连接，稍后点击刷新。');
    });
  }
  function resize() {
    if (!live()) return;
    const [width, height] = win.getContentSize();
    if(embedded){
      const b=embeddedBounds||{x:0,y:44,width,height:height-44};
      const x=Math.max(0,Math.min(width,Math.round(b.x))),y=Math.max(0,Math.min(height,Math.round(b.y)));
      const w=Math.max(0,Math.min(width-x,Math.round(b.width))),h=Math.max(0,Math.min(height-y,Math.round(b.height)));
      toolbarView.setBounds({x,y,width:w,height:h});
      view.setBounds({x,y:y+Math.min(76,h),width:w,height:Math.max(0,h-76)});
    }else view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }
  function createWindow(host=null,bounds=null) {
    embedded=!!host;embeddedVisible=true;embeddedBounds=bounds;
    const schoolSession = session.fromPartition(PARTITION);
    schoolSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    schoolSession.setPermissionCheckHandler(() => false);
    // 网页请求也受白名单约束，阻止访问本机、应用协议和其他站点。
    schoolSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowedRequest(details) });
    });
    win = host || new BrowserWindow({ width: 1100, height: 800, minWidth: 820, minHeight: 600,
      title: '学校实验系统 · 实验搭子', titleBarStyle:'hidden', titleBarOverlay:{color:'#fafaf9',symbolColor:'#273326',height:44}, parent: getParent() || undefined, autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { preload: path.join(root, 'src/school-portal-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const currentWindow = win;
    if(embedded){
      toolbarView=new WebContentsView({webPreferences:{preload:path.join(root,'src/school-portal-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      win.contentView.addChildView(toolbarView);
    }
    const currentToolbar=toolbarView;
    view = new WebContentsView({ webPreferences: { session: schoolSession,
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false },
    });
    const contents = view.webContents;
    ownedContents.add(contents);
    const active = () => live() && win === currentWindow;
    win.contentView.addChildView(view);
    resize();
    win.on('resize', resize);
    const cleanup=()=>{
      for(const popup of popups)if(!popup.isDestroyed())popup.close();
      ownedContents.delete(contents);
      if(!currentWindow.isDestroyed()){
        currentWindow.contentView.removeChildView?.(currentView);
        if(currentToolbar)currentWindow.contentView.removeChildView?.(currentToolbar);
      }
      if(!contents.isDestroyed())contents.close({waitForBeforeUnload:false});
      if(currentToolbar&&!currentToolbar.webContents.isDestroyed())currentToolbar.webContents.close({waitForBeforeUnload:false});
      currentWindow.removeListener('resize',resize);currentWindow.removeListener('closed',cleanup);
      if(win===currentWindow){win=null;view=null;toolbarView=null;embedded=false;embeddedBounds=null;clearing=false;managing=false;credentialBusy=false;disposeWindow=null;}
      clearTimeout(autoTimer);settingsOpen=false;dropdownOpen=false;
      secretClipboard.clearOwned().catch(()=>{});
    };
    const currentView=view;disposeWindow=cleanup;
    win.on('closed',cleanup);
    controls().on('will-navigate',event=>event.preventDefault());
    controls().setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('will-frame-navigate', event => {
      if (!active()) return;
      if (!allowedUrl(event.url) && !(event.url === 'about:blank' && !event.isMainFrame)) {
        event.preventDefault();
        // 不隐藏当前页面，以免非主框架的广告或外链请求打断填写。
        blocked(event.url);
      }
    });
    contents.on('will-redirect', event => {
      if (!active()) return;
      if (!allowedUrl(event.url)) {
        event.preventDefault();
        blocked(event.url);
        if (event.isMainFrame) fail('网站跳转到未允许的地址，已阻止。请联系开发者核对登录跳转地址。');
      }
    });
    function guardPopup(popup) {
      const remote = popup.webContents; popups.add(popup); ownedContents.add(remote);
      remote.on('will-frame-navigate', event => { if (!allowedUrl(event.url) && event.url !== 'about:blank') { event.preventDefault(); blocked(event.url); } });
      remote.on('will-redirect', event => { if (!allowedUrl(event.url)) { event.preventDefault(); blocked(event.url); } });
      remote.on('will-attach-webview', event => event.preventDefault());
      remote.setWindowOpenHandler(popupHandler);
      remote.on('did-create-window', guardPopup);
      popup.on('closed', () => { popups.delete(popup); ownedContents.delete(remote); });
    }
    function popupHandler({ url }) {
      if (!active()) return { action: 'deny' };
      if (!allowedUrl(url) && url !== 'about:blank') { blocked(url); return { action: 'deny' }; }
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true,
        webPreferences: { session: schoolSession, contextIsolation: true, nodeIntegration: false, sandbox: true,
          webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } } };
    }
    contents.setWindowOpenHandler(popupHandler);
    contents.on('did-create-window', guardPopup);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-navigation', event => {
      if (active()) revision++;
      if (active() && event.isMainFrame && !event.isInPlace) { state.error = ''; state.loading = true; publish(); }
    });
    contents.on('did-start-loading', () => { if (active()) { state.loading = true; publish(); } });
    contents.on('did-stop-loading', () => { if (active()) { state.loading = false; publish(); scheduleAutoFill(); } });
    contents.on('did-navigate', (_, url, code) => {
      if (!active()) return;
      if (code >= 400) fail(`网站返回错误（${code}）。请稍后刷新，或确认学校系统是否正常开放。`);
      else { const system = systemForUrl(url); if (system) selectedSystem = system; publish(); }
    });
    contents.on('dom-ready', () => { if (active()) scheduleAutoFill(); });
    contents.on('did-frame-finish-load', () => { if (active()) scheduleAutoFill(); });
    contents.on('did-navigate-in-page', () => { if (active()) publish(); });
    contents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
      if (active() && isMainFrame && code !== -3) fail('网站暂时无法连接。请检查网络或校园网连接，稍后点击刷新。');
    });
    contents.on('render-process-gone', () => { if (active()) fail('学校网页暂时停止运行。请关闭此窗口后重新打开。'); });
    // Let Electron's native Save dialog handle school-file downloads; never pick a save location silently.
    schoolSession.removeAllListeners('will-download');
    schoolSession.on('will-download', (event, item, sourceContents) => {
      if (!item || !ownedContents.has(sourceContents) || !allowedUrl(sourceContents.getURL()) ||
          !(allowedUrl(item.getURL()) || item.getURL().startsWith('blob:'))) {
        event.preventDefault(); controls()?.send('school-portal-download-blocked'); return;
      }
      item.setSaveDialogOptions({ title: '保存学校系统文件' });
    });
    return (currentToolbar?currentToolbar.webContents.loadURL(toolbarUrl):currentWindow.loadURL(toolbarUrl)).then(() => { if (active()) load(selectedSystem.url); });
  }

  async function open() {
    if (live()) { if(embedded)win.webContents.send('course-report-select'); if (win.isMinimized()) win.restore(); win.show(); win.focus(); return { ok: true, reused: true }; }
    if (opening) return opening;
    opening = (async () => {
      const parent = getParent();
      if (!parent || parent.isDestroyed()) return { ok: false, error: '主窗口已关闭' };
      state = { loading: false, canBack: false, secure: false, error: '' };
      await createWindow();
      return { ok: true };
    })().catch(error => { close(); return { ok: false, error: error.message }; })
      .finally(() => { opening = null; });
    return opening;
  }

  async function credentialAction(name, payload) {
    const currentWindow = win, contents = view.webContents, currentRevision = revision, systemId = selectedSystem.id;
    const active = () => live() && win === currentWindow;
    const unchanged = () => active() && revision === currentRevision && !contents.isLoading() && !state.error;
    credentialBusy = true; publish();
    try {
      if (name === 'credential-status') return { ok: true, ...await credentials.status(systemId) };
      if (!active()) return {ok:true,cancelled:true};
      if (name === 'save-credentials' && !managing) return {ok:false,error:'请先打开账号密码管理'};
      if (name === 'autofill' && !unchanged()) return {ok:false,error:'请先打开学校登录页面，并等待加载完成'};
      if (!['manage-credentials','save-credentials','delete-credentials','autofill'].includes(name)) return {ok:false,error:'不支持的操作'};
      if (name === 'manage-credentials') {
        const status = await credentials.status(systemId);
        if (!active()) return { ok: true, cancelled: true };
        managing = true; publish(); return { ok: true, ...status };
      }
      if (name === 'save-credentials') return { ok: true, ...await credentials.save(payload, systemId), message: '账号密码已加密保存' };
      if (name === 'delete-credentials') {
        const status = credentials.remove(systemId); await secretClipboard.clearOwned();
        return { ok: true, ...status, message: '已删除本机保存的账号密码' };
      }
      if (name === 'autofill' && !unchanged()) return { ok: false, error: '网页已变化，请重新点击填充' };
      const value = await credentials.get(systemId);
      if (!active()) return { ok: true, cancelled: true };
      if (name === 'autofill') {
        if (!unchanged()) return { ok: false, error: '网页已变化，请重新点击填充' };
        let result;
        try {
          if (systemForUrl(contents.getURL())?.id !== systemId) return { ok: false, error: '当前页面不属于所选系统，请返回登录页后再填充' };
          const rootUrl = contents.getURL();
          const frames = contents.mainFrame?.framesInSubtree || [contents];
          const candidates = []; let occupied = false;
          for (const frame of frames) {
            const url = frame.url || frame.getURL?.();
            if (systemForUrl(url)?.id !== systemId) continue;
            const probe = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: autofillScript(url, { username: '', password: '' }, true, rootUrl, !!payload?.automatic) }]);
            if (probe?.occupied) occupied = true;
            if (probe?.ready) candidates.push({ frame, url });
          }
          if (unchanged() && payload?.automatic && occupied && candidates.length === 0) return { ok: true, skipped: true };
          if (!unchanged() || candidates.length !== 1) return { ok: false, error: '无法可靠识别唯一登录框，请等待页面加载完成或手动填写' };
          const { frame, url } = candidates[0];
          if ((frame.url || frame.getURL?.()) !== url) return { ok: false, error: '网页已变化，请重新点击填充' };
          result = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: autofillScript(url, value, false, rootUrl, !!payload?.automatic) }]);
        } catch (_) { return { ok: false, error: '无法识别学校登录框，请手动填写' }; }
        if (payload?.automatic && result?.occupied) return { ok: true, skipped: true };
        return result?.filled === true ? { ok: true, message: '已填充登录框，请自行核对并完成验证码或登录' }
          : { ok: false, error: '无法可靠识别学校登录框，请手动填写' };
      }
      return { ok: false, error: '不支持的操作' };
    } catch (error) {
      const known = ['请输入有效的账号和密码', '系统加密不可用，账号密码未保存', '加密保存失败，原账号配置未更改',
        '系统加密不可用，无法使用已保存账号', '请先在账号密码管理中保存账号和密码', '已保存账号无法解密，请重新保存',
        '学校账号存储无法读取，请重新保存或删除后重试'];
      return { ok: false, error: known.includes(error.message) ? error.message : '账号操作未完成，请重试或重新保存' };
    } finally { if (win === currentWindow) { credentialBusy = false; publish(); } }
  }

  async function action(event, name, payload) {
    if (!live() || !trustedSender(event, controls(), toolbarUrl)) return { ok: false, error: '拒绝不可信的调用来源' };
    if (name === 'state') { publish(); return { ok: true }; }
    if (name === 'dropdown-visibility') {
      if(typeof payload?.open !== 'boolean') return { ok:false, error:'无效的菜单状态' };
      dropdownOpen=payload.open; publish(); if(!dropdownOpen) scheduleAutoFill(); return { ok:true };
    }
    if (clearing || credentialBusy) return { ok: false, error: '正在处理操作，请稍后' };
    if (name === 'open-settings') { settingsOpen = true; publish(); return { ok: true }; }
    if (name === 'close-settings') { settingsOpen = false; publish(); scheduleAutoFill(); return { ok: true }; }
    if (name === 'set-auto-fill') {
      if (typeof payload?.enabled !== 'boolean') return { ok: false, error: '无效的自动填充设置' };
      if (preferencesFile) atomic.writeFile(preferencesFile, JSON.stringify({ autoFillEnabled: payload.enabled }), 'utf8');
      autoFillEnabled = payload.enabled; clearTimeout(autoTimer); autoFilledRevision = -1;
      publish(); scheduleAutoFill(); return { ok: true, message: autoFillEnabled ? '已开启自动填充' : '已关闭自动填充' };
    }
    if (name === 'close-credentials') { managing = false; publish(); return { ok: true }; }
    if (['credential-status', 'manage-credentials', 'save-credentials', 'delete-credentials', 'autofill'].includes(name))
      return credentialAction(name, payload);
    if (name === 'switch-system') {
      if (managing || settingsOpen) return { ok: false, error: '请先关闭账号密码管理' };
      let system; try { system = getSystem(payload?.systemId); } catch (_) { return { ok: false, error: '请选择有效的学校系统' }; }
      if(embedded&&system.id!=='report')return {ok:false,error:'请使用学校网站入口打开其他系统'};
      if (!payload?.systemId) return { ok: false, error: '请选择有效的学校系统' };
      if (['simulation', 'exam'].includes(system.id)) {
        credentialBusy = true; publish();
        try {
          await electron.shell.openExternal(system.url);
          return { ok: true, external: true, message: `已在默认浏览器打开${system.name}` };
        } catch (_) { return { ok: false, error: '无法打开默认浏览器，请检查系统默认浏览器设置' }; }
        finally { credentialBusy = false; publish(); }
      }
      for (const popup of popups) if (!popup.isDestroyed()) popup.close();
      credentialBusy = true; publish();
      try { await secretClipboard.clearOwned(); if (!live()) return { ok: true, cancelled: true }; selectedSystem = system; load(system.url); }
      finally { credentialBusy = false; publish(); }
    } else if (name === 'home') load(selectedSystem.url);
    else if (name === 'reload') {
      state.error = ''; state.loading = true; publish();
      const url = view.webContents.getURL();
      if (allowedUrl(url)) view.webContents.reload(); else load(selectedSystem.url);
    } else if (name === 'back') {
      if (view.webContents.navigationHistory.canGoBack()) { state.error = ''; view.webContents.navigationHistory.goBack(); }
    } else if (name === 'clear-login') {
      const currentWindow = win, contents = view.webContents;
      clearing = true; publish();
      try {
        if (!live() || win !== currentWindow) return {ok:true,cancelled:true};
        for (const popup of popups) if (!popup.isDestroyed()) popup.close();
        contents.stop();
        // 先关闭网页，避免页面定时器在清除后重新写入 Cookie 或存储。
        await contents.loadURL('about:blank');
        await contents.session.clearStorageData();
        await contents.session.clearCache();
        await contents.session.closeAllConnections();
        contents.navigationHistory.clear();
      } finally { if (win === currentWindow) { clearing = false; publish(); } }
      if (win === currentWindow) load(selectedSystem.url);
    } else return { ok: false, error: '不支持的操作' };
    publish();
    return { ok: true };
  }
  async function openEmbedded(host,bounds){
    if(live()){
      if(!embedded||win!==host)return {ok:false,error:'学校网站已在独立窗口打开，请先关闭该窗口再进入报告提交'};
      embeddedBounds=bounds;embeddedVisible=true;resize();publish();return {ok:true};
    }
    if(opening)return {ok:false,error:'学校网站正在打开，请稍后重试'};
    selectedSystem=getSystem('report');state={loading:false,canBack:false,secure:false,error:''};
    opening=createWindow(host,bounds).then(()=>({ok:true})).catch(()=>{close();return {ok:false,error:'报告提交页面未能打开，请重试'};}).finally(()=>{opening=null;});
    return opening;
  }
  function updateEmbedded(host,bounds,visible){
    if(!embedded||win!==host||!live())return {ok:true};
    if(bounds)embeddedBounds=bounds;embeddedVisible=visible===true;resize();publish();return {ok:true};
  }
  function close() { if(embedded){disposeWindow?.();}else if (win && !win.isDestroyed()) win.close(); }
  ipcMain.handle('school-portal-action', (event, name, payload) => {
    const currentWindow = win;
    return action(event, name, payload).catch(() => {
      if (win === currentWindow) fail('操作未完成，请关闭窗口后重试。');
      return { ok: false, error: '操作未完成' };
    });
  });
  async function accountSettings(name,payload={}){
    try{
      if(name==='clear-sessions'){
        clearing=true;clearTimeout(autoTimer);
        try{
          if(live()){view.webContents.stop();await view.webContents.loadURL('about:blank');}
          const ses=session.fromPartition(PARTITION);await ses.clearStorageData();await ses.clearCache();await ses.closeAllConnections();
          return {ok:true};
        }finally{clearing=false;}
      }
      const id=payload.systemId||'course';getSystem(id);
      if(name==='status')return {ok:true,...await credentials.status(id),autoFillEnabled,systems:SYSTEMS.map(({id,name})=>({id,name}))};
      if(name==='save'){const result=await credentials.save({username:payload.username,password:payload.password},id);autoFilledRevision=-1;scheduleAutoFill();return {ok:true,...result,message:'账号密码已加密保存'};}
      if(name==='delete'){const result=credentials.remove(id);await secretClipboard.clearOwned();return {ok:true,...result,message:'已删除保存的账号密码'};}
      if(name==='set-auto-fill'){
        if(typeof payload.enabled!=='boolean')return {ok:false,error:'无效的自动填充设置'};
        if(preferencesFile)atomic.writeFile(preferencesFile,JSON.stringify({autoFillEnabled:payload.enabled}),'utf8');
        autoFillEnabled=payload.enabled;clearTimeout(autoTimer);autoFilledRevision=-1;publish();scheduleAutoFill();return {ok:true,autoFillEnabled};
      }
      return {ok:false,error:'不支持的账号管理操作'};
    }catch{return {ok:false,error:'账号配置未能更新，请检查输入或系统加密是否可用'};}
  }
  async function courseLogin() {
    if (!autoFillEnabled) return { enabled: false };
    // Prefer the dedicated course account; report fallback is the same school's explicitly shared login.
    for (const id of ['course', 'report']) {
      const status = await credentials.status(id);
      if (status.corrupt) throw Error('学校账号存储无法读取，请在学校网站的登录设置中重新保存');
      if (status.configured) {
        if (!status.available) throw Error('系统加密不可用，无法使用已保存账号');
        return { enabled: true, credentials: await credentials.get(id), source: id };
      }
    }
    return { enabled: true, credentials: null };
  }
  return { accountSettings, getAutoFillEnabled:()=>autoFillEnabled, open, openEmbedded, updateEmbedded, close, courseLogin, hasOwnedClipboard: secretClipboard.hasOwned, cleanup: secretClipboard.clearOwned };
}

module.exports = { createSchoolPortal, allowedUrl, SCHOOL_URL, SYSTEMS, PARTITION, TOOLBAR_HEIGHT };
