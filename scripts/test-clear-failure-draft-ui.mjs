import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openBrowserTest} from './browser-test-harness.mjs';
const b=await openBrowserTest(process.cwd(),'tests/fixtures/measurement-recovery-ui.ts','<main id="app"></main>');
try{
 await b.evaluate("import('/test.mjs').then(async m=>{window.fixture=m;await m.start();return true})");
 await b.wait("!!document.querySelector('[data-open]')");await b.evaluate("document.querySelector('[data-open]').click()");await b.wait("!!document.querySelector('input.measurement')");
 await b.evaluate("fixture.blockWrites(true);const e=document.querySelector('input.measurement');e.value='42.17';e.dispatchEvent(new Event('input',{bubbles:true}))");
 await b.wait("document.querySelector('#save-state').textContent.includes('保存失败')");
 await b.evaluate("document.querySelector('[data-action=more]').click()");await b.wait("document.querySelector('#modal').open");await b.evaluate("document.querySelector('[data-menu=clear]').click()");await b.wait("document.querySelector('#modal-title').textContent.includes('清除')");await b.evaluate("document.querySelector('[data-dialog-confirm]').click()");
 await b.wait("document.querySelector('#toast').textContent.includes('清除未完成')");
 assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'42.17');
 assert.equal(await b.evaluate("document.querySelector('fieldset').disabled"),false);
 await b.evaluate("fixture.blockWrites(false);document.querySelector('[data-action=save]').click()");await b.wait("document.querySelector('#save-state').textContent.includes('已保存')");
 await b.evaluate("location.hash='#/home'");await b.wait("!!document.querySelector('[data-open]')");await b.evaluate("document.querySelector('[data-open]').click()");await b.wait("!!document.querySelector('input.measurement')");
 assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'42.17');assert.equal(b.errors.length,0);
 fs.writeFileSync('artifacts/verification/clear-failure-draft-ui.json',JSON.stringify({checks:['failed clear preserves editable unsaved draft','retry save restores exact draft after reopening'],scope:'actual UI and isolated browser storage; injected silent write failure'},null,2));console.log(JSON.stringify({passed:2}));
}finally{await b.close();}
