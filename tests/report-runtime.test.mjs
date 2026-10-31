import test from 'node:test';import assert from 'node:assert/strict';
import {reserveQueueRuntime,assertReportRuntime,queueBlocksRoute} from '../src/domain/report-runtime.ts';
import {ReportEngine} from '../src/engine/client.ts';
const job={experimentId:'abcdef123456',data:{},profile:{name:'',studentId:'',className:''},date:'2026-10-26',options:{}};
test('queue runtime remains reserved until explicit idempotent release, including foreground computations',()=>{
 const release=reserveQueueRuntime();try{assert.throws(()=>reserveQueueRuntime(),/已在运行/);assert.throws(()=>assertReportRuntime(),/请先停止/);assert.doesNotThrow(()=>assertReportRuntime(true));}finally{release();release();}assert.doesNotThrow(()=>assertReportRuntime());
});
test('foreground engine rejects before data reads and Worker creation while queue owns the runtime',async()=>{
 let reads=0;const engine=new ReportEngine(async()=>{reads++;return null}),release=reserveQueueRuntime();try{await assert.rejects(engine.generate(job,()=>{}),/报告队列/);assert.equal(reads,0);}finally{release();}
});
test('a late foreground resource read cannot create a Worker after a queue reservation begins',async()=>{
 let finish;const engine=new ReportEngine(()=>new Promise(r=>finish=r)),pending=engine.generate(job,()=>{}),release=reserveQueueRuntime();try{finish(null);await assert.rejects(pending,/报告队列/);}finally{release();}
});
test('queue-owned engine can compute while reserved and releases its Worker normally',async()=>{
 const original=globalThis.Worker;let workers=0,terminated=0;globalThis.Worker=class{constructor(){workers++;}postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'result'}}));}terminate(){terminated++;}};
 const release=reserveQueueRuntime();try{const engine=new ReportEngine(async()=>null,true);globalThis.location={href:'http://localhost/'};await engine.generate(job,()=>{});assert.equal(workers,1);assert.equal(terminated,1);}finally{release();globalThis.Worker=original;delete globalThis.location;}
});
test('queue permits browsing but blocks runtime reload and broad data maintenance routes',()=>{
 for(const route of ['#/home','#/experiment/abcdef123456','#/profile','#/settings','#/help/guide','#/portal','#/school-reports','#/report-manager','#/report-queue'])assert.equal(queueBlocksRoute(route,true),false);
 for(const route of ['#/developer','#/resource-check','#/data-updates','#/app-updates','#/easter-egg']){assert.equal(queueBlocksRoute(route,true),true);assert.equal(queueBlocksRoute(route,false),false);}
});
