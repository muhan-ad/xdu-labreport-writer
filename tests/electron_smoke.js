'use strict';
// Launch with Electron. Uses a fresh user profile and only its own Word instance.
const { app, BrowserWindow, shell } = require('electron');
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
    await until(() => evaluate('typeof experiments !== "undefined" && experiments.length === 27').catch(() => false));
    assert.ok(contents.getURL().startsWith('file:'), 'preserve existing localStorage origin across upgrade');
    // Validate the preparation shortcut without opening the user's actual browser.
    const network = require('../src/main/network'), originalLookup = network.lookup, originalOpen = shell.openExternal;
    const openedUrls = [], preparationUrl = 'https://wlsyzx.xidian.edu.cn/expe/index.html';
    let releaseLaunch;
    try {
      network.lookup = (host, options, callback) => host === 'wlsyzx.xidian.edu.cn'
        ? callback(null, [{ address: '211.70.0.1', family: 4 }]) : originalLookup(host, options, callback);
      shell.openExternal = async url => { openedUrls.push(url); await new Promise(resolve => { releaseLaunch = resolve; }); };
      await evaluate("document.getElementById('btnExperimentPreparation').click()");
      await until(() => openedUrls.length === 1);
      await evaluate("document.getElementById('btnExperimentPreparation').click()");
      assert.deepEqual(openedUrls, [preparationUrl]);
      releaseLaunch();
      await until(() => evaluate("!document.getElementById('btnExperimentPreparation').disabled"));
      const main = BrowserWindow.getAllWindows()[0], oldSize = main.getSize();
      for (const width of [1200, 900]) {
        main.setSize(width, 800); await delay(100);
        const layout = await evaluate(`(() => { const p=document.getElementById('btnExperimentPreparation').getBoundingClientRect(),
          s=document.getElementById('btnOpenSchoolPortal').getBoundingClientRect(); return {
            before:p.right<=s.left,visible:p.width>0&&p.top>=0&&s.right<=innerWidth,
            overflow:document.querySelector('.school-portal-entry').scrollWidth>document.querySelector('.school-portal-entry').clientWidth}; })()`);
        assert.deepEqual(layout, { before: true, visible: true, overflow: false }, 'homepage buttons fit at width ' + width);
        const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(root, 'preparation-homepage-' + width + '.png'), image.toPNG());
      }
      main.setSize(...oldSize);
      shell.openExternal = async () => { throw Error('TEST browser launch failure'); };
      await evaluate("document.getElementById('btnExperimentPreparation').onclick()");
      assert.equal(await evaluate("document.body.innerText.includes('实验预习网站未打开')"), true);
      assert.equal(await evaluate("document.getElementById('btnExperimentPreparation').disabled"), false);
    } finally { network.lookup = originalLookup; shell.openExternal = originalOpen; }
    console.log('PASS: preparation shortcut URL, left placement, narrow layout, repeat-click guard and failure feedback');
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
    console.log('PASS: real Electron -> saved OCR photo -> Python report generation (Word-free)');
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
    // 设置重排：在隔离配置中验证真实按钮、模块归属、章节保存和布局。
    await evaluate("document.getElementById('btnCloseUpdateModal').click(); document.getElementById('btnSettings').click()");
    const settingsLayout = await evaluate(`({
      firstNav: document.querySelector('.settings-nav > button').id,
      activePane: document.querySelector('.settings-pane.active').id,
      skillsParent: document.getElementById('paneSkills').closest('.settings-pane').id,
      customParent: document.getElementById('paneCustomVariants').closest('.settings-pane').id,
      sectionsParent: document.getElementById('secCfgList').closest('.settings-pane').id,
      oldNavigation: !!document.getElementById('btnNavSkills') || !!document.getElementById('btnNavCustomVariants'),
      uniqueIds: (() => { const ids = [...document.querySelectorAll('[id]')].map(el => el.id); return new Set(ids).size === ids.length; })(),
    })`);
    assert.deepEqual(settingsLayout, { firstNav: 'btnNavNotice', activePane: 'paneNotice',
      skillsParent: 'paneAi', customParent: 'paneReports', sectionsParent: 'paneReports',
      oldNavigation: false, uniqueIds: true });
    const screenshotDir = path.join(root, 'settings-screenshots');
    fs.mkdirSync(screenshotDir);
    const capture = async name => {
      await delay(250);
      const win = BrowserWindow.getAllWindows()[0];
      const rect = await evaluate(`(() => { const r = document.querySelector('#settingsModal .modal').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()`);
      const image = await win.webContents.capturePage(rect, { stayHidden: true, stayAwake: true });
      assert.ok(!image.isEmpty(), 'settings screenshot must contain pixels');
      fs.writeFileSync(path.join(screenshotDir, name + '.png'), image.toPNG());
    };
    await capture('notice');
    await evaluate("document.getElementById('btnNavAi').click(); document.getElementById('btnAiModuleSkills').click()");
    await until(() => evaluate("document.querySelector('#skillList .skill-row, #skillList .skill-empty') !== null"), 10000);
    assert.equal(await evaluate("document.getElementById('paneSkills').hidden"), false);
    assert.equal(await evaluate("document.getElementById('paneAiConfig').hidden"), true);
    await capture('skills');
    await evaluate("document.getElementById('btnAiModuleSkills').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    assert.equal(await evaluate("document.getElementById('paneAiConfig').hidden"), false, 'keyboard wraps to service configuration');
    await evaluate("document.getElementById('btnOpenApiConfig').click()");
    assert.equal(await evaluate("document.getElementById('panelApiConfig').hidden"), false);
    await evaluate("document.getElementById('btnOpenVisionConfig').click()");
    assert.equal(await evaluate("document.getElementById('panelApiConfig').hidden"), true);
    assert.equal(await evaluate("document.getElementById('panelVisionConfig').hidden"), false);
    await capture('ai-service');
    await evaluate("document.getElementById('btnNavReports').click()");
    await until(() => evaluate("document.querySelector('#reportsList .report-row') !== null"), 10000);
    await capture('reports');
    await evaluate("document.getElementById('btnReportModuleCustom').click()");
    await until(() => evaluate("document.getElementById('customVariantExpList').children.length > 0"));
    assert.equal(await evaluate("getComputedStyle(document.getElementById('btnDeleteAllReports')).display === 'none' || document.getElementById('btnDeleteAllReports').offsetParent === null"), true);
    await capture('custom-variants');
    await evaluate("document.getElementById('btnReportModuleSections').click()");
    await until(() => evaluate("document.querySelectorAll('#secCfgList input').length > 0"));
    await capture('section-variants');
    const disabledSection = await evaluate("(() => { const box = document.querySelector('#secCfgList input'); box.checked = false; return box.dataset.section; })()");
    await evaluate("document.getElementById('btnSaveSecCfg').onclick()");
    const sectionConfig = await evaluate("window.labAPI.readSectionsConfig(document.getElementById('secCfgExpSel').value)");
    assert.ok(sectionConfig.ok && sectionConfig.disabled.includes(disabledSection));
    await evaluate("document.getElementById('btnNavDevelop').click()");
    assert.equal(await evaluate("document.querySelector('#paneDevelop #secCfgList') === null"), true);
    await evaluate("document.getElementById('btnNavUpdate').click()");
    await until(() => evaluate("document.getElementById('inputCurrentVersion').textContent !== '—'"));
    assert.equal(await evaluate("document.querySelectorAll('#paneUpdate .update-card').length"), 3);
    // 离线 / 最新 / 新版本仅变更状态呈现，不触发网络或下载。
    await evaluate("updateCheckResults.set('app',{ok:true,hasUpdate:false}); showUpdateCheckStatus('app',{ok:true,hasUpdate:false}); updateCheckResults.set('data',{ok:true,hasUpdate:true,remoteVersion:'1.1.0'}); showUpdateCheckStatus('data',{ok:true,hasUpdate:true,remoteVersion:'1.1.0'})");
    await capture('updates');
    await evaluate("showUpdateCheckStatus('app',{ok:false,error:'网络暂不可用，可稍后重试'})");
    await capture('updates-offline');
    const overflow = await evaluate("(() => { const pane=document.querySelector('.settings-panes');return pane.scrollWidth > pane.clientWidth + 1; })()");
    assert.equal(overflow, false, 'settings must not overflow horizontally');
    await evaluate("document.getElementById('btnCloseSettings').click()");
    console.log('PASS: settings grouping, keyboard tabs, section persistence, update cards and screenshots');
    assert.ok(!messages.some(m => /Uncaught|Refused to load the script/.test(m)), messages.join('\n'));
    console.log('Test artifacts: ' + root);
    app.exit(0);
  } catch (e) { console.error(e.stack); console.error(messages.join('\n')); console.error('Test profile: ' + root); app.exit(1); }
});
setTimeout(() => { console.error('Electron test deadline exceeded'); app.quit(); }, 180000).unref();
