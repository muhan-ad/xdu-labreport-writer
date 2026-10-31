import assert from 'node:assert/strict';import fs from 'node:fs';import {openBrowserTest} from './browser-test-harness.mjs';
const init="window.CapacitorCustomPlatform={name:'android'};window.Capacitor={PluginHeaders:[{name:'Filesystem',methods:[{name:'getUri',rtype:'promise'}]}],nativePromise:async(p,m)=>{if(p==='Filesystem'&&m==='getUri')return {uri:'file://isolated/report.docx'};throw Error('External operation blocked')}}";
const b=await openBrowserTest(process.cwd(),'tests/fixtures/school-report-resource-ui.ts','<main></main>',{initScript:init});
try{await b.evaluate("import('/test.mjs').then(m=>{window.fixture=m;return true})");
 const same=await b.evaluate("fixture.attempt('a'.repeat(64),'a'.repeat(64))");assert.deepEqual(same,{ok:true,prepared:1,shown:1});
 const changed=await b.evaluate("fixture.attempt('b'.repeat(64),'a'.repeat(64))");assert.equal(changed.ok,false);assert.match(changed.message,/重新生成/);assert.equal(changed.prepared,1);
 const builtin=await b.evaluate("fixture.attempt(undefined,undefined)");assert.deepEqual(builtin,{ok:true,prepared:2,shown:2});
 const old=await b.evaluate("fixture.attempt('a'.repeat(64),undefined)");assert.equal(old.ok,false);assert.equal(old.prepared,2);
 assert.equal(b.errors.length,0);fs.writeFileSync('artifacts/verification/school-report-resource-ui.json',JSON.stringify({checks:['same updated data reaches confirmation','changed update is refused before preparation','built-in data remains compatible','old built-in report is refused after update'],scope:'actual SchoolReportView with mock private storage and upload service; no school requests'},null,2));console.log(JSON.stringify({passed:4}));
}finally{await b.close();}
