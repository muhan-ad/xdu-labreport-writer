import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openBrowserTest} from './browser-test-harness.mjs';
const checks=[];
for(const platform of ['ios','android']){
 const init=`window.CapacitorCustomPlatform={name:${JSON.stringify(platform)}};window.files={};window.bad=false;window.calls=[];window.Capacitor={PluginHeaders:[{name:'Filesystem',methods:['writeFile','readFile','stat','deleteFile'].map(name=>({name,rtype:'promise'}))},{name:'LabReportFiles',methods:[{name:'verifyPhoto',rtype:'promise'}]}],nativePromise:async(p,m,a)=>{calls.push({p,m,a});if(p==='Filesystem'&&m==='writeFile'){let bytes=Uint8Array.from(atob(a.data),c=>c.charCodeAt(0));if(bad)bytes[bytes.length-1]^=1;files[a.path]=btoa(String.fromCharCode(...bytes));return {uri:'file://test'};}if(p==='Filesystem'&&m==='stat')return {type:'file',size:atob(files[a.path]).length};if(p==='Filesystem'&&m==='readFile')return {data:files[a.path]};if(p==='Filesystem'&&m==='deleteFile'){delete files[a.path];return {}};if(p==='LabReportFiles'&&m==='verifyPhoto'){let raw=Uint8Array.from(atob(files['lab-maker/v1/photos/'+a.experimentId+'/'+a.file]),c=>c.charCodeAt(0));let hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');return {verified:raw.length===a.bytes&&hash===a.sha256};}throw Error('unexpected '+p+':'+m)}}`;
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/photo-storage-ui.ts','<main></main>',{initScript:init});
 try{
  await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
  const run="api.storePhoto('abcdef123456',new File([new Uint8Array([137,80,78,71,3,4,5,6])],'photo.png')).then(v=>({ok:true,path:v.path}),e=>({ok:false,message:e.message}))";
  const first=await b.evaluate(run);assert.equal(first.ok,true);const saved='lab-maker/v1/'+first.path;
  await b.evaluate('bad=true');const broken=await b.evaluate(run);assert.equal(broken.ok,false,platform+' must reject same-length corruption');
  const paths=await b.evaluate('Object.keys(files)');assert.deepEqual(paths,[saved],platform+' must retain original and clean failed candidate');
  await b.evaluate('bad=false');const retry=await b.evaluate(run);assert.equal(retry.ok,true);assert.notEqual(retry.path,first.path);
  assert.equal(b.errors.length,0);checks.push(platform+' verifies exact bytes, preserves old photo on corruption, allows retry');
 }finally{await b.close();}
}
{
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/photo-storage-ui.ts','<main></main>');
 try{
  await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
  const result=await b.evaluate("api.storePhoto('abcdef123456',new File([new Uint8Array([137,80,78,71,3,4,5,6])],'photo.png')).then(v=>({ok:true,path:v.path}),e=>({ok:false,message:e.message}))");
  assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.path,/^photos\/abcdef123456\//);assert.equal(b.errors.length,0);checks.push('actual web Filesystem accepts and verifies stored photo');
 }finally{await b.close();}
}
fs.mkdirSync('artifacts/verification',{recursive:true});fs.writeFileSync('artifacts/verification/photo-storage-browser.json',JSON.stringify({checks,scope:'production code: simulated Android/iOS bridges and actual web Filesystem; not iOS device acceptance'},null,2));console.log(JSON.stringify({passed:checks.length}));
