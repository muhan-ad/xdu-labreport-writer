import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {openBrowserTest} from './browser-test-harness.mjs';

const root=path.resolve(import.meta.dirname,'..'),catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'),'utf8'));
const output=path.join(root,'artifacts/verification/preparation-fallback-ui');fs.mkdirSync(output,{recursive:true});
const id=name=>catalog.experiments.find(e=>e.name===name).id;
const b=await openBrowserTest(root,'src/main.ts','<main id="app"></main>');
const open=async name=>{await b.evaluate(`location.hash=${JSON.stringify('#/experiment/'+id(name))}`);await b.wait("!!document.querySelector('[data-action=prepare]')");};
try {
  await b.evaluate("window.__opens=[];window.open=(...args)=>{window.__opens.push(args);return null};import('/test.mjs').then(()=>true)");
  await b.wait("!!document.querySelector('[data-open]')");
  await open('劈尖干涉');await b.evaluate("document.querySelector('[data-action=prepare]').click()");
  await b.wait("document.querySelector('#modal').open");
  assert.match(await b.evaluate("document.querySelector('#modal').textContent"),/暂未匹配/);
  for(const width of [320,390,768,1024]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate("document.querySelector('#modal').scrollWidth<=document.querySelector('#modal').clientWidth+1"),true);let png=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`fallback-${width}.png`),Buffer.from(png.data,'base64'));}
  await b.evaluate("document.querySelector('#modal [data-dialog-close]').click()");
  assert.equal(await b.evaluate('__opens.length'),0);
  await b.evaluate("document.querySelector('[data-action=prepare]').click();document.querySelector('#modal [data-dialog-confirm]').click()");
  await b.wait('__opens.length===1');assert.equal(await b.evaluate('__opens[0][0]'),'https://wlsyzx.xidian.edu.cn/expe/index.html');
  await open('光的偏振特性测量（第二学期）');await b.evaluate("document.querySelector('[data-action=prepare]').click()");await b.wait('__opens.length===2');
  assert.equal(await b.evaluate('__opens[1][0]'),'https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=5');
  assert.equal(await b.evaluate("document.querySelector('#modal').open"),false);
  assert.equal(b.errors.length,0);console.log(JSON.stringify({passed:4,scope:'production app UI with window.open stub; no external navigation'}));
} finally {await b.close();}
