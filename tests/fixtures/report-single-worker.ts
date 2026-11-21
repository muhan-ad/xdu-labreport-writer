import {Reports} from '../../src/features/reports.ts';import {Repository} from '../../src/domain/repository.ts';import catalog from '../../src/data/catalog.json';import samples from './measurements.json';import {recordBlank,makeDraft} from '../../src/domain/model.ts';import {reportBytes} from '../../src/platform/reports.ts';import type {Experiment} from '../../src/domain/types.ts';
export async function createRealSingleReport(){const exp=catalog.experiments[0] as Experiment,doc={...recordBlank(exp),draft:makeDraft(exp.schema,(samples as any)[exp.id])},profile={name:'单份流程模拟测试',studentId:'TEST',className:'验证'},files=new Map<string,string>(),repo=new Repository({read:async k=>files.get(k)??null,write:async(k,v)=>{files.set(k,v)},remove:async k=>{files.delete(k)}}),view=new Reports(repo,{context:()=>({exp,doc,profile,photo:null,blocked:false}),flush:async()=>{},notice:()=>{},jump:()=>{},configureAI:()=>{},upload:()=>{},confirm:async()=>true});await view.open();return {result:async()=>{const saved=(await repo.loadReport(exp)).value;if(!saved)return null;const bytes=await reportBytes(saved);return {bytes:bytes.length,formulas:saved.formulaCount,signature:[...bytes.slice(0,2)],generation:saved.generation};},close:()=>view.close()};}

export async function benchmarkReportEngine() {
  const {ReportEngine}=await import('../../src/engine/client.ts');
  const exp=catalog.experiments[0] as Experiment;
  const job={experimentId:exp.id,data:(samples as Record<string,import('../../src/domain/types.ts').Measurements>)[exp.id],profile:{name:'性能测试',studentId:'TEST',className:'验证'},date:'2026-11-20',options:{}};
  const cold=new ReportEngine(async()=>null);
  const warm=new ReportEngine(async()=>null,false,'interactive');
  try{
    const run=async(engine:typeof cold)=>{
      const start=performance.now();
      const result=await engine.generate(job,()=>{});
      return {ms:Math.round(performance.now()-start),formulas:result.metadata.formulaCount,bytes:result.docx.byteLength};
    };
    const before=await run(cold);
    warm.prewarm();
    const first=await run(warm);
    const repeat=await run(warm);
    return {before,first,repeat};
  }finally{cold.cancel();warm.cancel();}
}
