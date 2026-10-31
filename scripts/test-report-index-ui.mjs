import fs from 'node:fs';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const out='artifacts/verification/report-index-ui-0.112.0';fs.mkdirSync(out,{recursive:true});const b=await openBrowserTest(process.cwd(),'tests/fixtures/report-index-ui.ts','<main id="app"></main>');
try{
 await b.evaluate("import('/test.mjs').then(m=>{window.fixture=m.createReportIndexFixture();return true})");
 await b.wait("document.querySelector('#report-manager-status')?.textContent.includes('0 份')");
 assert.match(await b.evaluate("document.querySelector('#report-manager-status').textContent"),/0 份可读取报告 · 1 项未核实/);
 assert.match(await b.evaluate("document.querySelector('.managed-report').innerText"),/报告索引无法读取，应用未删除报告文件/);
 assert.deepEqual(await b.evaluate('fixture.values()'),['broken','broken']);
 for(const [width,height] of [[320,568],[568,320],[768,1024]]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);let screenshot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+'/'+width+'x'+height+'.png',Buffer.from(screenshot.data,'base64'));}
 assert.equal(b.errors.length,0);fs.writeFileSync(out+'/results.json',JSON.stringify({passed:1,scope:'actual report manager, mock corrupt index and in-memory repository; no user data'},null,2));console.log(JSON.stringify({passed:1,out}));
}finally{await b.close();}
