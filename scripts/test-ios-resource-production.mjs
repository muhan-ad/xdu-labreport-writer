import fs from 'node:fs';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const manifest=JSON.parse(fs.readFileSync('dist/web-resource-integrity.json','utf8'));
for(const fail of [false,true]){
 const b=await openBrowserTest(process.cwd(),'src/main.ts','',{production:true,productionFailFile:fail?'/report-worker.js':undefined,initScript:"window.CapacitorCustomPlatform={name:'ios'};"});
 try{
  await b.wait("!!document.querySelector('.app-header')");await b.evaluate("location.hash='#/resource-check'");await b.wait("!!document.querySelector('[data-resource=check]')&&!document.querySelector('[data-resource=check]').disabled");
  assert.equal(await b.evaluate("document.querySelector('[data-resource=refresh]').hidden"),true);
  await b.evaluate("document.querySelector('[data-resource=check]').click()");await b.wait("!document.querySelector('[data-resource=check]').disabled");
  const result=await b.evaluate("document.querySelector('#resource-result').textContent");
  if(fail){assert.match(result,/共享资源不完整/);assert.match(result,/report-worker.js/);await b.evaluate("document.querySelector('[data-resource=check]').click()");await b.wait("!document.querySelector('[data-resource=check]').disabled");assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/共享资源完整/);}
  else{assert.match(result,/共享资源完整/);assert.ok(result.includes(`${manifest.files.length} / ${manifest.files.length}`));}
  assert.equal(b.errors.length,0);
  console.log(JSON.stringify({passed:fail?2:1,files:manifest.files.length,scope:'actual built web bundle in desktop browser with simulated iOS platform; no iOS device'}));
 }finally{await b.close();}
}
