import type {Repository} from '../domain/repository.ts';import type {Experiment} from '../domain/types.ts';
import {ReportEngine} from '../engine/client.ts';import {reportGenerator} from './report-generation.ts';import {dataSnapshot,reportTemplates} from './data-state.ts';
import type {QueueRunner} from '../domain/report-queue.ts';
export function queuedReportRunner(repo:Repository,experiments:Experiment[],confirm?:(title:string,body:string,signal?:AbortSignal)=>Promise<boolean>){
 const engine=new ReportEngine(undefined,true,true),generator=reportGenerator(repo,engine,{confirm:(...args)=>{engine.releaseIdle();return confirm?.(...args)??Promise.resolve(false);}});
 const runner:QueueRunner=async(id,signal,progress,phase)=>{
  try{
  const exp=experiments.find(e=>e.id===id);if(!exp)throw Error('实验不存在');
  const read=async()=>{const [record,profile,photo,settings,data]=await Promise.all([repo.load(exp),repo.loadProfile(),repo.loadPhoto(id),repo.loadReportSettings(id),dataSnapshot()]);return {snapshot:{resourceHash:data.resourceHash,record:record.record,profile,photoPath:photo?.path??null,settings},photo};};
  const [{snapshot,photo},templates]=await Promise.all([read(),reportTemplates()]);
  const saved=await generator.run({exp,snapshot,photo,templates:templates[id]??{},fresh:async()=>(await read()).snapshot},signal,progress,phase);
  if(saved.notices?.length)progress('报告已生成；'+saved.notices.join('；'));
  }catch(error){engine.releaseIdle();throw error;}
 };
 runner.release=()=>engine.releaseIdle();return runner;
}
