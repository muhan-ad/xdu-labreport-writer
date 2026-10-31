import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {WebResourceChecker} from '../src/platform/web-resource-check.ts';
const names=['index.html','report-worker.js','report-runtime/manifest.json','report-runtime/pyodide.asm.wasm','assets/example.js'];
const contents=Object.fromEntries(names.map((name,i)=>[name,Buffer.from('测试资源-'+i)]));
const manifest=()=>({schema:1,version:'0.1.0',scope:'shared-web-resources',files:names.map(path=>({path,bytes:contents[path].length,sha256:createHash('sha256').update(contents[path]).digest('hex')}))});
const reader=(m,changes={})=>async path=>{const key=decodeURIComponent(path.replace(/^\.\//,''));if(key==='web-resource-integrity.json')return new Response(JSON.stringify(m));if(changes[key]==='missing')return new Response('',{status:404});return new Response(changes[key]??contents[key]);};

test('shared resources are checked by exact byte count and hash with progress',async()=>{
 const check=new WebResourceChecker('0.1.0',reader(manifest())),id=randomUUID(),seen=[],listener=await check.progress(p=>seen.push(p));
 const result=await check.check(id);assert.equal(result.complete,true);assert.equal(result.scope,'shared');assert.equal(result.checked,names.length);assert.equal(seen.length,names.length);assert.equal(seen.at(-1).id,id);await listener.remove();
});
test('missing, changed-size and changed-content files cannot pass',async()=>{
 const m=manifest(),corrupt=Buffer.from(contents[names[2]]);corrupt[0]^=1;
 const check=new WebResourceChecker('0.1.0',reader(m,{[names[0]]:'missing',[names[1]]:Buffer.from('short'),[names[2]]:corrupt}));const result=await check.check(randomUUID());
 assert.equal(result.complete,false);assert.equal(result.checked,names.length);assert.deepEqual(result.problems.map(p=>p.reason),['读取失败','文件大小不一致','文件内容不一致']);
});
test('wrong version, missing required asset, duplicate and unsafe paths reject the inventory',async()=>{
 for(const change of [m=>m.version='old',m=>m.files=m.files.filter(f=>f.path!==names[0]),m=>m.files.push({...m.files[0]}),m=>m.files[0].path='../outside']){
  const m=manifest();change(m);await assert.rejects(new WebResourceChecker('0.1.0',reader(m)).check(randomUUID()),/清单/);
 }
});
test('cancellation aborts a pending read, rejects concurrent runs and permits retry',async()=>{
 let blocked=true;const m=manifest(),read=reader(m),checker=new WebResourceChecker('0.1.0',async(path,options)=>{
  if(blocked&&path.endsWith('index.html'))return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));return read(path,options);
 });
 const id=randomUUID(),pending=checker.check(id);await new Promise(r=>setTimeout(r,0));await assert.rejects(checker.check(randomUUID()),/正在进行/);await checker.cancel(id);const stopped=await pending;
 assert.equal(stopped.cancelled,true);assert.equal(stopped.complete,false);blocked=false;assert.equal((await checker.check(randomUUID())).complete,true);
});
test('oversized streams stop immediately and are never accepted as complete',async()=>{
 let cancelled=false;const m=manifest(),read=reader(m),checker=new WebResourceChecker('0.1.0',async(path,options)=>{
  if(path.endsWith('index.html'))return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(contents['index.html'].length+1));},cancel(){cancelled=true;}}));return read(path,options);
 });
 const result=await checker.check(randomUUID());assert.equal(cancelled,true);assert.equal(result.complete,false);assert.deepEqual(result.problems,[{path:'index.html',reason:'文件大小不一致'}]);
});
test('an unavailable body stream is reported instead of loading an unbounded file',async()=>{
 const m=manifest(),read=reader(m),checker=new WebResourceChecker('0.1.0',async(path,options)=>path.endsWith('index.html')?new Response(null):read(path,options));
 const result=await checker.check(randomUUID());assert.equal(result.complete,false);assert.deepEqual(result.problems,[{path:'index.html',reason:'当前平台无法安全读取资源'}]);
});
test('oversized manifest is rejected before parsing',async()=>{
 let cancelled=false;const checker=new WebResourceChecker('0.1.0',async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;}})));
 await assert.rejects(checker.check(randomUUID()),/清单大小异常/);assert.equal(cancelled,true);
});
