import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openBrowserTest} from './browser-test-harness.mjs';

const b=await openBrowserTest(process.cwd(),'tests/fixtures/measurement-recovery-ui.ts','<main id="app"></main>');
try {
 await b.evaluate("import('/test.mjs').then(async m=>{window.fixture=m;await m.start();return true})");
 await b.wait("!!document.querySelector('[data-open]')");
 await b.evaluate("document.querySelector('[data-open]').click()");
 await b.wait("!!document.querySelector('input.measurement')");
 await b.evaluate("fixture.pauseNextRecordRead();const e=document.querySelector('input.measurement');e.value='12.34';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action=save]').click()");
 await b.wait('fixture.isReadPaused()');
 await b.evaluate("document.querySelector('[data-action=save]').click();document.querySelector('[data-action=more]').click()");
 await b.wait("document.querySelector('#modal').open");
 await b.evaluate("document.querySelector('[data-menu=clear]').click()");
 await b.wait("document.querySelector('#modal-title').textContent.includes('清除')");
 await b.evaluate("document.querySelector('[data-dialog-confirm]').click()");
 await b.wait("!document.querySelector('#modal').open");
 await b.evaluate('fixture.releaseRead()');
 await b.wait("document.querySelector('#toast').textContent.includes('已清除')");
 assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'');
 await b.evaluate("location.hash='#/home'");
 await b.wait("!!document.querySelector('[data-open]')");
 await b.evaluate("document.querySelector('[data-open]').click()");
 await b.wait("!!document.querySelector('input.measurement')");
 assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'');
 assert.equal(b.errors.length,0);
 fs.writeFileSync('artifacts/verification/clear-save-race-ui.json',JSON.stringify({scope:'actual page with delayed local test storage, no school or model calls',checks:['two in-flight and queued saves invalidated by clear','cleared input remains blank after reopening']},null,2));
 console.log(JSON.stringify({passed:2}));
} finally {await b.close();}
