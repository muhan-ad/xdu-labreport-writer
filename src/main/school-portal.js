'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { trustedSender } = require('./security');
const { validateCredentials } = require('./school-credentials');
const { createCredentialClipboard } = require('./credential-clipboard');
const { autofillScript } = require('./school-autofill');
const { SYSTEMS, getSystem, allowedUrl, allowedRequest, systemForUrl, blockedTarget } = require('./school-systems');

const SCHOOL_URL = 'http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu';
const PARTITION = 'school-portal'; // 无 persist: 前缀，登录状态不落盘。
const TOOLBAR_HEIGHT = 100;

function createSchoolPortal({ electron, root, getParent, credentials, credentialClipboard, log = () => {} }) {
  const { BrowserWindow, WebContentsView, session, dialog, ipcMain, clipboard, ClipboardItem } = electron;
  const secretClipboard = credentialClipboard || createCredentialClipboard({ clipboard, ClipboardItem });
  const toolbarUrl = pathToFileURL(path.join(root, 'src/school-portal.html')).href;
  let win = null, view = null, opening = null, clearing = false, managing = false, credentialBusy = false, revision = 0;
  let selectedSystem = getSystem(), loadSequence = 0;
  const popups = new Set(), ownedContents = new Set();
  let state = { loading: false, canBack: false, secure: false, error: '' };

  const live = () => !!(win && !win.isDestroyed() && view && !view.webContents.isDestroyed());
  function publish() {
    if (!live()) return;
    const contents = view.webContents;
    state.canBack = contents.navigationHistory.canGoBack();
    state.secure = contents.getURL().startsWith('https:');
    view.setVisible(!state.error && !managing);
    if (!win.webContents.isDestroyed()) win.webContents.send('school-portal-state', {
      ...state, clearing, managing, systemId: selectedSystem.id, systems: SYSTEMS.map(({ id, name, url }) => ({ id, name, url })),
      domain: new URL(contents.getURL() || selectedSystem.url).hostname || new URL(selectedSystem.url).hostname, busy: clearing || credentialBusy });
  }
  function fail(message) { state.error = message; state.loading = false; publish(); }
  function blocked(url) {
    const target = blockedTarget(url);
    log(`学校系统阻止访问 [${selectedSystem.id}] ${target}`);
    if (live()) win.webContents.send('school-portal-blocked', target);
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
    view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
  }
  function createWindow() {
    const schoolSession = session.fromPartition(PARTITION);
    schoolSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    schoolSession.setPermissionCheckHandler(() => false);
    // 网页请求也受白名单约束，阻止访问本机、应用协议和其他站点。
    schoolSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !allowedRequest(details) });
    });
    win = new BrowserWindow({ width: 1100, height: 800, minWidth: 820, minHeight: 600,
      title: '学校实验系统 · 实验搭子', parent: getParent() || undefined, autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { preload: path.join(root, 'src/school-portal-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const currentWindow = win;
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
    win.on('closed', () => {
      for (const popup of popups) if (!popup.isDestroyed()) popup.close();
      ownedContents.delete(contents);
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
      if (win === currentWindow) { win = null; view = null; clearing = false; managing = false; credentialBusy = false; }
      secretClipboard.clearOwned().catch(() => {});
    });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
    contents.on('did-stop-loading', () => { if (active()) { state.loading = false; publish(); } });
    contents.on('did-navigate', (_, url, code) => {
      if (!active()) return;
      if (code >= 400) fail(`网站返回错误（${code}）。请稍后刷新，或确认学校系统是否正常开放。`);
      else { const system = systemForUrl(url); if (system) selectedSystem = system; publish(); }
    });
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
        event.preventDefault(); currentWindow.webContents.send('school-portal-download-blocked'); return;
      }
      item.setSaveDialogOptions({ title: '保存学校系统文件' });
    });
    return currentWindow.loadURL(toolbarUrl).then(() => { if (active()) load(selectedSystem.url); });
  }

  async function open() {
    if (live()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return { ok: true, reused: true }; }
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
      if (!['manage-credentials','save-credentials','delete-credentials','autofill','copy-account','copy-password'].includes(name)) return {ok:false,error:'不支持的操作'};
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
          const candidates = [];
          for (const frame of frames) {
            const url = frame.url || frame.getURL?.();
            if (systemForUrl(url)?.id !== systemId) continue;
            const probe = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: autofillScript(url, { username: '', password: '' }, true, rootUrl) }]);
            if (probe?.ready) candidates.push({ frame, url });
          }
          if (!unchanged() || candidates.length !== 1) return { ok: false, error: '无法可靠识别唯一登录框，请等待页面加载完成或手动填写' };
          const { frame, url } = candidates[0];
          if ((frame.url || frame.getURL?.()) !== url) return { ok: false, error: '网页已变化，请重新点击填充' };
          result = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: autofillScript(url, value, false, rootUrl) }]);
        } catch (_) { return { ok: false, error: '无法识别学校登录框，请使用复制账号、复制密码手动填写' }; }
        return result?.filled === true ? { ok: true, message: '已填充登录框，请自行核对并完成验证码或登录' }
          : { ok: false, error: '无法可靠识别学校登录框，请使用复制账号、复制密码手动填写' };
      }
      await secretClipboard.write(name === 'copy-account' ? value.username : value.password);
      if (!active()) { await secretClipboard.clearOwned(); return { ok: true, cancelled: true }; }
      return { ok: true, message: '已复制，30 秒后将清除仍未被替换的剪贴板内容' };
    } catch (error) {
      const known = ['请输入有效的账号和密码', '系统加密不可用，账号密码未保存', '加密保存失败，原账号配置未更改',
        '系统加密不可用，无法使用已保存账号', '请先在账号密码管理中保存账号和密码', '已保存账号无法解密，请重新保存',
        '学校账号存储无法读取，请重新保存或删除后重试'];
      return { ok: false, error: known.includes(error.message) ? error.message : '账号操作未完成，请重试或重新保存' };
    } finally { if (win === currentWindow) { credentialBusy = false; publish(); } }
  }

  async function action(event, name, payload) {
    if (!live() || !trustedSender(event, win.webContents, toolbarUrl)) return { ok: false, error: '拒绝不可信的调用来源' };
    if (name === 'state') { publish(); return { ok: true }; }
    if (clearing || credentialBusy) return { ok: false, error: '正在处理操作，请稍后' };
    if (name === 'close-credentials') { managing = false; publish(); return { ok: true }; }
    if (['credential-status', 'manage-credentials', 'save-credentials', 'delete-credentials', 'copy-account', 'copy-password', 'autofill'].includes(name))
      return credentialAction(name, payload);
    if (name === 'switch-system') {
      if (managing) return { ok: false, error: '请先关闭账号密码管理' };
      let system; try { system = getSystem(payload?.systemId); } catch (_) { return { ok: false, error: '请选择有效的学校系统' }; }
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
  function close() { if (win && !win.isDestroyed()) win.close(); }
  ipcMain.handle('school-portal-action', (event, name, payload) => {
    const currentWindow = win;
    return action(event, name, payload).catch(() => {
      if (win === currentWindow) fail('操作未完成，请关闭窗口后重试。');
      return { ok: false, error: '操作未完成' };
    });
  });
  return { open, close, hasOwnedClipboard: secretClipboard.hasOwned, cleanup: secretClipboard.clearOwned };
}

module.exports = { createSchoolPortal, allowedUrl, SCHOOL_URL, SYSTEMS, PARTITION, TOOLBAR_HEIGHT };
