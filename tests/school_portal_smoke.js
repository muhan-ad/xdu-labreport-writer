'use strict';
// Real Electron views and IPC, with a fixture website; never uses a real account.
const { app, BrowserWindow, session, dialog, clipboard, ClipboardItem } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const { PARTITION, SCHOOL_URL, TOOLBAR_HEIGHT } = require('../src/main/school-portal');
const { MARKER, OS_FORMAT } = require('../src/main/credential-clipboard');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'labreport-school-test-'));
app.setPath('userData', profile);
app.on('browser-window-created', (_, window) => window.hide());
let response = 0;
const warnings = [];
dialog.showMessageBox = async (_, options) => { warnings.push(options.title); assert.equal(options.defaultId, 1); return { response }; };
require('../main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(100); }
  throw Error('Timed out waiting for school UI');
}
const fixture = url => `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>测试学校网页</title>
<style>body{font:16px sans-serif;padding:36px;background:#f6f8f6}input,button{margin:8px;padding:8px}</style>
<h1>学校系统兼容性测试页（非真实登录）</h1><p>${new URL(url).pathname}</p>
<label>测试账号<input id="username"></label><label>测试密码<input id="password" type="password"></label>
<p><a id="next" href="/next">下一页</a> · <a id="failure" href="/failure">模拟服务器故障</a></p>
<a id="outside" href="https://example.com/" target="_blank">测试外链拦截</a>
<a id="download" href="/download">测试下载拦截</a></html>`;

app.whenReady().then(async () => {
  let previousClipboard, exitCode = 0;
  try {
    // Materialize payloads before changing the clipboard; native read items may be lazy.
    previousClipboard = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => new ClipboardItem(Object.fromEntries(
      await Promise.all(item.types.map(async type => {
        const payload = await item.getType(type);
        return [type, payload instanceof Blob ? new Blob([await payload.arrayBuffer()], { type: payload.type }) : payload];
      }))))));
    const school = session.fromPartition(PARTITION);
    assert.equal(school.isPersistent(), false); assert.equal(school.getStoragePath(), null);
    assert.notEqual(school, session.defaultSession);
    school.protocol.handle('http', request => new URL(request.url).pathname === '/download'
      ? new Response('test', { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=test.txt' } })
      : new Response(fixture(request.url), {
      status: new URL(request.url).pathname === '/failure' ? 503 : 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    await until(() => BrowserWindow.getAllWindows().length > 0);
    const main = BrowserWindow.getAllWindows()[0], evaluate = code => main.webContents.executeJavaScript(code);
    await until(() => evaluate('typeof experiments !== "undefined" && experiments.length === 27').catch(() => false));
    const entry = await evaluate(`(() => { const b=document.getElementById('btnOpenSchoolPortal'), r=b.getBoundingClientRect();
      return {text:b.textContent,visible:r.width>0 && r.top>=0 && r.bottom<innerHeight, x:r.left, right:r.right, width:innerWidth}; })()`);
    assert.match(entry.text, /学校实验系统/); assert.equal(entry.visible, true); assert.ok(entry.right <= entry.width);
    await evaluate("localStorage.setItem('school-isolation-check', 'preserved')");
    const capture = async (contents, name) => {
      await delay(200);
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      assert.ok(!image.isEmpty()); fs.writeFileSync(path.join(profile, name + '.png'), image.toPNG());
    };
    await capture(main.webContents, 'homepage');
    response = 1;
    assert.equal((await evaluate('window.labAPI.openSchoolPortal()')).cancelled, true);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    response = 0;
    await evaluate("document.getElementById('btnOpenSchoolPortal').click()");
    await until(() => BrowserWindow.getAllWindows().length === 2);
    const portal = BrowserWindow.getAllWindows().find(w => w !== main), toolbar = portal.webContents;
    const remote = portal.contentView.children.find(v => v.webContents && v.webContents !== toolbar).webContents;
    await until(() => remote.getURL() === SCHOOL_URL && !remote.isLoading());
    const t = code => toolbar.executeJavaScript(code, true), r = code => remote.executeJavaScript(code, true);
    const bridges = await r('({labAPI:typeof window.labAPI,schoolPortal:typeof window.schoolPortal,require:typeof require})');
    assert.deepEqual(bridges, { labAPI: 'undefined', schoolPortal: 'undefined', require: 'undefined' });
    assert.equal(remote.session, school); assert.equal(await t('typeof window.labAPI'), 'undefined');
    assert.match(await t("document.getElementById('connection').textContent"), /未加密/);
    const preferences = remote.getLastWebPreferences();
    assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true);
    assert.ok(!preferences.preload);
    console.log('PASS: prominent homepage entry, cancellable warning, memory-only isolated remote view');
    const toolbarLayout = await t(`({home:!!document.getElementById('home'),warning:!!document.querySelector('.portal-warning'),
      buttons:[...document.querySelectorAll('.portal-actions button')].map(b=>b.id)})`);
    assert.deepEqual(toolbarLayout, { home: false, warning: false,
      buttons: ['back', 'reload', 'autofill', 'copyAccount', 'copyPassword', 'manageCredentials', 'clearLogin'] });
    response = 1;
    await t("document.getElementById('manageCredentials').click()");
    await delay(100); assert.equal(await t("document.getElementById('credentialsDialog').open"), false);
    response = 0;
    await t("document.getElementById('manageCredentials').click()");
    await until(() => t("document.getElementById('credentialsDialog').open"));
    assert.deepEqual(await t("[document.getElementById('credentialAccount').type,document.getElementById('credentialPassword').type]"), ['password', 'password']);
    await capture(toolbar, 'credentials-empty');
    await t(`document.getElementById('credentialAccount').value='SCHOOL_TEST_ACCOUNT';
      document.getElementById('credentialPassword').value='SCHOOL_TEST_ONLY_PASSWORD';
      document.getElementById('credentialForm').requestSubmit()`);
    await until(() => t("document.getElementById('credentialState').textContent.includes('已加密保存')"));
    assert.equal(await t("document.getElementById('credentialAccount').value + document.getElementById('credentialPassword').value"), '');
    const vaultFile = path.join(profile, 'school-portal', 'credentials.json');
    assert.doesNotMatch(fs.readFileSync(vaultFile, 'utf8'), /SCHOOL_TEST|username|password/);
    assert.deepEqual(fs.readdirSync(path.dirname(vaultFile)), ['credentials.json']);
    assert.deepEqual(await t("window.schoolPortal.action('credential-status')"), { ok: true, configured: true, available: true });
    await capture(toolbar, 'credentials-saved');
    await t("document.getElementById('closeCredentials').click()");
    await until(() => t("!document.getElementById('credentialsDialog').open"));
    response = 1;
    assert.equal((await t("window.schoolPortal.action('autofill')")).cancelled, true);
    assert.equal(await r("document.getElementById('password').value"), '');
    response = 0;
    assert.equal((await t("window.schoolPortal.action('autofill')")).ok, true);
    assert.deepEqual(await r("({account:document.getElementById('username').value==='SCHOOL_TEST_ACCOUNT',password:document.getElementById('password').value==='SCHOOL_TEST_ONLY_PASSWORD',masked:document.getElementById('username').type==='password'})"),
      { account: true, password: true, masked: true });
    assert.equal((await t("window.schoolPortal.action('autofill')")).ok, true, 'repeat fill safely supports the masked account field');
    await r("document.body.insertAdjacentHTML('beforeend','<input type=\"password\" id=\"secondPassword\">')");
    assert.equal((await t("window.schoolPortal.action('autofill')")).ok, false, 'ambiguous/new-password form must not be filled');
    await r("document.getElementById('secondPassword').remove()");
    response = 1;
    assert.equal((await t("window.schoolPortal.action('copy-password')")).cancelled, true);
    response = 0;
    const copied = await t("window.schoolPortal.action('copy-password')");
    assert.equal(copied.ok, true); assert.doesNotMatch(JSON.stringify(copied), /SCHOOL_TEST/);
    assert.equal(await clipboard.readText(), 'SCHOOL_TEST_ONLY_PASSWORD');
    const clipboardItems = await clipboard.read();
    assert.ok(clipboardItems.some(item => item.types.includes(MARKER)));
    for (const name of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
      const type = OS_FORMAT(name), item = clipboardItems.find(item => item.types.includes(type));
      assert.ok(item, name + ' format should be written atomically');
      assert.deepEqual(new Uint8Array(await (await item.getType(type)).arrayBuffer()), new Uint8Array(4));
    }
    assert.equal((await t("window.schoolPortal.action('copy-account')")).ok, true);
    assert.equal(await clipboard.readText(), 'SCHOOL_TEST_ACCOUNT');
    await r(`document.body.innerHTML='<form action="https://example.com/login"><input id="username"><input id="password" type="password"></form>'`);
    assert.equal((await t("window.schoolPortal.action('autofill')")).ok, false, 'cross-site form action must not receive credentials');
    assert.equal(await r("document.getElementById('username').value + document.getElementById('password').value"), '');
    await t("document.getElementById('reload').click()");
    await until(() => remote.getURL() === SCHOOL_URL && !remote.isLoading());
    console.log('PASS: confirmed encrypted credential management, masked inputs, conservative autofill and protected clipboard formats');

    await r("document.getElementById('next').click()");
    await until(() => remote.getURL().endsWith('/next') && !remote.isLoading());
    await until(() => t("!document.getElementById('back').disabled"));
    await t("document.getElementById('back').click()");
    await until(() => remote.getURL() === SCHOOL_URL && !remote.isLoading());
    await t("document.getElementById('reload').click()");
    await until(() => !remote.isLoading());
    await r("document.getElementById('outside').click()");
    await until(() => t("document.getElementById('status').textContent.includes('已阻止')"));
    assert.equal(BrowserWindow.getAllWindows().length, 2); assert.equal(remote.getURL(), SCHOOL_URL);
    await r("document.getElementById('download').click()");
    await until(() => t("document.getElementById('status').textContent.includes('不支持下载')"));
    console.log('PASS: back, refresh, external popup and download restrictions');

    await r("document.cookie='fixture_session=login; path=/';localStorage.setItem('fixture_session','login');sessionStorage.setItem('fixture_session','login')");
    assert.ok((await school.cookies.get({ name: 'fixture_session' })).length);
    assert.equal((await t("window.schoolPortal.action('clear-login')")).ok, true);
    await until(() => remote.getURL() === SCHOOL_URL && !remote.isLoading());
    assert.equal((await school.cookies.get({ name: 'fixture_session' })).length, 0);
    assert.equal(await r("localStorage.getItem('fixture_session')"), null);
    assert.equal(await r("sessionStorage.getItem('fixture_session')"), null);
    assert.equal(await evaluate("localStorage.getItem('school-isolation-check')"), 'preserved');
    console.log('PASS: clear login removes school cookies/storage only, preserves report app settings');
    assert.equal((await t("window.schoolPortal.action('credential-status')")).configured, true, 'clear web session does not delete saved encrypted account');
    await t("document.getElementById('manageCredentials').click()");
    await until(() => t("document.getElementById('credentialsDialog').open"));
    assert.equal(await t("document.getElementById('credentialAccount').value + document.getElementById('credentialPassword').value"), '');
    await t("document.getElementById('deleteCredentials').click()");
    await until(() => t("document.getElementById('credentialState').textContent.includes('尚未保存')"));
    assert.equal(JSON.parse(fs.readFileSync(vaultFile, 'utf8')).encrypted, undefined);
    assert.equal(await clipboard.readText(), '', 'deleting saved credentials clears owned clipboard');
    await t("document.getElementById('closeCredentials').click()");
    await until(() => t("!document.getElementById('credentialsDialog').open"));

    portal.setContentSize(820, 600);
    await delay(100);
    const bounds = await t(`({height:document.querySelector('header').getBoundingClientRect().height,
      width:document.documentElement.scrollWidth, viewport:innerWidth,
      actionsBottom:document.querySelector('.portal-actions').getBoundingClientRect().bottom})`);
    assert.equal(bounds.height, TOOLBAR_HEIGHT); assert.equal(bounds.width, bounds.viewport);
    assert.ok(bounds.actionsBottom <= TOOLBAR_HEIGHT, JSON.stringify(bounds));
    await capture(toolbar, 'portal-controls');
    await capture(remote, 'fixture-website');
    await r("document.getElementById('failure').click()");
    await until(() => t("!document.getElementById('errorPanel').hidden"));
    assert.match(await t("document.getElementById('errorText').textContent"), /503/);
    await capture(toolbar, 'portal-network-error');
    await t("document.getElementById('retry').click()");
    await until(() => remote.getURL() === SCHOOL_URL && !remote.isLoading());
    assert.equal(await t("document.getElementById('errorPanel').hidden"), true);
    assert.equal((await evaluate('window.labAPI.openSchoolPortal()')).reused, true);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    portal.close(); await until(() => remote.isDestroyed());
    assert.equal(main.isDestroyed(), false);
    assert.ok(warnings.includes('本地账号密码管理') && warnings.includes('保存学校账号')
      && warnings.includes('填充学校登录框') && warnings.includes('复制学校登录信息') && warnings.includes('删除保存的学校账号'));
    const log = fs.readFileSync(path.join(profile, 'logs', 'app.log'), 'utf8');
    assert.doesNotMatch(log, /SCHOOL_TEST/);
    console.log('PASS: minimum-size layout, HTTP error and recovery, single window lifecycle');
    console.log('ARTIFACTS: ' + profile);
  } catch (error) { console.error(error.stack); console.error('ARTIFACTS: ' + profile); exitCode = 1; }
  finally {
    if (previousClipboard) { if (previousClipboard.length) await clipboard.write(previousClipboard); else clipboard.clear(); }
  }
  app.exit(exitCode);
});
