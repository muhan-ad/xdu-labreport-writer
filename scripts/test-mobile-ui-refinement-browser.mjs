import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openBrowserTest} from './browser-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const experiment = '0ae99b58d017';
const sample = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/measurements.json'), 'utf8'))[experiment];
const browser = await openBrowserTest(root, '', '', {production: true});
const evaluate = browser.evaluate;
const navigate = async (route, selector) => {
  await evaluate(`location.hash = ${JSON.stringify(route)}`);
  await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`);
};
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

try {
  await browser.cdp('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await navigate('#/settings', '[data-settings-data-version]');
  await browser.wait(`document.querySelector('[data-settings-data-version]').textContent === '1.2.3'`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.version-actions a'), a => [a.textContent, a.getAttribute('href')])`), [
    ['检查更新', '#/app-updates'], ['检查更新', '#/data-updates'],
  ]);
  await click('.version-actions a[href="#/data-updates"]');
  await browser.wait(`!!document.querySelector('#data-update-host [data-update="restore"]')`);
  assert.equal(await evaluate(`document.querySelector('#data-update-host input[type="file"], #data-update-host [data-update="pick"]')`), null);

  await navigate('#/school-accounts/report', '#school-accounts-host');
  assert.equal(await evaluate(`!!document.querySelector('[data-account-field="system"]')`), false);
  assert.doesNotMatch(await evaluate(`document.querySelector('#school-accounts-host').innerText`), /加密存储尚未接入/);
  await navigate('#/portal/account', '#portal-password');
  assert.doesNotMatch(await evaluate(`document.querySelector('#portal-host').innerText`), /管理本机账号|本机账号未能读取|手动输入的密码仅用于本次登录/);

  const catalog = JSON.parse(fs.readFileSync('src/data/catalog.json', 'utf8')).experiments;
  const water = catalog.find(exp => exp.sourceId === '声速的测量（水中）').id;
  await navigate('#/experiment/' + water, '#field-L1');
  await evaluate(`document.querySelector('#field-L1').closest('details').querySelector('summary').click()`);
  const countWater = () => evaluate(`document.querySelectorAll('#field-L1 input[data-index]').length`);
  assert.equal(await countWater(), 10);
  await click('[data-resize="L1"][data-delta="1"]');
  assert.equal(await countWater(), 11);
  await click('[data-resize="L1"][data-delta="-1"]');
  assert.equal(await countWater(), 10);
  await navigate('#/experiment/80846705f12f', '[data-observation="polarizer_1_change"]');
  await evaluate(`(() => {
    const field = document.querySelector('[data-observation="polarizer_1_change"]');
    field.closest('details').querySelector('summary').click();
    field.value = '0';
    field.dispatchEvent(new Event('change', {bubbles: true}));
  })()`);
  await click('[data-action="save"]');
  await navigate('#/experiments', '#app');
  await navigate('#/experiment/80846705f12f', '[data-observation="polarizer_1_change"]');
  assert.equal(await evaluate(`document.querySelector('[data-observation="polarizer_1_change"]').value`), '0');

  await navigate('#/experiment/' + experiment, '#open-report');
  assert.equal(await evaluate(`document.querySelector('#open-report').textContent`), '生成报告');
  assert.doesNotMatch(await evaluate(`document.querySelector('#measurement-form').innerText`), /7 量 × 5 次/);
  assert.equal(await evaluate(`document.querySelectorAll('#measurement-form details[open]').length`), 0);
  const limitHelp = '[data-action="instrument-limit-help"]';
  await evaluate(`document.querySelector('${limitHelp}').closest('details').querySelector('summary').click()`);
  await click(limitHelp);
  const help = await evaluate(`document.querySelector('#modal[open] .modal-body').textContent`);
  assert.match(help, /最小分度值的一半/);
  assert.match(help, /游标卡尺和数字秒表.*限差为最小分度值/);
  await click('[data-dialog-confirm]');
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(sample))}], 'test.json', {type: 'application/json'}));
    const input = document.querySelector('#data-picker');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  })()`);
  await browser.wait(`document.querySelector('#modal').open`);
  await click('[data-dialog-confirm]');
  await browser.wait(`document.querySelector('#toast').textContent === '已导入并保存到本机'`);
  await click('#open-report');
  await browser.wait(`document.querySelector('#report-sheet').open`);
  await click('[data-report-tab="quiz"]');
  assert.ok(await evaluate(`!!document.querySelector('[data-question-boxes]')`));
  await evaluate(`(() => {
    const question = document.querySelector('.quiz-question-row input');
    question.value = '如何评定测量不确定度？';
    question.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await click('[data-report-tab="ai"]');
  assert.equal(await evaluate(`!!document.querySelector('#ai-questions')`), false);
  await click('[data-report-tab="quiz"]');
  assert.equal(await evaluate(`document.querySelector('.quiz-question-row input').value`), '如何评定测量不确定度？');
  await click('[data-report-tab="preview"]');
  try {
    await browser.wait(`document.querySelector('#report-preview-state')?.textContent === '预览已完成'`);
  } catch (error) {
    throw Error(await evaluate(`document.querySelector('#report-state')?.textContent`) + ' ' + error.message);
  }
  const preview = await evaluate(`(() => {
    const body = document.querySelector('#report-body');
    const frame = document.querySelector('#mobile-report-frame');
    body.scrollTop = body.scrollHeight;
    return {height: frame.offsetHeight, viewport: body.clientHeight, endVisible: frame.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1};
  })()`);
  assert.ok(preview.height > preview.viewport, JSON.stringify(preview));
  assert.equal(preview.endVisible, true);
  const tree = await browser.cdp('Page.getFrameTree');
  const child = tree.frameTree.childFrames?.find(({frame}) => frame.url.endsWith('/preview/index.html'));
  let sessionId;
  let executionContextId;
  if (child) {
    ({executionContextId} = await browser.cdp('Page.createIsolatedWorld', {frameId: child.frame.id, worldName: 'preview-layout-test'}));
  } else {
    const {targetInfos} = await browser.cdp('Target.getTargets');
    const target = targetInfos.find(item => item.type === 'iframe' && item.url.endsWith('/preview/index.html'));
    assert.ok(target, 'Sandbox preview frame is available for layout inspection');
    ({sessionId} = await browser.cdp('Target.attachToTarget', {targetId: target.targetId, flatten: true}));
  }
  const {result: scripts} = await browser.cdp('Runtime.evaluate', {
    contextId: executionContextId,
    returnByValue: true,
    expression: `Array.from(document.querySelectorAll('#paper math')).slice(0, 2).map(math =>
      Array.from(math.querySelector('msubsup').children, part => part.textContent.trim()))`,
  }, sessionId);
  assert.deepEqual(scripts.value, [['T', '0', '2'], ['T', '0', '2']]);
  const readPaper = async () => {
    const {result} = await browser.cdp('Runtime.evaluate', {
      contextId: executionContextId,
      returnByValue: true,
      expression: `(() => {
        const paper = document.querySelector('#paper');
        const box = paper.getBoundingClientRect();
        return {width: paper.offsetWidth, height: paper.offsetHeight, scale: box.width / paper.offsetWidth,
          left: box.left, available: document.querySelector('#report').clientWidth};
      })()`,
    }, sessionId);
    return result.value;
  };
  const layouts = [];
  for (const width of [390, 680, 1280]) {
    await browser.cdp('Emulation.setDeviceMetricsOverride', {width, height: 844, deviceScaleFactor: 1, mobile: true});
    const previousWidth = layouts.at(-1)?.available ?? 0;
    const isSettled = paper => paper.available > previousWidth &&
      Math.abs(paper.scale - Math.min(1, paper.available / paper.width)) < 0.001 &&
      Math.abs(paper.left - (paper.available - paper.width * paper.scale) / 2) < 1;
    let paper;
    for (let attempt = 0; attempt < 100; attempt++) {
      paper = await readPaper();
      if (isSettled(paper)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(isSettled(paper), JSON.stringify({width, paper}));
    layouts.push(paper);
  }
  assert.equal(new Set(layouts.map(paper => paper.width)).size, 1);
  assert.equal(new Set(layouts.map(paper => paper.height)).size, 1);
  assert.ok(layouts[0].scale < layouts[1].scale && layouts[1].scale < layouts[2].scale);
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({settings: true, fileImportRemoved: true, accounts: true, experimentTitle: true, separateQuiz: true, fullPreview: preview, paperLayouts: layouts}));
} finally {
  await browser.close();
}
