'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { trustedSender } = require('./security');
const { validateCredentials } = require('./school-credentials');
const { createCredentialClipboard } = require('./credential-clipboard');
const { autofillScript } = require('./school-autofill');

const SCHOOL_URL = 'http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu';
const PARTITION = 'school-portal'; // 无 persist: 前缀，登录状态不落盘。
const TOOLBAR_HEIGHT = 100;

function allowedUrl(raw) {
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname === 'wlsy.xidian.edu.cn'
      && !url.username && !url.password && !url.port;
  } catch (_) { return false; }
}

function createSchoolPortal({ electron, root, getParent, credentials, credentialClipboard }) {
  const { BrowserWindow, WebContentsView, session, dialog, ipcMain, clipboard, ClipboardItem } = electron;
  const secretClipboard = credentialClipboard || createCredentialClipboard({ clipboard, ClipboardItem });
  const toolbarUrl = pathToFileURL(path.join(root, 'src/school-portal.html')).href;
  let win = null, view = null, opening = null, clearing = false, managing = false, credentialBusy = false, revision = 0;
  let state = { loading: false, canBack: false, secure: false, error: '' };

  const live = () => !!(win && !win.isDestroyed() && view && !view.webContents.isDestroyed());
  function publish() {
    if (!live()) return;
    const contents = view.webContents;
    state.canBack = contents.navigationHistory.canGoBack();
    state.secure = contents.getURL().startsWith('https:');
    view.setVisible(!state.error && !managing);
    if (!win.webContents.isDestroyed()) win.webContents.send('school-portal-state', {
      ...state, clearing, managing, busy: clearing || credentialBusy });
  }
  function fail(message) { state.error = message; state.loading = false; publish(); }
  function load(url) {
    if (!live() || clearing || !allowedUrl(url)) return;
    state.error = ''; state.loading = true; publish();
    const contents = view.webContents;
    contents.loadURL(url).catch(error => {
      if (error.code !== 'ERR_ABORTED' && live() && view.webContents === contents)
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
      const passive = /^(?:data:|blob:|about:blank$)/.test(details.url);
      callback({ cancel: !passive && !allowedUrl(details.url) });
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
    const active = () => live() && win === currentWindow;
    win.contentView.addChildView(view);
    resize();
    win.on('resize', resize);
    win.on('closed', () => {
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
        win?.webContents.send('school-portal-blocked');
      }
    });
    contents.on('will-redirect', event => {
      if (!active()) return;
      if (!allowedUrl(event.url)) {
        event.preventDefault();
        if (event.isMainFrame) fail('网站跳转到未允许的地址，已阻止。请联系开发者核对登录跳转地址。');
        else currentWindow.webContents.send('school-portal-blocked');
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (!active()) return { action: 'deny' };
      if (allowedUrl(url)) load(url);
      else win?.webContents.send('school-portal-blocked');
      return { action: 'deny' };
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-navigation', event => {
      if (active() && event.isMainFrame) revision++;
      if (active() && event.isMainFrame && !event.isInPlace) { state.error = ''; state.loading = true; publish(); }
    });
    contents.on('did-start-loading', () => { if (active()) { state.loading = true; publish(); } });
    contents.on('did-stop-loading', () => { if (active()) { state.loading = false; publish(); } });
    contents.on('did-navigate', (_, url, code) => {
      if (!active()) return;
      if (code >= 400) fail(`网站返回错误（${code}）。请稍后刷新，或确认学校系统是否正常开放。`);
      else publish();
    });
    contents.on('did-navigate-in-page', () => { if (active()) publish(); });
    contents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
      if (active() && isMainFrame && code !== -3) fail('网站暂时无法连接。请检查网络或校园网连接，稍后点击刷新。');
    });
    contents.on('render-process-gone', () => { if (active()) fail('学校网页暂时停止运行。请关闭此窗口后重新打开。'); });
    // 不接管网页中的下载或自动保存文件。需要下载时明确告知用户。
    schoolSession.removeAllListeners('will-download');
    schoolSession.on('will-download', event => { event.preventDefault(); win?.webContents.send('school-portal-download-blocked'); });
    return currentWindow.loadURL(toolbarUrl).then(() => { if (active()) load(SCHOOL_URL); });
  }

  async function open() {
    if (live()) { if (win.isMinimized()) win.restore(); win.focus(); return { ok: true, reused: true }; }
    if (opening) return opening;
    opening = (async () => {
      const parent = getParent();
      const result = await dialog.showMessageBox(parent, { type: 'warning', title: '学校网站连接提示',
        message: '此学校网站使用 HTTP，连接未加密。',
        detail: '请确认网络环境可信。学校网页输入的内容会发送给学校网站。\n可在账号密码管理中选择本地加密保存；网页登录状态仅保留在本次应用运行中。',
        buttons: ['继续打开', '取消'], defaultId: 1, cancelId: 1, noLink: true,
      });
      if (result.response !== 0) return { ok: true, cancelled: true };
      if (!parent || parent.isDestroyed()) return { ok: false, error: '主窗口已关闭' };
      state = { loading: false, canBack: false, secure: false, error: '' };
      await createWindow();
      return { ok: true };
    })().catch(error => { close(); return { ok: false, error: error.message }; })
      .finally(() => { opening = null; });
    return opening;
  }

  async function credentialAction(name, payload) {
    const currentWindow = win, contents = view.webContents, currentRevision = revision;
    const active = () => live() && win === currentWindow;
    const unchanged = () => active() && revision === currentRevision && !contents.isLoading() && !state.error;
    credentialBusy = true; publish();
    try {
      if (name === 'credential-status') return { ok: true, ...await credentials.status() };
      let options;
      if (name === 'manage-credentials') options = { title: '本地账号密码管理', message: '是否使用本地加密账号管理？',
        detail: '账号和密码使用系统加密，只在本机保存。管理界面使用掩码，不回显已保存内容。\n填充或复制时必须短暂解密；同一 Windows 用户下的其他程序仍可能读取正在使用的内容。不要在公共电脑保存。',
        buttons: ['进入管理', '取消'] };
      else if (name === 'save-credentials') {
        if (!managing) return { ok: false, error: '请先打开账号密码管理' };
        validateCredentials(payload);
        options = { title: '保存学校账号', message: '将这组账号密码加密保存在本机？',
          detail: '如果已有保存的账号，将替换原配置。不会把账号密码写入日志、报告或明文配置文件。', buttons: ['加密保存', '取消'] };
      } else if (name === 'delete-credentials') {
        if (!managing) return { ok: false, error: '请先打开账号密码管理' };
        options = { title: '删除保存的学校账号', message: '删除本机保存的学校账号密码？',
          detail: '不会删除报告或其他服务密钥，也不会退出已登录的学校网页。', buttons: ['删除', '取消'] };
      } else if (name === 'autofill') {
        if (!unchanged() || !allowedUrl(contents.getURL())) return { ok: false, error: '请先打开学校登录页面，并等待加载完成' };
        options = { title: '填充学校登录框', message: '将已保存账号密码填入当前学校网页？',
          detail: '仅尝试填写当前学校域名下的登录框，不点击登录按钮。填入后学校网页可以读取这些内容。\nHTTP 页面传输未加密，请确认网络环境可信；如验证码或页面无法识别，请手动复制填写。', buttons: ['确认填充', '取消'] };
      } else if (['copy-account', 'copy-password'].includes(name)) options = { title: '复制学校登录信息',
        message: name === 'copy-account' ? '将已保存账号复制到剪贴板？' : '将已保存密码复制到剪贴板？',
        detail: '剪贴板中会短暂存在明文，其他程序可能读取。应用会禁止 Windows 剪贴板历史与跨设备同步，并在 30 秒后清除仍未被替换的内容。\n第三方剪贴板软件不一定遵守这些限制；请只粘贴到确认可信的学校登录框。', buttons: ['确认复制', '取消'] };
      else return { ok: false, error: '不支持的操作' };
      const decision = await dialog.showMessageBox(currentWindow, { type: 'warning', ...options, defaultId: 1, cancelId: 1, noLink: true });
      if (decision.response !== 0 || !active()) return { ok: true, cancelled: true };
      if (name === 'manage-credentials') {
        const status = await credentials.status();
        if (!active()) return { ok: true, cancelled: true };
        managing = true; publish(); return { ok: true, ...status };
      }
      if (name === 'save-credentials') return { ok: true, ...await credentials.save(payload), message: '账号密码已加密保存' };
      if (name === 'delete-credentials') {
        const status = credentials.remove(); await secretClipboard.clearOwned();
        return { ok: true, ...status, message: '已删除本机保存的账号密码' };
      }
      if (name === 'autofill' && !unchanged()) return { ok: false, error: '网页已变化，请重新确认后填充' };
      const value = await credentials.get();
      if (!active()) return { ok: true, cancelled: true };
      if (name === 'autofill') {
        if (!unchanged()) return { ok: false, error: '网页已变化，请重新确认后填充' };
        let result;
        try { result = await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: autofillScript(contents.getURL(), value) }]); }
        catch (_) { return { ok: false, error: '无法识别学校登录框，请使用复制账号、复制密码手动填写' }; }
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
    if (name === 'home') load(SCHOOL_URL);
    else if (name === 'reload') {
      state.error = ''; state.loading = true; publish();
      const url = view.webContents.getURL();
      if (allowedUrl(url)) view.webContents.reload(); else load(SCHOOL_URL);
    } else if (name === 'back') {
      if (view.webContents.navigationHistory.canGoBack()) { state.error = ''; view.webContents.navigationHistory.goBack(); }
    } else if (name === 'clear-login') {
      const currentWindow = win, contents = view.webContents;
      clearing = true; publish();
      try {
        const decision = await dialog.showMessageBox(currentWindow, { type: 'question', title: '清除学校网站登录状态',
          message: '清除后需要重新登录学校网站，未提交的网页内容可能丢失。',
          buttons: ['清除并重新打开', '取消'], defaultId: 1, cancelId: 1, noLink: true });
        if (decision.response !== 0 || !live() || win !== currentWindow) return { ok: true, cancelled: true };
        contents.stop();
        // 先关闭网页，避免页面定时器在清除后重新写入 Cookie 或存储。
        await contents.loadURL('about:blank');
        await contents.session.clearStorageData();
        await contents.session.clearCache();
        await contents.session.closeAllConnections();
        contents.navigationHistory.clear();
      } finally { if (win === currentWindow) { clearing = false; publish(); } }
      if (win === currentWindow) load(SCHOOL_URL);
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

module.exports = { createSchoolPortal, allowedUrl, SCHOOL_URL, PARTITION, TOOLBAR_HEIGHT };
