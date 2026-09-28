'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createSchoolPortal, allowedUrl, SCHOOL_URL, PARTITION, TOOLBAR_HEIGHT } = require('../src/main/school-portal');

function harness() {
  const windows = [], views = [], ipc = new Map(), dialogs = [], operations = [];
  let saved = null, copied = null;
  const credentials = {
    status: async () => ({ configured: !!saved, available: true }),
    save: async value => { saved = { ...value }; return { configured: true, available: true }; },
    get: async () => { if (!saved) throw Error('请先在账号密码管理中保存账号和密码'); return { ...saved }; },
    remove: () => { saved = null; return { configured: false }; },
  };
  const credentialClipboard = { write: async value => { copied = value; }, clearOwned: async () => { copied = null; }, hasOwned: () => !!copied };
  const ses = new EventEmitter();
  ses.setPermissionRequestHandler = fn => { ses.permission = fn; };
  ses.setPermissionCheckHandler = fn => { ses.checkPermission = fn; };
  ses.webRequest = { onBeforeRequest: fn => { ses.filter = fn; } };
  for (const method of ['clearStorageData', 'clearCache', 'closeAllConnections'])
    ses[method] = async () => { operations.push(method); };
  class Contents extends EventEmitter {
    constructor() {
      super(); this.destroyed = false; this.url = ''; this.messages = []; this.session = ses;
      this.mainFrame = { url: '' };
      this.navigationHistory = { canGoBack: () => false, goBack: () => operations.push('back'), clear: () => operations.push('history.clear') };
    }
    isDestroyed() { return this.destroyed; }
    getURL() { return this.url; }
    isLoading() { return false; }
    async executeJavaScriptInIsolatedWorld() { return { filled: true }; }
    async loadURL(url) { this.url = url; this.mainFrame.url = url; operations.push(url); }
    setWindowOpenHandler(fn) { this.popup = fn; }
    send(...args) { this.messages.push(args); }
    close() { this.destroyed = true; }
    reload() { operations.push('reload'); }
    stop() { operations.push('stop'); }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.contentView = { addChildView() {} }; windows.push(this); }
    getContentSize() { return [1100, 800]; }
    loadURL(url) { return this.webContents.loadURL(url); }
    isDestroyed() { return !!this.destroyed; }
    isMinimized() { return false; }
    focus() { this.focused = true; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); }
    setVisible(visible) { this.visible = visible; }
    setBounds(bounds) { this.bounds = bounds; }
  }
  let decision = async () => ({ response: 0 });
  const portal = createSchoolPortal({ root: path.join(__dirname, '..'), getParent: () => ({ isDestroyed: () => false }), credentials, credentialClipboard,
    electron: { BrowserWindow: Window, WebContentsView: View,
      session: { fromPartition: partition => { assert.equal(partition, PARTITION); return ses; } },
      dialog: { showMessageBox: async (_, opts) => { dialogs.push(opts); return decision(opts); } },
      ipcMain: { handle: (key, fn) => ipc.set(key, fn) } } });
  const action = (name, event, payload) => ipc.get('school-portal-action')(event || {
    sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame }, name, payload);
  const status = () => windows.at(-1).webContents.messages.filter(m => m[0] === 'school-portal-state').at(-1)[1];
  return { portal, windows, views, ses, dialogs, operations, action, status, credentials, copied: () => copied, decide: fn => { decision = fn; } };
}

test('school URL whitelist rejects local, lookalike and credential-bearing addresses', () => {
  assert.equal(allowedUrl(SCHOOL_URL), true);
  assert.equal(allowedUrl('https://wlsy.xidian.edu.cn:443/login'), true);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'http://localhost/', 'http://wlsy.xidian.edu.cn.evil.test/',
    'http://user:password@wlsy.xidian.edu.cn/', 'http://wlsy.xidian.edu.cn:8080/', 'not a URL']) assert.equal(allowedUrl(url), false, url);
  assert.ok(!PARTITION.startsWith('persist:'));
});

test('HTTP warning defaults to cancel, cancellation creates no window', async () => {
  const h = harness(); h.decide(async () => ({ response: 1 }));
  assert.equal((await h.portal.open()).cancelled, true);
  assert.equal(h.windows.length, 0);
  assert.equal(h.dialogs[0].defaultId, 1);
});

test('simultaneous open requests create only one warning and isolated window', async () => {
  const h = harness();
  await Promise.all([h.portal.open(), h.portal.open()]);
  assert.equal(h.windows.length, 1); assert.equal(h.dialogs.length, 1);
  assert.equal((await h.portal.open()).reused, true);
  const prefs = h.views[0].options.webPreferences;
  assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true); assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.preload, undefined); assert.equal(prefs.session, h.ses);
  assert.deepEqual(h.views[0].bounds, { x: 0, y: TOOLBAR_HEIGHT, width: 1100, height: 800 - TOOLBAR_HEIGHT });
});

test('school session denies permissions and out-of-host requests', async () => {
  const h = harness(); await h.portal.open();
  h.ses.permission(null, 'camera', value => assert.equal(value, false));
  assert.equal(h.ses.checkPermission(), false);
  for (const [url, cancel] of [[SCHOOL_URL, false], ['file:///C:/secret', true], ['http://127.0.0.1/', true], ['https://evil.test/', true]])
    h.ses.filter({ url }, result => assert.equal(result.cancel, cancel));
});

test('toolbar actions reject remote senders, subframes and unsupported commands', async () => {
  const h = harness(); await h.portal.open();
  const remote = h.views[0].webContents, local = h.windows[0].webContents;
  assert.equal((await h.action('home', { sender: remote, senderFrame: remote.mainFrame })).ok, false);
  assert.equal((await h.action('home', { sender: local, senderFrame: { url: local.getURL() } })).ok, false);
  assert.equal((await h.action('file:///C:/secret')).ok, false);
  assert.equal((await h.action('reload')).ok, true); assert.ok(h.operations.includes('reload'));
});

test('blocked popups, frame navigation and downloads cannot open local files', async () => {
  const h = harness(); await h.portal.open();
  const contents = h.views[0].webContents;
  assert.deepEqual(contents.popup({ url: 'file:///C:/secret' }), { action: 'deny' });
  let blocked = 0;
  contents.emit('will-frame-navigate', { url: 'https://evil.test/', isMainFrame: true, preventDefault: () => blocked++ });
  contents.emit('will-redirect', { url: 'https://evil.test/', isMainFrame: false, preventDefault: () => blocked++ });
  h.ses.emit('will-download', { preventDefault: () => blocked++ });
  assert.equal(blocked, 3); assert.equal(h.views[0].visible, true);
  assert.equal(contents.getURL(), SCHOOL_URL); assert.equal(h.windows.length, 1);
});

test('HTTP and network failures show generic recoverable errors without leaking URLs', async () => {
  const h = harness(); await h.portal.open();
  const contents = h.views[0].webContents;
  contents.emit('did-navigate', {}, SCHOOL_URL, 503);
  assert.match(h.status().error, /503/); assert.equal(h.views[0].visible, false);
  await h.action('home'); assert.equal(h.status().error, '');
  contents.emit('did-fail-load', {}, -105, 'secret', SCHOOL_URL + '&password=secret', true);
  assert.doesNotMatch(h.status().error, /secret|password/);
  await h.action('home'); assert.equal(h.views[0].visible, true);
});

test('clear login stops page before clearing only the dedicated session', async () => {
  const h = harness(); await h.portal.open(); h.operations.length = 0;
  assert.equal((await h.action('clear-login')).ok, true);
  assert.deepEqual(h.operations, ['stop', 'about:blank', 'clearStorageData', 'clearCache', 'closeAllConnections', 'history.clear', SCHOOL_URL]);
  assert.equal(h.status().clearing, false);
});

test('clear login cancellation preserves storage and prevents simultaneous confirmations', async () => {
  const h = harness(); await h.portal.open(); h.operations.length = 0;
  let resolve;
  h.decide(() => new Promise(done => { resolve = done; }));
  const pending = h.action('clear-login');
  assert.equal(h.status().clearing, true);
  assert.equal((await h.action('clear-login')).ok, false);
  resolve({ response: 1 }); assert.equal((await pending).cancelled, true);
  assert.deepEqual(h.operations, []); assert.equal(h.status().clearing, false);
});

test('closing window destroys remote contents and late old events do not corrupt new window', async () => {
  const h = harness(); await h.portal.open(); const old = h.views[0].webContents;
  h.portal.close(); assert.equal(old.isDestroyed(), true);
  await h.portal.open();
  old.emit('did-fail-load', {}, -105, '', '', true);
  old.emit('render-process-gone', {});
  assert.equal(h.status().error, ''); assert.equal(h.windows.length, 2);
});

test('credential manager requires confirmation, hides remote view and never returns plaintext', async () => {
  const h = harness(); await h.portal.open();
  h.decide(async () => ({ response: 1 }));
  assert.equal((await h.action('manage-credentials')).cancelled, true); assert.equal(h.views[0].visible, true);
  assert.equal((await h.action('save-credentials', null, { username: 'test', password: 'secret' })).ok, false);
  h.decide(async () => ({ response: 0 }));
  assert.equal((await h.action('manage-credentials')).ok, true); assert.equal(h.views[0].visible, false);
  const saved = await h.action('save-credentials', null, { username: 'test', password: 'secret' });
  assert.equal(saved.ok, true); assert.doesNotMatch(JSON.stringify(saved), /secret/);
  assert.deepEqual(await h.action('credential-status'), { ok: true, configured: true, available: true });
  await h.action('close-credentials'); assert.equal(h.views[0].visible, true);
  assert.equal((await h.action('get-credentials')).ok, false);
});

test('copy/fill require separate native confirmation and never return secrets over IPC', async () => {
  const h = harness(); await h.portal.open(); await h.credentials.save({ username: 'TEST_ACCOUNT', password: 'TEST_PASSWORD' });
  h.decide(async () => ({ response: 1 }));
  assert.equal((await h.action('copy-password')).cancelled, true); assert.equal(h.copied(), null);
  h.decide(async () => ({ response: 0 }));
  const copied = await h.action('copy-password'); assert.equal(copied.ok, true); assert.equal(h.copied(), 'TEST_PASSWORD');
  assert.doesNotMatch(JSON.stringify(copied), /TEST_PASSWORD/);
  const filled = await h.action('autofill'); assert.equal(filled.ok, true); assert.doesNotMatch(JSON.stringify(filled), /TEST_ACCOUNT|TEST_PASSWORD/);
  const remote = h.views[0].webContents;
  assert.equal((await h.action('copy-password', { sender: remote, senderFrame: remote.mainFrame })).ok, false);
});

test('navigation during confirmation prevents autofill and errors do not expose credential exceptions', async () => {
  const h = harness(); await h.portal.open(); await h.credentials.save({ username: 'test', password: 'secret' });
  h.decide(async () => { h.views[0].webContents.emit('did-start-navigation', { isMainFrame: true, isInPlace: false }); return { response: 0 }; });
  assert.equal((await h.action('autofill')).ok, false);
  h.decide(async () => ({ response: 0 }));
  h.credentials.get = async () => { throw Error('secret test leaked by native error'); };
  assert.doesNotMatch(JSON.stringify(await h.action('copy-password')), /secret|leaked/);
});
