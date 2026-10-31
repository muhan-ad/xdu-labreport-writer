import assert from 'node:assert/strict';
import path from 'node:path';
import { openBrowserTest } from './browser-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const browser = await openBrowserTest(root, 'tests/fixtures/filter-account-race.ts', '<main id="app"></main>');
try {
  await browser.evaluate("import('/test.mjs').then(m=>{window.fixture=m.createFixture()})");
  await browser.evaluate("fixture.begin('111111');fixture.begin('222222');fixture.begin('111111')");
  await browser.evaluate('fixture.finish(2,true,false)');
  assert.equal(await browser.evaluate('fixture.applied().recommendedTeachers'), true);
  await browser.evaluate('fixture.finish(0,false,true);fixture.finish(1,false,true)');
  assert.equal(await browser.evaluate('fixture.applied().recommendedTeachers'), true);
  assert.equal(await browser.evaluate('fixture.applied().recommendedExperiments'), false);
  await browser.evaluate("fixture.begin('111111');fixture.close();fixture.finish(3,false,true)");
  assert.equal(await browser.evaluate('fixture.applied().recommendedExperiments'), false);
  await browser.evaluate("fixture.begin('111111');fixture.finish(4,true,false);fixture.open();document.querySelector('[data-filter-action=experiments]').click()");
  await browser.evaluate("fixture.begin('222222');fixture.begin('111111');fixture.finish(6,true,false);fixture.open();document.querySelector('[data-filter-action=experiments]').click();fixture.scan(1,'新目录');fixture.scan(0,'旧目录')");
  assert.equal(await browser.evaluate("document.querySelector('#filter-directory-status').textContent"), '新目录');
  await browser.evaluate("fixture.close();fixture.begin('111111');fixture.open();document.querySelector('[data-filter=recommendedTeachers]').click();document.querySelector('[data-filter-action=apply]').click()");
  await browser.wait('fixture.applied().recommendedTeachers');
  await browser.evaluate('fixture.finish(7,false,true)');
  assert.equal(await browser.evaluate('fixture.applied().recommendedTeachers'), true);
  assert.equal(await browser.evaluate('fixture.applied().recommendedExperiments'), false);
  assert.equal(browser.errors.length, 0);
  console.log(JSON.stringify({passed: 4, scope: 'delayed preference reads, applied drafts and directory callbacks; no school requests'}));
} finally { await browser.close(); }
