import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openBrowserTest} from './browser-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const groups = JSON.parse(fs.readFileSync(path.join(root, 'src/data/school-faq.json'), 'utf8'));
const browser = await openBrowserTest(root, '', '', {production: true});
try {
  await browser.cdp('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await browser.evaluate("location.hash = '#/portal/faq'");
  await browser.wait("!!document.querySelector('[data-help-question]')");
  const page = await browser.evaluate(`(() => {
    const host = document.querySelector('#portal-faq-host');
    const card = host.querySelector('.help-question');
    const groups = host.querySelectorAll('.help-card-group');
    return {
      count: host.querySelectorAll('.help-question').length,
      fullCard: card.getBoundingClientRect().width === card.parentElement.getBoundingClientRect().width && getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)',
      gap: groups[1].getBoundingClientRect().top - groups[0].getBoundingClientRect().bottom,
      obsolete: !!host.querySelector('[data-help-sound], details') || host.textContent.includes('以下为原版经验问答'),
    };
  })()`);
  assert.deepEqual(page, {count: groups.flatMap(group => group.items).length, fullCard: true, gap: 32, obsolete: false});
  for (let g = 0; g < groups.length; g++) {
    for (let i = 0; i < groups[g].items.length; i++) {
      const item = groups[g].items[i];
      const opened = await browser.evaluate(`(() => {
        document.querySelector('[data-help-question="${g}:${i}"]').click();
        return [document.querySelector('#modal').open, document.querySelector('#modal-title').textContent, document.querySelector('#modal .help-answer').textContent];
      })()`);
      assert.deepEqual(opened, [true, item.question, item.answer]);
      await browser.evaluate("document.querySelector('#modal .modal-actions [data-dialog-close]').click()");
      assert.equal(await browser.evaluate("document.querySelector('#modal').open"), false);
    }
  }
  for (const [group, title] of [['guide','生成实验报告'], ['faq','未填写／未填写完整'], ['notice','报告检查']]) {
    const state = await browser.evaluate(`(() => {
      document.querySelector('[data-help-group="${group}"]').click();
      const card = document.querySelector('.help-question');
      card.click();
      const modal = document.querySelector('#modal');
      const answer = modal.querySelector('.help-answer');
      const footer = modal.querySelector('.modal-actions');
      const close = footer.querySelector('[data-dialog-close]');
      return {
        title: modal.querySelector('h2').textContent, open: modal.open, hasText: !!answer.textContent,
        footerBorder: getComputedStyle(footer).borderTopWidth, closeBorder: getComputedStyle(close).borderTopWidth,
        larger: parseFloat(getComputedStyle(answer).fontSize) > parseFloat(getComputedStyle(modal).fontSize),
      };
    })()`);
    assert.deepEqual(state, {title, open: true, hasText: true, footerBorder: '0px', closeBorder: '0px', larger: true});
    await browser.evaluate("document.querySelector('#modal .modal-actions [data-dialog-close]').click()");
  }
  assert.equal(await browser.evaluate("performance.getEntriesByType('resource').some(entry => entry.name.includes('/guide-audio/'))"), false);
  console.log('FAQ popup, full cards, spacing and no audio verified');
} finally {
  await browser.close();
}
