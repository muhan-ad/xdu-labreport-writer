import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),exp=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments.find(e=>e.sourceId==='直螺线管磁场分布的测量'),out=path.join(root,'artifacts/verification/chart-width-production');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'src/main.ts','<main id="app"></main>',{production:true}),checks=[];
try{
 await b.wait(`!!document.querySelector('[data-open="${exp.id}"]')`);await b.evaluate(`document.querySelector('[data-open="${exp.id}"]').click()`);await b.wait("!!document.querySelector('[data-action=report]')");await b.evaluate("document.querySelector('[data-action=report]').click()");await b.wait("!!document.querySelector('[data-report-tab=charts]')");await b.evaluate("document.querySelector('[data-report-tab=charts]').click()");await b.wait("!!document.querySelector('[data-official=widthCm]')");
 await b.evaluate("document.querySelector('.manual-plot').open=true");await b.wait("getComputedStyle(document.querySelector('.report-sheet')).transform==='none'");
 for(const selector of ['[data-official=widthCm]','[data-chart-field=widthCm]','[data-ai-plot-field=widthCm]'])assert.equal(await b.evaluate(`document.querySelector('${selector}').value`),'14');
 checks.push('actual compressed application exposes independent default widths for preset, manual and AI plots');
 for(const [selector,action]of [['[data-official=widthCm]','official-save'],['[data-chart-field=widthCm]','save']]){
  await b.evaluate(`(()=>{const e=document.querySelector('${selector}');e.value='21';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-chart=${action}]').click()})()`);
  await b.wait("document.querySelector('#report-state').textContent.includes('4–20')");
 }
 checks.push('production save handlers reject out-of-range widths before chart generation');
 for(const [width,height]of [[320,568],[390,844],[568,320],[768,1024],[1024,768]]){
  await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,200));assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  for(const selector of ['[data-official=widthCm]','[data-chart-field=widthCm]','[data-ai-plot-field=widthCm]'])assert.ok(await b.evaluate(`(()=>{const e=document.querySelector('${selector}'),r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})()`));
  await b.evaluate("document.querySelector('[data-official=widthCm]').scrollIntoView({block:'center'})");await new Promise(r=>setTimeout(r,150));const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));
 }
 checks.push('all three width fields fit five real application phone, landscape and tablet layouts');
 assert.deepEqual(b.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await b.close();}
