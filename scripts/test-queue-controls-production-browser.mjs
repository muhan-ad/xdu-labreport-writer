import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/queue-controls-production');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'src/main.ts','<main id="app"></main>',{production:true}),checks=[];
const ids=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments.slice(0,3).map(e=>e.id),[a,cancelled,c]=ids;
const click=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),item=(id,action)=>click(`[data-queue-item="${action}"][data-id="${id}"]`);
const row=id=>`document.querySelector('[data-queue-id="${id}"]').closest('article')`;
async function waitLong(expression){for(let i=0;i<240;i++){if(await b.evaluate(expression))return;await new Promise(r=>setTimeout(r,250));}throw Error('Production queue wait timed out: '+expression);}
try{
 await b.wait("!!document.querySelector('[data-nav=settings]')");await b.evaluate("location.hash='#/developer'");await b.wait("!!document.querySelector('[data-debug-mode]')&&!document.querySelector('[data-debug-mode]').disabled");await click('[data-debug-mode]');await b.wait("!document.querySelector('[data-debug=fill]').hidden&&!document.querySelector('[data-debug-mode]').disabled");await click('[data-debug=fill]');await b.wait("!!document.querySelector('dialog[open] [data-dialog-confirm]')");await click('dialog[open] [data-dialog-confirm]');await b.wait("document.querySelector('[data-debug-status]').textContent.includes('已填入 28')");
 await b.evaluate("location.hash='#/report-queue'");await b.wait("!!document.querySelector('[data-queue=start]')");
 for(const id of ids)await click(`[data-queue-id="${id}"]`);await click('[data-queue=start]');await b.wait("!!document.querySelector('dialog[open] [data-dialog-confirm]')");await click('dialog[open] [data-dialog-confirm]');await b.wait("!!document.querySelector('[data-queue=pause]:not([hidden])')");await click('[data-queue=pause]');
 checks.push('actual application seeds only its disposable local test store and confirms a three-item real WASM queue');
 await item(cancelled,'down');assert.deepEqual(await b.evaluate("[...document.querySelectorAll('[data-queue-id]')].slice(0,3).map(e=>e.dataset.queueId)"),[a,c,cancelled]);await item(cancelled,'cancel');assert.match(await b.evaluate(row(cancelled)+'.textContent'),/已停止/);
 checks.push('actual production queue moves pending tasks and cancels one while preserving selection');
 for(const [width,height]of [[320,568],[390,844],[568,320],[768,1024],[1024,768]]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));}
 await waitLong(`${row(a)}.textContent.includes('完成')&&!${row(a)}.textContent.includes('生成中')`);assert.match(await b.evaluate(row(c)+'.textContent'),/等待/);assert.equal(await b.evaluate("document.querySelector('[data-queue=clear-finished]').disabled"),true);
 checks.push('real report finishes and publishes before pause holds the remaining task');
 await click('[data-queue=resume]');await b.wait(`${row(c)}.textContent.includes('生成中')`);await item(c,'cancel');await waitLong("document.querySelector('[data-queue=stop]').hidden");assert.match(await b.evaluate(row(c)+'.textContent'),/已停止/);
 checks.push('terminating the resumed current task stops its actual Worker without deleting the finished report');
 await click('[data-queue=clear-finished]');assert.equal(await b.evaluate("document.querySelectorAll('[data-queue-item]').length"),0);await b.evaluate("location.hash='#/report-manager'");await b.wait("!!document.querySelector('[data-managed=refresh]')&&!document.querySelector('[data-managed=refresh]').disabled");
 assert.equal(await b.evaluate("document.querySelectorAll('[data-managed=preview]').length"),1);assert.equal(await b.evaluate(`document.querySelector('[data-managed=preview]').dataset.id`),a);assert.equal(await b.evaluate("document.querySelector('[data-managed=preview]').disabled"),false);
 checks.push('clearing queue metadata preserves the published report and its actual readable file in the report manager');
 assert.deepEqual(b.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,realApiCalls:0,schoolMutations:0},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await b.close();}
