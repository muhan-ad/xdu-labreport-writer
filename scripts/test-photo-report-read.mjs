import assert from 'node:assert/strict';import fs from 'node:fs';import {openBrowserTest} from './browser-test-harness.mjs';
const checks=[];
for(const platform of ['android','ios']){
 const init=`window.CapacitorCustomPlatform={name:${JSON.stringify(platform)}};window.mode='ok';window.reads=0;window.Capacitor={PluginHeaders:[{name:'Filesystem',methods:['stat','readFile'].map(name=>({name,rtype:'promise'}))}],nativePromise:async(p,m)=>{if(m==='stat'){if(mode==='missing')throw Error('missing');return {type:'file',size:mode==='huge'?20000000:8}}if(m==='readFile'){reads++;return {data:btoa(mode==='corrupt'?'abcdefgh':String.fromCharCode(137,80,78,71,3,4,5,6))}}throw Error('unexpected')}}`;
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/photo-report-read-ui.ts','<main></main>',{initScript:init});
 try{await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
 const run="api.photoBase64({path:'photos/abcdef123456/12345678-1234-1234-1234-123456789abc.png',mime:'image/png',name:'photo.png'}).then(x=>({ok:true,value:x}),e=>({ok:false,message:e.message}))";
 assert.equal((await b.evaluate(run)).ok,true);
 for(const mode of ['missing','huge','corrupt']){await b.evaluate('mode='+JSON.stringify(mode)+';reads=0');const r=await b.evaluate(run);assert.equal(r.ok,false);assert.match(r.message,/照片/);if(mode==='huge'||mode==='missing')assert.equal(await b.evaluate('reads'),0);}
 assert.equal(b.errors.length,0);checks.push(platform+' rejects missing, oversized and corrupt images with clear message');
 }finally{await b.close();}
}
{
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/photo-report-read-ui.ts','<main></main>');
 try{await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
 const result=await b.evaluate("(async()=>{const bytes=new Uint8Array([137,80,78,71,3,4,5,6]);const photo=await api.storePhoto('abcdef123456',new File([bytes],'photo.png'));return await api.photoBase64(photo)})()");
 assert.equal(result,Buffer.from([137,80,78,71,3,4,5,6]).toString('base64'));assert.equal(b.errors.length,0);checks.push('actual web filesystem round-trips photo for report');
 }finally{await b.close();}
}
fs.writeFileSync('artifacts/verification/photo-report-read.json',JSON.stringify({checks,scope:'production read code with simulated Android/iOS bridges and actual web Filesystem'},null,2));console.log(JSON.stringify({passed:checks.length}));
