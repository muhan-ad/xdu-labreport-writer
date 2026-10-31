import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/ocr-point-removal-ui');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'tests/fixtures/ocr-correction-ui.ts','<main id="app"></main>');
const click=s=>b.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`),count=()=>b.evaluate("document.querySelectorAll('[data-ocr-edit=x]').length");
try {
 await b.evaluate("import('/test.mjs').then(async m=>{window.fixture=await m.createOCRCorrectionFixture()})");
 await click('[data-ai=recognize]');await b.wait("!!document.querySelector('[data-ocr-edit=x]')");
 await click('[data-ocr-resize=add]');assert.equal(await count(),4);
 await click('[data-ocr-resize=remove]');assert.equal(await count(),3);assert.equal(await b.evaluate("!!document.querySelector('[data-ocr-resize=confirm]')"),false);
 await click('[data-ocr-resize=add]');await b.evaluate("(()=>{const e=document.querySelector('[data-ocr-edit=y][data-row=\"1\"][data-col=\"3\"]');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))})()");
 await click('[data-ocr-resize=remove]');assert.equal(await count(),4);assert.equal(await b.evaluate("!!document.querySelector('[data-ocr-resize=confirm]')"),true);
 for(const width of [320,390,768,1024]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate("document.querySelector('.report-body').scrollWidth<=document.querySelector('.report-body').clientWidth+1"),true);const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}.png`),Buffer.from(shot.data,'base64'));}
 await click('[data-ocr-resize=cancel]');assert.equal(await count(),4);assert.equal(await b.evaluate("document.querySelector('[data-ocr-edit=y][data-row=\"1\"][data-col=\"3\"]').value"),'0');
 await click('[data-ocr-resize=remove]');await click('[data-ocr-resize=confirm]');assert.equal(await count(),3);assert.equal(await b.evaluate("document.querySelectorAll('[data-ocr-edit=y]').length"),6);
 assert.equal((await b.evaluate('fixture.state()')).applies,0);assert.equal(b.errors.length,0);
 console.log(JSON.stringify({passed:4,scope:'actual OCR review dialog, mock vision and save; no real model call'}));
} finally {await b.close();}
