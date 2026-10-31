import fs from 'node:fs';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const out='artifacts/verification/report-stage-0.114.0';fs.mkdirSync(out,{recursive:true});const checks=[];
for(const platform of ['ios','android']){
 const init="window.CapacitorCustomPlatform={name:"+JSON.stringify(platform)+"};window.files={};window.bad='';window.calls=[];window.Capacitor={PluginHeaders:[{name:'Filesystem',methods:['writeFile','readFile','stat'].map(name=>({name,rtype:'promise'}))},{name:'LabReportFiles',methods:[{name:'verifyStaged',rtype:'promise'}]}],nativePromise:async(p,m,a)=>{calls.push({p,m,a});if(p==='Filesystem'&&m==='writeFile'){files[a.path]=a.data;if(bad==='docx'&&a.path.endsWith('report.docx')||bad==='chart'&&a.path.endsWith('chart-1.png'))files[a.path]=btoa(a.path.endsWith('report.docx')?'wrong':'wrong!');return {uri:'file://test'};}if(p==='Filesystem'&&m==='stat')return {type:'file',size:atob(files[a.path]).length};if(p==='Filesystem'&&m==='readFile')return {data:files[a.path]};if(p==='LabReportFiles'&&m==='verifyStaged'){const path='lab-maker/v1/reports/'+a.experimentId+'/'+a.generation+'/'+a.file;let raw=Uint8Array.from(atob(files[path]),c=>c.charCodeAt(0));let hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');return {verified:raw.length===a.bytes&&hash===a.sha256};}throw Error('unexpected '+p+':'+m)}}";
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/report-stage-ui.ts','<main></main>',{initScript:init});
 try{await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
 const id='abcdef123456',gen='12345678-1234-1234-1234-123456789abc';
 const run="api.stage("+JSON.stringify(id)+","+JSON.stringify(gen)+").then(()=>({ok:true}),e=>({ok:false,message:e.message}))";
 for(const bad of ['docx','chart']){await b.evaluate("bad="+JSON.stringify(bad));const result=await b.evaluate(run);assert.equal(result.ok,false,platform+' must reject corrupt '+bad);}
 await b.evaluate("bad='';calls.length=0");assert.equal((await b.evaluate(run)).ok,true);const calls=await b.evaluate('window.calls');if(platform==='android')assert.equal(calls.filter(x=>x.m==='verifyStaged').length,2);else assert.equal(calls.filter(x=>x.m==='readFile').length,2);
 checks.push(platform+' detects damaged report and image, verifies both on normal write');assert.equal(b.errors.length,0);
 }finally{await b.close();}
}
fs.writeFileSync(out+'/results.json',JSON.stringify({checks,scope:'production staging code with simulated native bridges, not a device'},null,2));console.log(JSON.stringify({passed:checks.length,out}));
