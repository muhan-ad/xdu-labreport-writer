'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createSchoolPortal, allowedUrl, SCHOOL_URL, PARTITION, TOOLBAR_HEIGHT } = require('../src/main/school-portal');
const { blockedTarget } = require('../src/main/school-systems');

test('blocked address diagnostics omit credentials, query tokens and fragment contents', () => {
  assert.equal(blockedTarget('https://alice:secret@example.com:8080/preview?token=SECRET#PASSWORD'), 'https://example.com:8080/preview');
  assert.equal(blockedTarget('javascript:alert("SECRET")'), 'javascript:');
  assert.equal(blockedTarget('data:text/plain,SECRET'), 'data:');
  assert.equal(blockedTarget('invalid SECRET'), '无效地址');
});

test('blocked virtual subframe reports its safe target without hiding the current page', async () => {
  const h = harness(); await h.portal.open();
  let prevented = false;
  h.views[0].webContents.emit('will-frame-navigate', {url:'https://other.example/preview?token=SECRET', isMainFrame:false, preventDefault(){prevented=true;} });
  assert.equal(prevented, true);
  assert.deepEqual(h.windows[0].webContents.messages.filter(m=>m[0]==='school-portal-blocked').at(-1), ['school-portal-blocked','https://other.example/preview']);
  assert.equal(h.views[0].visible, true);
});

function harness() {
  const windows = [], views = [], ipc = new Map(), dialogs = [], operations = [], external = [];
  const saved = new Map(); let copied = null;
  const credentials = {
    status: async (id = 'report') => ({ configured: saved.has(id), available: true }),
    save: async (value, id = 'report') => { saved.set(id, { ...value }); return { configured: true, available: true }; },
    get: async (id = 'report') => { if (!saved.has(id)) throw Error('请先在账号密码管理中保存账号和密码'); return { ...saved.get(id) }; },
    remove: (id = 'report') => { saved.delete(id); return { configured: false }; },
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
    async executeJavaScriptInIsolatedWorld(_, scripts) { return scripts[0].code.includes(',true,') ? { ready: true } : { filled: true }; }
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
    show() { this.visible = true; }
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
    electron: { BrowserWindow: Window, WebContentsView: View, shell: { openExternal: async url => external.push(url) },
      session: { fromPartition: partition => { assert.equal(partition, PARTITION); return ses; } },
      dialog: { showMessageBox: async (_, opts) => { dialogs.push(opts); return decision(opts); } },
      ipcMain: { handle: (key, fn) => ipc.set(key, fn) } } });
  const action = (name, event, payload) => ipc.get('school-portal-action')(event || {
    sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame }, name, payload);
  const status = () => windows.at(-1).webContents.messages.filter(m => m[0] === 'school-portal-state').at(-1)[1];
  return { Window, portal, windows, views, ses, dialogs, operations, external, action, status, credentials, copied: () => copied, decide: fn => { decision = fn; } };
}

test('school URL whitelist rejects local, lookalike and credential-bearing addresses', () => {
  assert.equal(allowedUrl(SCHOOL_URL), true);
  assert.equal(allowedUrl('https://wlsy.xidian.edu.cn:443/login'), true);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'http://localhost/', 'http://wlsy.xidian.edu.cn.evil.test/',
    'http://user:password@wlsy.xidian.edu.cn/', 'http://wlsy.xidian.edu.cn:8080/', 'not a URL']) assert.equal(allowedUrl(url), false, url);
  assert.ok(!PARTITION.startsWith('persist:'));
});

test('school opens directly without a confirmation dialog', async () => {
  const h = harness(); h.decide(async () => ({ response: 1 }));
  assert.equal((await h.portal.open()).ok, true);
  assert.equal(h.windows.length, 1);
  assert.equal(h.dialogs.length, 0);
});

test('simultaneous open requests create one isolated window without dialogs', async () => {
  const h = harness();
  await Promise.all([h.portal.open(), h.portal.open()]);
  assert.equal(h.windows.length, 1); assert.equal(h.dialogs.length, 0);
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

test('clear login executes directly and prevents simultaneous clearing', async () => {
  const h = harness(); await h.portal.open(); h.operations.length = 0;
  let resolve;
  h.ses.clearStorageData = () => new Promise(done => { resolve = done; });
  const pending = h.action('clear-login');
  await new Promise(done => setImmediate(done));
  assert.equal(h.status().clearing, true);
  assert.equal((await h.action('clear-login')).ok, false);
  resolve(); assert.equal((await pending).ok, true);
  assert.equal(h.dialogs.length, 0); assert.equal(h.status().clearing, false);
});

test('closing window destroys remote contents and late old events do not corrupt new window', async () => {
  const h = harness(); await h.portal.open(); const old = h.views[0].webContents;
  h.portal.close(); assert.equal(old.isDestroyed(), true);
  await h.portal.open();
  old.emit('did-fail-load', {}, -105, '', '', true);
  old.emit('render-process-gone', {});
  assert.equal(h.status().error, ''); assert.equal(h.windows.length, 2);
});

test('credential manager opens directly, hides remote view and never returns plaintext', async () => {
  const h = harness(); await h.portal.open();
  h.decide(async () => ({ response: 1 }));
  assert.equal((await h.action('save-credentials', null, { username: 'test', password: 'secret' })).ok, false);
  h.decide(async () => ({ response: 0 }));
  assert.equal((await h.action('manage-credentials')).ok, true); assert.equal(h.views[0].visible, false);
  const saved = await h.action('save-credentials', null, { username: 'test', password: 'secret' });
  assert.equal(saved.ok, true); assert.doesNotMatch(JSON.stringify(saved), /secret/);
  assert.deepEqual(await h.action('credential-status'), { ok: true, configured: true, available: true });
  await h.action('close-credentials'); assert.equal(h.views[0].visible, true);
  assert.equal((await h.action('get-credentials')).ok, false);
  assert.equal((await h.action('delete-credentials')).ok, true);
  assert.equal(h.dialogs.length, 0);
});

test('removed copy actions reject requests; fill executes without dialogs and never return secrets over IPC', async () => {
  const h = harness(); await h.portal.open(); await h.credentials.save({ username: 'TEST_ACCOUNT', password: 'TEST_PASSWORD' });
  h.decide(async () => ({ response: 1 }));
  h.decide(async () => ({ response: 0 }));
  const copied = await h.action('copy-password'); assert.equal(copied.ok, false); assert.equal(h.copied(), null);
  assert.doesNotMatch(JSON.stringify(copied), /TEST_PASSWORD/);
  const filled = await h.action('autofill'); assert.equal(filled.ok, true); assert.doesNotMatch(JSON.stringify(filled), /TEST_ACCOUNT|TEST_PASSWORD/);
  assert.equal((await h.action('copy-account')).ok, false); assert.equal(h.copied(), null);
  assert.equal(h.dialogs.length, 0);
  const remote = h.views[0].webContents;
  assert.equal((await h.action('copy-password', { sender: remote, senderFrame: remote.mainFrame })).ok, false);
});

test('navigation while reading credentials prevents autofill and errors do not expose secrets', async () => {
  const h = harness(); await h.portal.open(); await h.credentials.save({ username: 'test', password: 'secret' });
  h.credentials.get = async () => { h.views[0].webContents.emit('did-start-navigation', { isMainFrame: true, isInPlace: false }); return {username:'test',password:'secret'}; };
  assert.equal((await h.action('autofill')).ok, false);
  h.decide(async () => ({ response: 0 }));
  h.credentials.get = async () => { throw Error('secret test leaked by native error'); };
  assert.doesNotMatch(JSON.stringify(await h.action('copy-password')), /secret|leaked/);
});


test('four systems switch by trusted IDs, update current home and reject arbitrary URLs', async () => {
  const h = harness(); await h.portal.open();
  const { SYSTEMS } = require('../src/main/school-systems');
  assert.equal(h.status().systems.length, 4);
  for (const system of SYSTEMS) {
    if(['simulation','exam'].includes(system.id)) {
      const previous=h.status().systemId,previousUrl=h.views[0].webContents.getURL();
      const result=await h.action('switch-system',null,{systemId:system.id});
      assert.equal(result.ok,true);assert.equal(result.external,true);
      assert.equal(h.external.at(-1),system.url);assert.equal(h.status().systemId,previous);
      assert.equal(h.views[0].webContents.getURL(),previousUrl);continue;
    }
    assert.equal((await h.action('switch-system', null, { systemId: system.id })).ok, true);
    assert.equal(h.status().systemId, system.id);assert.equal(h.views[0].webContents.getURL(), system.url);
    await h.action('home');assert.equal(h.views[0].webContents.getURL(),system.url);
    await h.action('clear-login');assert.equal(h.views[0].webContents.getURL(),system.url);
  }
  assert.equal((await h.action('switch-system', null, {systemId:'http://evil.test/'})).ok,false);
  assert.equal((await h.action('switch-system', null, {})).ok,false);
});
test('credential actions are scoped to selected system and cannot switch during manager', async () => {
  const h=harness();await h.portal.open();await h.credentials.save({username:'report-test',password:'report-secret'},'report');
  await h.action('switch-system',null,{systemId:'course'});
  assert.equal((await h.action('credential-status')).configured,false);
  assert.equal((await h.action('copy-password')).ok,false);
  await h.action('manage-credentials');assert.equal((await h.action('switch-system',null,{systemId:'report'})).ok,false);
  await h.action('save-credentials',null,{username:'virtual-test',password:'virtual-secret'});await h.action('close-credentials');
  assert.equal((await h.action('autofill')).ok,true);
  await h.action('delete-credentials');await h.action('switch-system',null,{systemId:'report'});
  assert.equal((await h.action('autofill')).ok,true);assert.equal(h.copied(),null);
});
test('approved popups preserve window semantics and school downloads use a Save dialog',async()=>{
  const h=harness();await h.portal.open();const remote=h.views[0].webContents;
  const popup=remote.popup({url:'https://wlxnfzsy.xidian.edu.cn/experiment'});
  assert.equal(popup.action,'allow');assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox,true);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
  let prevented=false,options;
  h.ses.emit('will-download',{preventDefault(){prevented=true}},{getURL:()=>SCHOOL_URL,setSaveDialogOptions(value){options=value}},remote);
  assert.equal(prevented,false);assert.match(options.title,/保存/);
});
test('ambiguous or foreign login frames are not filled and frame navigation invalidates pending fill',async()=>{
  const h=harness();await h.portal.open();await h.credentials.save({username:'test',password:'secret'});
  const remote=h.views[0].webContents;let filled=0;
  const frame={url:SCHOOL_URL,executeJavaScriptInIsolatedWorld:async(_,scripts)=>scripts[0].code.includes(',true,')?{ready:true}:(filled++,{filled:true})};
  remote.mainFrame.framesInSubtree=[frame,{...frame}];assert.equal((await h.action('autofill')).ok,false);assert.equal(filled,0);
  remote.mainFrame.framesInSubtree=[{...frame,url:'https://wlxnfzsy.xidian.edu.cn/'}];assert.equal((await h.action('autofill')).ok,false);
  remote.mainFrame.framesInSubtree=[frame];remote.executeJavaScriptInIsolatedWorld=async()=>{remote.emit('did-start-navigation',{isMainFrame:false});return {ready:true}};
  assert.equal((await h.action('autofill')).ok,false);assert.equal(filled,0);
});
test('only observed public CDN assets are allowed, never CDN navigation or plaintext simulation',()=>{
  const {allowedRequest,systemForUrl}=require('../src/main/school-systems');
  assert.equal(allowedUrl('https://wlxnfzsy.xidian.edu.cn/'),true);assert.equal(allowedUrl('http://wlxnfzsy.xidian.edu.cn/'),false);
  assert.equal(systemForUrl('http://wlsy.xidian.edu.cn/PhyEws/default.aspx').id,'course');
  assert.equal(allowedRequest({url:'https://cdn.falconsistemas.com.br/falcon/js/iziToast.min.js',resourceType:'script'}),true);
  assert.equal(allowedRequest({url:'https://cdn.falconsistemas.com.br/falcon/js/iziToast.min.js',resourceType:'mainFrame'}),false);
  assert.equal(allowedRequest({url:'http://localhost/x.js',resourceType:'script'}),false);
});

test('observed virtual preview site permits frames, requests and popups without becoming a credential target', async () => {
  const {allowedRequest,systemForUrl}=require('../src/main/school-systems');
  const target='https://wlsytest.xidian.edu.cn/Student/SNotice/';
  assert.equal(allowedUrl(target),true);
  assert.equal(allowedRequest({url:target,resourceType:'subFrame'}),true);
  assert.equal(allowedRequest({url:'https://wlsytest.xidian.edu.cn/Content/site.css',resourceType:'stylesheet'}),true);
  assert.equal(systemForUrl(target),null);
  for(const bad of ['http://wlsytest.xidian.edu.cn/','https://wlsytest.xidian.edu.cn.evil.test/','https://evil.wlsytest.xidian.edu.cn/','https://wlsytest.xidian.edu.cn:8443/','https://u:p@wlsytest.xidian.edu.cn/'])assert.equal(allowedUrl(bad),false);
  const h=harness();await h.portal.open();await h.action('switch-system',null,{systemId:'simulation'});
  const contents=h.views[0].webContents;
  let prevented=false;
  contents.emit('will-frame-navigate',{url:target,isMainFrame:false,preventDefault(){prevented=true}});
  contents.emit('will-redirect',{url:target,isMainFrame:false,preventDefault(){prevented=true}});
  assert.equal(prevented,false);assert.equal(contents.popup({url:target}).action,'allow');
  await h.credentials.save({username:'fixture',password:'secret'},'simulation');
  contents.url=target; contents.mainFrame.url=target;
  let injected=false;contents.executeJavaScriptInIsolatedWorld=async()=>{injected=true;return {filled:true}};
  assert.equal((await h.action('autofill')).ok,false);assert.equal(injected,false);
});

test('observed simulation remote login and content load without receiving saved portal credentials', async () => {
  const {allowedRequest,systemForUrl}=require('../src/main/school-systems');
  const urls=['https://wlsyinfo.xidian.edu.cn/Login/RemoteUserLogin','https://wlsyinfo.xidian.edu.cn/ReportStudent/SStartPage/'];
  const h=harness();await h.portal.open();await h.action('switch-system',null,{systemId:'simulation'});
  const remote=h.views[0].webContents;let prevented=0;
  for(const url of urls){
    assert.equal(allowedUrl(url),true);assert.equal(systemForUrl(url),null);
    for(const resourceType of ['mainFrame','subFrame','xhr','script','stylesheet'])assert.equal(allowedRequest({url,resourceType}),true);
    remote.emit('will-frame-navigate',{url,isMainFrame:false,preventDefault(){prevented++}});
    remote.emit('will-redirect',{url,isMainFrame:false,preventDefault(){prevented++}});
    assert.equal(remote.popup({url}).action,'allow');
  }
  assert.equal(prevented,0);
  for(const url of ['http://wlsyinfo.xidian.edu.cn/','https://wlsyinfo.xidian.edu.cn:8080/','https://wlsyinfo.xidian.edu.cn.evil.test/','https://u:p@wlsyinfo.xidian.edu.cn/'])assert.equal(allowedUrl(url),false);
  await h.credentials.save({username:'fixture',password:'secret'},'simulation');remote.url=urls[1];remote.mainFrame.url=urls[1];
  let injected=false;remote.executeJavaScriptInIsolatedWorld=async()=>{injected=true;return {filled:true}};
  assert.equal((await h.action('autofill')).ok,false);assert.equal(injected,false);
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('settings hide remote page, default auto-fill fills on ready without IPC secrets, off suppresses fill', async () => {
 const h=harness(); await h.portal.open(); await h.credentials.save({username:'TEST_ACCOUNT',password:'TEST_PASSWORD'});
 const remote=h.views[0].webContents; let filled=0;
 remote.executeJavaScriptInIsolatedWorld=async(_,scripts)=>{ if(scripts[0].code.includes(',true,')) return {ready:true}; filled++; return {filled:true}; };
 assert.equal(h.status().autoFillEnabled,true);
 remote.emit('did-stop-loading'); await pause(240); assert.equal(filled,1);
 remote.emit('did-stop-loading'); await pause(240); assert.equal(filled,1,'successful page not repeatedly filled');
 assert.doesNotMatch(JSON.stringify(h.windows[0].webContents.messages),/TEST_ACCOUNT|TEST_PASSWORD/);
 await h.action('open-settings'); assert.equal(h.views[0].visible,false);
 await h.action('set-auto-fill',null,{enabled:false});
 await h.action('close-settings'); assert.equal(h.views[0].visible,true);
 remote.emit('did-start-navigation',{isMainFrame:true}); remote.emit('did-stop-loading'); await pause(240); assert.equal(filled,1);
 await h.action('set-auto-fill',null,{enabled:true}); await pause(240); assert.equal(filled,2);
 h.portal.close();
});
test('auto-fill cancelled by navigation and close; no saved credentials means no injection', async()=>{
 const h=harness();await h.portal.open();let count=0;h.views[0].webContents.executeJavaScriptInIsolatedWorld=async()=>{count++;return {ready:true}};
 h.views[0].webContents.emit('did-stop-loading');await pause(220);assert.equal(count,0);
 await h.credentials.save({username:'test',password:'secret'});
 h.views[0].webContents.emit('did-stop-loading');h.views[0].webContents.emit('did-start-navigation',{isMainFrame:true});await pause(220);assert.equal(count,0);
 h.views[0].webContents.emit('did-stop-loading');h.portal.close();await pause(220);assert.equal(count,0);
});
test('course autofill reuses encrypted school settings, prefers course and respects the global switch',async()=>{
 const h=harness();assert.equal((await h.portal.courseLogin()).credentials,null);
 await h.credentials.save({username:'REPORT_ACCOUNT',password:'REPORT_PASSWORD'},'report');
 assert.equal((await h.portal.courseLogin()).credentials.username,'REPORT_ACCOUNT');
 await h.credentials.save({username:'COURSE_ACCOUNT',password:'COURSE_PASSWORD'},'course');
 assert.equal((await h.portal.courseLogin()).credentials.username,'COURSE_ACCOUNT');
 await h.portal.open();await h.action('set-auto-fill',null,{enabled:false});
 assert.deepEqual(await h.portal.courseLogin(),{enabled:false});h.portal.close();
});

test('trusted dropdown hides and restores school view without changing navigation or credentials',async()=>{
 const h=harness();await h.portal.open();const before=h.views[0].webContents.getURL();
 assert.equal((await h.action('dropdown-visibility',undefined,{open:true})).ok,true);assert.equal(h.views[0].visible,false);
 assert.equal((await h.action('dropdown-visibility',undefined,{open:false})).ok,true);assert.equal(h.views[0].visible,true);
 assert.equal(h.views[0].webContents.getURL(),before);assert.equal((await h.action('dropdown-visibility',undefined,{open:'bad'})).ok,false);
});

test('embedded report uses isolated child views, trusts only toolbar, hides for host dialogs and never closes host',async()=>{
 const h=harness(),host=new h.Window({}),bounds={x:230,y:140,width:850,height:620};
 assert.equal((await h.portal.openEmbedded(host,bounds)).ok,true);assert.equal(h.windows.length,1);assert.equal(h.views.length,2);
 const [toolbar,remote]=h.views;assert.deepEqual(toolbar.bounds,bounds);assert.deepEqual(remote.bounds,{x:230,y:216,width:850,height:544});
 assert.equal(remote.options.webPreferences.nodeIntegration,false);assert.equal(remote.options.webPreferences.sandbox,true);assert.equal(remote.options.webPreferences.preload,undefined);
 assert.equal(remote.webContents.getURL(),SCHOOL_URL);
 const state=toolbar.webContents.messages.filter(m=>m[0]==='school-portal-state').at(-1)[1];assert.equal(state.embedded,true);assert.deepEqual(state.systems.map(s=>s.id),['report']);
 assert.equal((await h.action('open-settings',{sender:remote.webContents,senderFrame:remote.webContents.mainFrame})).ok,false);
 assert.equal((await h.action('open-settings',{sender:toolbar.webContents,senderFrame:toolbar.webContents.mainFrame})).ok,true);assert.equal(remote.visible,false);
 await h.action('close-settings',{sender:toolbar.webContents,senderFrame:toolbar.webContents.mainFrame});assert.equal(remote.visible,true);
 h.portal.updateEmbedded(host,bounds,false);assert.equal(toolbar.visible,false);assert.equal(remote.visible,false);
 h.portal.updateEmbedded(host,bounds,true);assert.equal(remote.visible,true);
 h.portal.close();assert.equal(host.isDestroyed(),false);assert.equal(remote.webContents.isDestroyed(),true);assert.equal(toolbar.webContents.isDestroyed(),true);
});
test('embedding refuses to discard a separately open school website',async()=>{
 const h=harness();await h.portal.open();const existing=h.windows[0];const host=new h.Window({});assert.equal((await h.portal.openEmbedded(host,{x:200,y:100,width:800,height:600})).ok,false);assert.equal(existing.isDestroyed(),false);h.portal.close();
});

test('course settings and original school portal share the exact encrypted-account manager and auto-fill preference',async()=>{
 const h=harness();const saved=await h.portal.accountSettings('save',{systemId:'course',username:'SHARED_ACCOUNT',password:'SHARED_PASSWORD'});assert.equal(saved.ok,true);assert.doesNotMatch(JSON.stringify(saved),/SHARED_/);
 assert.equal((await h.portal.courseLogin()).credentials.username,'SHARED_ACCOUNT');
 await h.portal.accountSettings('save',{systemId:'report',username:'REPORT_ACCOUNT',password:'REPORT_PASSWORD'});await h.portal.open();assert.equal((await h.action('credential-status')).configured,true);
 await h.portal.accountSettings('set-auto-fill',{enabled:false});assert.equal(h.status().autoFillEnabled,false);assert.equal((await h.portal.courseLogin()).enabled,false);
 await h.action('set-auto-fill',undefined,{enabled:true});assert.equal((await h.portal.accountSettings('status',{systemId:'course'})).autoFillEnabled,true);
 await h.portal.accountSettings('delete',{systemId:'report'});assert.equal((await h.action('credential-status')).configured,false);assert.equal((await h.portal.accountSettings('status',{systemId:'course'})).configured,true);h.portal.close();
});
