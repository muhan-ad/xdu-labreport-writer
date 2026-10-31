import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/ocr-variable-rows-ui');
fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'tests/fixtures/ocr-variable-rows-ui.ts','<main id="app"></main>'),checks=[];
try{
 for(let index=0;index<3;index++){
  await b.evaluate(`import('/test.mjs').then(m=>{window.fixture?.leave();window.fixture=m.createPartialRowsFixture(${index});return true;})`);
  const state=await b.evaluate('({rows:fixture.rows,cols:fixture.cols,measured:fixture.measured,values:fixture.values()})');
  assert.equal(state.values.length,state.rows);
  assert.equal(await b.evaluate("document.querySelectorAll('[data-ocr-edit]').length"),state.rows*state.cols);
  assert.equal(await b.evaluate("[...document.querySelectorAll('[data-ocr-edit]')].filter(e=>e.value!=='').length"),state.measured*state.cols);
  assert.ok(state.values.slice(state.measured).flat().every(n=>n===null));
  checks.push('partial actual catalog matrix '+index+' remains editable with blank unused capacity');
 }
 for(const width of [320,360,390,768,1024,1280]){
  await b.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});
  await b.evaluate("Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))");
  assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'overflow '+width);
  const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'partial-'+width+'.png'),Buffer.from(shot.data,'base64'));
 }
 checks.push('partial RLC review fits six phone and tablet widths');
 assert.equal(b.errors.length,0);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Production OCR review editor and merge with actual catalog schemas; no vision API',checks},null,2));
 console.log(JSON.stringify({passed:checks.length}));
}finally{await b.close();}
