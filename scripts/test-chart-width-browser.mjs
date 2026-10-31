import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/chart-width-ui');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'tests/fixtures/chart-width-ui.ts','<main id="app"><div id="plot-host"></div></main>'),checks=[];
const input=(selector,value)=>b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const click=selector=>b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),wait=()=>b.wait('!fixture.state().busy');
try{
 await b.evaluate("import('/test.mjs').then(async m=>{window.fixture=await m.createChartWidthFixture();return true})");
 await click('[data-report-tab=charts]');await b.wait("!!document.querySelector('[data-official=widthCm]')");
 assert.equal(await b.evaluate("document.querySelector('[data-official=widthCm]').value"),'14');
 await input('[data-official=widthCm]',20);await click('[data-chart=official-save]');await wait();assert.equal((await b.evaluate('fixture.settings()')).officialCharts.widthCm,20);
 await b.evaluate("document.querySelector('.manual-plot').open=true");await input('[data-chart-field=widthCm]',4);await click('[data-chart=save]');await wait();assert.equal((await b.evaluate('fixture.settings()')).customCharts[0].widthCm,4);
 await b.evaluate('fixture.reopen()');await click('[data-report-tab=charts]');await b.wait("!!document.querySelector('[data-official=widthCm]')");
 assert.equal(await b.evaluate("document.querySelector('[data-official=widthCm]').value"),'20');await b.evaluate("document.querySelector('.manual-plot').open=true");await click('[data-chart=edit]');assert.equal(await b.evaluate("document.querySelector('[data-chart-field=widthCm]').value"),'4');
 checks.push('preset and manual widths persist independently and reopen through actual report settings');
 for(const [selector,button]of [['[data-official=widthCm]','[data-chart=official-save]'],['[data-chart-field=widthCm]','[data-chart=save]']]){
  const before=await b.evaluate('fixture.settings()');for(const value of ['',3,21]){await input(selector,value);await click(button);await wait();assert.deepEqual(await b.evaluate('fixture.settings()'),before);assert.match(await b.evaluate("document.querySelector('#report-state').textContent"),/4–20/);}
 }
 checks.push('blank and out-of-range widths never replace saved manual or preset preferences');
 await b.evaluate('fixture.ai()');await input('[data-ai-plot-field=requirement]','两张图');
 await input('[data-ai-plot-field=widthCm]',21);await click('[data-ai-plot=generate]');await wait();assert.equal((await b.evaluate('fixture.state()')).asks,0);assert.match(await b.evaluate("document.querySelector('.ai-plot-state').textContent"),/4–20/);
 await input('[data-ai-plot-field=widthCm]',7.5);await click('[data-ai-plot=generate]');await wait();await click('[data-ai-plot=preview]');await wait();await click('[data-ai-plot=adopt]');await wait();
 assert.equal((await b.evaluate('fixture.settings()')).aiPlot.widthCm,7.5);assert.equal((await b.evaluate('fixture.settings()')).aiPlot.figures.length,2);
 await b.evaluate('fixture.ai()');await b.wait("document.querySelector('.ai-plot-state').textContent==='已采用此图'");assert.equal(await b.evaluate("document.querySelector('[data-ai-plot-field=widthCm]').value"),'7.5');
 checks.push('AI group width rejects invalid values before asking, applies to all figures and restores adopted configuration');
 for(const [width,height]of [[320,568],[390,844],[568,320],[768,1024],[1024,768]]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);const shot=await b.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));}
 checks.push('AI width field fits phone, short landscape and tablet sizes');
 assert.deepEqual(b.errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await b.close();}
