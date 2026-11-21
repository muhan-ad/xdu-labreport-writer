import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openBrowserTest} from './browser-test-harness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const report = process.argv[2] ?? path.join(root, 'artifacts/report-tests/formula-layout/afcba21152b7.docx');
const base64 = fs.readFileSync(report).toString('base64');
const browser = await openBrowserTest(root, '', '', {production: true});
try {
  await browser.evaluate(`(() => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:fixed;inset:0;z-index:1000;width:390px;height:600px';
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'report-preview-ready') {
        const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), char => char.charCodeAt(0)).buffer;
        window.previewStart = performance.now();
        frame.contentWindow.postMessage({type:'report-preview',bytes,token:'pdf-check'}, '*');
      } else if (event.data?.token === 'pdf-check') {
        if (event.data.type === 'report-preview-result') { window.previewResult = event.data; window.previewFullMs = performance.now() - window.previewStart; }
        if (event.data.type === 'report-preview-size') { window.previewSize = event.data.height; window.previewFirstMs ??= performance.now() - window.previewStart; }
      }
    });
    frame.src = '/preview/index.html';
    document.body.append(frame);
    window.testPreview = frame;
  })()`);
  await browser.wait('!!window.previewResult');
  assert.equal(await browser.evaluate('window.previewResult.ok'), true);
  await browser.wait('window.previewSize > 1000');
  const narrow = await browser.evaluate('window.previewSize');
  await browser.evaluate('testPreview.style.width = "680px"');
  await browser.wait(`window.previewSize > ${narrow}`);
  const wide = await browser.evaluate('window.previewSize');
  assert.ok(Math.abs(wide / narrow - 680 / 390) < 0.1);
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({pdfPreview: true, narrow, wide, ...(await browser.evaluate('({firstMs:Math.round(previewFirstMs),fullMs:Math.round(previewFullMs)})'))}));
} finally {
  await browser.close();
}
