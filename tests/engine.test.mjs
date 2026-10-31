import test from 'node:test';
import assert from 'node:assert/strict';
import {ReportEngine} from '../src/engine/client.ts';

class FakeWorker {
 static instances=[];
 constructor(url){this.url=String(url);this.terminated=false;FakeWorker.instances.push(this);}
 postMessage(message){this.job=message.job;this.dataPackage=message.dataPackage;}
 terminate(){this.terminated=true;}
 send(data){this.onmessage?.({data});}
}
const originalWorker=globalThis.Worker,originalLocation=globalThis.location;
globalThis.Worker=FakeWorker;globalThis.location={href:'http://localhost/'};
test.after(()=>{globalThis.Worker=originalWorker;globalThis.location=originalLocation;});
const job={experimentId:'abcdef123456',data:{x:0},profile:{name:'',studentId:'',className:''},date:'2026-10-24',options:{}};

test('calculation worker protocol returns only the calculation context and terminates on success',async()=>{
 const engine=new ReportEngine(async()=>null),progress=[];
 const result=engine.calculate(job,text=>progress.push(text));await Promise.resolve();const worker=FakeWorker.instances.at(-1);
 assert.equal(worker.job.mode,'context');assert.equal(worker.job.data.x,0);
 worker.send({type:'progress',text:'正在计算'});
 const context={experimentId:job.experimentId,sourceId:'实验',values:{result:0.013999999999999999}};
 worker.send({type:'context-result',context});assert.deepEqual(await result,context);assert.deepEqual(progress,['正在计算']);assert.equal(worker.terminated,true);
});

test('cancellation rejects a calculation; a late old result cannot replace the next worker job',async()=>{
 const engine=new ReportEngine(async()=>null);
 const old=engine.calculate(job,()=>{});await Promise.resolve();const first=FakeWorker.instances.at(-1);
 engine.cancel();await assert.rejects(old,/已取消/);assert.equal(first.terminated,true);
 const pending=engine.calculate({...job,data:{x:2}},()=>{});await Promise.resolve();const second=FakeWorker.instances.at(-1);
 first.send({type:'context-result',context:{values:{x:999}}});assert.equal(second.terminated,false);
 second.send({type:'context-result',context:{values:{x:2}}});assert.deepEqual(await pending,{values:{x:2}});
});

test('calculation failure does not prevent a subsequent normal report generation',async()=>{
 const engine=new ReportEngine(async()=>null),failed=engine.calculate(job,()=>{});await Promise.resolve();const worker=FakeWorker.instances.at(-1);
 worker.send({type:'error',message:'缺少测量数据'});await assert.rejects(failed,/缺少测量数据/);assert.equal(worker.terminated,true);
 const pending=engine.generate(job,()=>{});await Promise.resolve();const reportWorker=FakeWorker.instances.at(-1);
 const report={type:'result',docx:new Uint8Array([1,2]),charts:[],metadata:{name:'实验报告',formulaCount:1,sections:{},log:''}};
 reportWorker.send(report);assert.deepEqual(await pending,report);assert.equal(reportWorker.terminated,true);
});
test('unverified resource rejection never starts a worker or executes candidate source',async()=>{
 const before=FakeWorker.instances.length,engine=new ReportEngine(async()=>{throw Error('发布签名验证失败');});await assert.rejects(engine.generate(job,()=>{}),/签名/);assert.equal(FakeWorker.instances.length,before);
});
test('cancellation during resource resolution prevents late worker startup and preserves the next job',async()=>{
 let release,calls=0;const engine=new ReportEngine(()=>++calls===1?new Promise(r=>release=r):Promise.resolve(null)),before=FakeWorker.instances.length;
 const old=engine.calculate(job,()=>{});engine.cancel();const next=engine.calculate(job,()=>{});await Promise.resolve();const worker=FakeWorker.instances.at(-1);release(null);await assert.rejects(old,/取消/);assert.equal(FakeWorker.instances.length,before+1);worker.send({type:'context-result',context:{new:true}});assert.deepEqual(await next,{new:true});
});
test('verified candidate resource source reaches the diagnostic worker as one package',async()=>{
 const candidate={manifest:{},body:'source'},payload={sources:{'common/test.py':'pass'},dataVersion:'1.0.1'},engine=new ReportEngine(async received=>{assert.equal(received,candidate);return payload;});const pending=engine.diagnose(()=>{},candidate);await Promise.resolve();const worker=FakeWorker.instances.at(-1);assert.equal(worker.job.mode,'diagnostic');assert.equal(worker.dataPackage,payload);worker.send({type:'diagnostic-result',diagnostic:{complete:true,experiments:28,scripts:56,templates:28,problems:[]}});assert.equal((await pending).complete,true);assert.equal(worker.terminated,true);
});
