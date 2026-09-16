'use strict';
// Launch with Electron. Uses a fresh user profile and only its own Word instance.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const JSZip = require('jszip');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labreport-electron-test-'));
app.setPath('userData', root);
app.on('browser-window-created', (_, window) => window.hide());
const messages = [];
app.on('web-contents-created', (_, contents) => contents.on('console-message', details => {
  if (details.level === 'error') messages.push(details.message);
}));
require('../main');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(200); }
  throw Error('Timed out waiting for UI');
}
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length);
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const evaluate = code => contents.executeJavaScript(code);
    await until(() => evaluate('typeof experiments !== "undefined" && experiments.length === 26').catch(() => false));
    assert.ok(contents.getURL().startsWith('file:'), 'preserve existing localStorage origin across upgrade');
    await evaluate("openUpdateModal({latest:'9.0.0',current:'1.7.6',notes:'test',downloads:[{name:'网盘',url:'https://pan.quark.cn/s/test'}]})");
    const links = await evaluate("({copy:document.querySelectorAll('.cv-copy-link').length,open:document.querySelectorAll('.cv-open-link').length,url:document.querySelector('.update-share-url').value})");
    assert.deepEqual(links, {copy:1,open:1,url:'https://pan.quark.cn/s/test'});
    console.log('PASS: version dialog offers open/copy share links');
    const status = await evaluate('window.labAPI.credentialStatus()');
    assert.equal(status.configured, false);
    const stored = await evaluate("window.labAPI.saveCredential({provider:'custom',apiUrl:'https://example.com/v1',key:'TEST_ONLY_NOT_A_REAL_KEY'})");
    assert.equal(stored.ok, true, stored.error);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'credentials.json'), 'utf8'), /TEST_ONLY_NOT_A_REAL_KEY/);
    await evaluate("window.labAPI.saveCredential({key:''})");
    assert.equal((await evaluate(`window.labAPI.readDocxBuffer(${JSON.stringify(path.join(__dirname, '../package.json'))})`)).ok, false);
    console.log('PASS: real Electron IPC, isolated profile, DPAPI credential storage');
    await evaluate("selectExperiment(experiments.find(e => e.name === '长度与体积的测量'))");
    await until(() => evaluate('currentSchema && currentSchema.groups && currentSchema.groups.length'));
    const ocrUi = await evaluate("({button:!!document.getElementById('btnRecognize'),modal:!!document.getElementById('recognizeModal'),provider:!!document.getElementById('selectVisionProvider')})");
    assert.deepEqual(ocrUi, { button: true, modal: true, provider: true });
    await evaluate("document.getElementById('btnRecognize').click()");
    assert.equal(await evaluate("document.getElementById('recognizeModal').classList.contains('show')"), true);
    await evaluate("document.getElementById('btnCloseRecognize').click()");
    const visionStored = await evaluate("window.labAPI.saveVisionCredential({provider:'siliconflow',key:'VISION_TEST_ONLY'})");
    assert.equal(visionStored.ok, true, visionStored.error);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'vision', 'credentials.json'), 'utf8'), /VISION_TEST_ONLY/);
    const rejectedImage = await evaluate("window.labAPI.ocrRecognize({visionProvider:'siliconflow',prompt:'x',imageDataUrl:'data:text/plain;base64,SGVsbG8='})");
    assert.equal(rejectedImage.ok, false);
    await evaluate("window.labAPI.saveVisionCredential({key:''})");
    console.log('PASS: OCR UI, encrypted vision credential and image validation');
    const photo = await evaluate("window.labAPI.saveTableImage(currentExp.path,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxZ0AAAAASUVORK5CYII=')");
    assert.equal(photo.ok, true, photo.error);
    const result = await evaluate("window.labAPI.runGenerate(currentExp.path,{name:'回归测试',id:'TEST',class:'测试'}, {}, {}, true)");
    assert.equal(result.ok, true, result.error || result.logs);
    const reportZip = await JSZip.loadAsync(fs.readFileSync(result.reportFile));
    assert.ok(Object.keys(reportZip.files).some(name => name.startsWith('word/media/')), 'saved OCR photo should be embedded in DOCX');
    console.log('PASS: real Electron -> saved OCR photo -> Python -> Word generation');
    await evaluate("(async () => { const scan = await window.labAPI.scanExperiments(); experiments = Array.isArray(scan) ? scan : scan.experiments; currentExp = experiments.find(e => e.name === '长度与体积的测量'); await loadPreview(); })()");
    await until(() => evaluate('previewLoaded === true'));
    const frame = contents.mainFrame.framesInSubtree.find(f => f !== contents.mainFrame);
    assert.ok(frame, 'preview frame exists');
    const preview = await frame.executeJavaScript("({bridge:typeof window.labAPI, library:typeof window.docx, sections:document.querySelectorAll('section.docx').length, text:document.body.innerText.slice(0,80)})");
    assert.equal(preview.bridge, 'undefined');
    assert.equal(preview.library, 'object', 'normal DOCX renderer should run, not fallback');
    assert.ok(preview.sections > 0, JSON.stringify(preview));
    assert.ok(!messages.some(m => /Uncaught|Refused to load the script/.test(m)), messages.join('\n'));
    console.log('PASS: real isolated DOCX preview renders without preload bridge');
    console.log('Test artifacts: ' + root);
    app.exit(0);
  } catch (e) { console.error(e.stack); console.error(messages.join('\n')); console.error('Test profile: ' + root); app.exit(1); }
});
setTimeout(() => { console.error('Electron test deadline exceeded'); app.quit(); }, 180000).unref();
