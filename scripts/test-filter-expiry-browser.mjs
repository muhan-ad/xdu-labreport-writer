import assert from 'node:assert/strict';
import path from 'node:path';
import {openBrowserTest} from './browser-test-harness.mjs';

const browser = await openBrowserTest(path.resolve(import.meta.dirname,'..'), 'tests/fixtures/filter-expiry-ui.ts', '<main id="app"><div id="portal-host"></div></main>');
try {
  await browser.evaluate("import('/test.mjs').then(m=>{window.fixture=m.createExpiryFixture()})");
  await browser.evaluate("document.querySelector('[data-portal=filters]').click();document.querySelector('[data-filter-action=experiments]').click()");
  await browser.wait("document.querySelectorAll('[data-candidate]').length===3");
  await browser.evaluate("document.querySelector('[data-candidate=\"即将开始甲\"]').click();document.querySelector('[data-candidate=\"即将开始甲\"]').focus()");
  await browser.wait("!document.querySelector('[data-candidate=\"即将开始乙\"]')");
  assert.equal(await browser.evaluate("document.querySelector('[data-candidate=\"即将开始甲\"]').checked"), true);
  assert.equal(await browser.evaluate("document.activeElement?.dataset.candidate"), '即将开始甲');
  assert.match(await browser.evaluate("document.querySelector('[data-candidate=\"即将开始甲\"]').closest('label').textContent"), /当前不在已读取的候选列表中/);
  assert.ok(await browser.evaluate("!!document.querySelector('[data-candidate=\"晚间实验\"]')"));
  await browser.evaluate("document.querySelector('[data-filter-action=confirm]').click();document.querySelector('[data-filter-action=teachers]').click()");
  await browser.wait("!!document.querySelector('[data-candidate=\"教师甲\"]')");
  const teacher = await browser.evaluate("document.querySelector('[data-candidate=\"教师甲\"]').closest('label').textContent");
  assert.match(teacher, /晚间实验/);assert.doesNotMatch(teacher, /即将开始/);
  await browser.evaluate("document.querySelector('[data-filter-action=cancel]').click();document.querySelector('[data-filter-action=apply]').click()");
  await browser.wait("!document.querySelector('#course-filters').open");
  assert.equal(browser.errors.length,0);
  console.log(JSON.stringify({passed:6,scope:'actual portal timer and filter popup, simulated school data; no course actions'}));
} finally {await browser.close();}
