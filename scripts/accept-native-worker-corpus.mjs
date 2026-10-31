// Generates fixtures in an isolated Worker; never changes the app repository or school state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe',serial='emulator-5560';
const run=(...a)=>execFileSync(adb,['-s',serial,...a],{windowsHide:true,maxBuffer:32*1024*1024});
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,pkg='com.labmaker.app.acceptance',out='artifacts/verification/native-worker-'+version+'-'+Date.now();fs.mkdirSync(out,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('src/data/catalog.json','utf8')).experiments;
const samples=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json','utf8'));
const photo=fs.readFileSync('artifacts/report-tests/local-photo.png').toString('base64');
const results=[];let ws,seq=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},200000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result?.value;}
try{
 const pid=run('shell','pidof',pkg).toString().trim();assert.match(pid,/^\d+$/);run('forward','tcp:9239','localabstract:webview_devtools_remote_'+pid);
 const tabs=await(await fetch('http://127.0.0.1:9239/json')).json();ws=new WebSocket(tabs.find(t=>t.url.startsWith('https://localhost/')).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 assert.equal(await ev('Capacitor.getPlatform()'),'android');
 await ev(`window.__nativeCorpus={ticks:0};window.__nativeCorpus.timer=setInterval(()=>window.__nativeCorpus.ticks++,100)`);
 for(const exp of catalog){
  const start=Date.now(),job={experimentId:exp.id,data:samples[exp.id],profile:{name:'本机隔离验收',studentId:'001234',className:'测试班'},date:'2026-10-27',options:{variants:{},disabledSections:[]},photoBase64:photo};
  const result=await ev(`new Promise((resolve,reject)=>{const worker=new Worker('/report-worker.js');window.__nativeCorpus.worker=worker;const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'))},180000);worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message))};worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timer);worker.terminate();reject(Error(data.message))}if(data.type==='result'){clearTimeout(timer);worker.terminate();window.__nativeCorpus.docx=data.docx;resolve({bytes:data.docx.length,formulaCount:data.metadata.formulaCount,charts:data.charts.map(c=>({name:c.name,bytes:c.bytes.length})),name:data.metadata.name})}};worker.postMessage({job:${JSON.stringify(job)},dataPackage:null})})`);
  assert.ok(result.bytes>1000);assert.ok(result.formulaCount>0);assert.ok(result.charts.every(c=>c.bytes>100));
  const base64=await ev(`(()=>{let s='';const b=window.__nativeCorpus.docx;for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s)})()`);const docx=Buffer.from(base64,'base64');assert.equal(docx.length,result.bytes);assert.equal(docx.readUInt16LE(),0x4b50);fs.writeFileSync(out+'/'+exp.id+'.docx',docx,{flag:'wx'});
  results.push({id:exp.id,name:exp.name,...result,elapsedMs:Date.now()-start});fs.writeFileSync(out+'/results.json',JSON.stringify({version,scope:'Isolated acceptance Android WebView Worker, synthetic photo and fixtures; no school or model requests',results},null,2));console.log(JSON.stringify({passed:results.length,name:exp.name,elapsedMs:results.at(-1).elapsedMs}));
 }
 assert.equal(results.length,28);assert.ok(await ev('window.__nativeCorpus.ticks>10'));console.log(JSON.stringify({passed:28,out,uiTimerContinued:true}));
}finally{if(ws?.readyState===1){await ev('if(window.__nativeCorpus){clearInterval(window.__nativeCorpus.timer);window.__nativeCorpus.worker?.terminate();delete window.__nativeCorpus}').catch(()=>{});ws.close()}run('forward','--remove','tcp:9239');}
