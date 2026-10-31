import {importMeasurements,validRecord} from './model.ts';
import type {Experiment,RecordData} from './types.ts';
import {isSoundExperiment} from './sound-phase.ts';
export interface DebugBackup{version:1;createdAt:string;records:RecordData[];}
export function validDebugBackup(experiments:Experiment[],raw:unknown):raw is DebugBackup{
 const b=raw as DebugBackup;
 return !!b&&b.version===1&&typeof b.createdAt==='string'&&Number.isFinite(Date.parse(b.createdAt))&&Array.isArray(b.records)&&b.records.length>0&&b.records.length<=experiments.length&&new Set(b.records.map(r=>r?.experimentId)).size===b.records.length&&b.records.every(record=>{const exp=experiments.find(e=>e.id===record?.experimentId);return !!exp&&validRecord(exp,record);});
}
export interface DebugDataPort{
 read:(exp:Experiment)=>Promise<RecordData>;
 write:(exp:Experiment,record:RecordData)=>Promise<void>;
 backup:(value:DebugBackup)=>Promise<void>;
 interrupted:()=>Promise<boolean>;
 pending:(phase:'fill'|'restore'|null)=>Promise<void>;
}
// Check every input and complete the durable backup before the first mutation.
export async function fillDebugData(experiments:Experiment[],samples:Record<string,unknown>,port:DebugDataPort,progress:(text:string)=>void=()=>{}){
 if(await port.interrupted())throw Error('上次调试写入未完成，请先恢复测试前备份');
 const originals:RecordData[]=[],next:RecordData[]=[];const createdAt=new Date().toISOString();
 for(const exp of experiments){
  progress('检查：'+exp.name);const original=await port.read(exp);
  if(!validRecord(exp,original))throw Error(exp.name+'：原记录未能核实，未填入测试数据');
  originals.push(structuredClone(original));next.push({...structuredClone(original),...(isSoundExperiment(exp)?{soundPhase:'alternating' as const}:{}),updatedAt:createdAt,draft:importMeasurements(exp,samples[exp.id])});
 }
 progress('备份原测量数据…');await port.backup({version:1,createdAt,records:originals});
 await replaceDebugRecords(experiments,next,originals,port,progress,'fill');
}
export async function restoreDebugData(experiments:Experiment[],backup:DebugBackup,port:DebugDataPort,progress:(text:string)=>void=()=>{}){
 if(!validDebugBackup(experiments,backup))throw Error('测试前备份无效');
 experiments=experiments.filter(exp=>backup.records.some(r=>r.experimentId===exp.id));
 const originals:RecordData[]=[];
 for(const exp of experiments){const record=await port.read(exp);if(!validRecord(exp,record))throw Error(exp.name+'：当前记录未能核实，未执行恢复');originals.push(structuredClone(record));}
 await replaceDebugRecords(experiments,experiments.map(e=>backup.records.find(r=>r.experimentId===e.id)!),originals,port,progress,'restore');
}
async function replaceDebugRecords(experiments:Experiment[],next:RecordData[],originals:RecordData[],port:DebugDataPort,progress:(text:string)=>void,phase:'fill'|'restore'){
 const interrupted=await port.interrupted();await port.pending(phase);
 const attempted:number[]=[];
 try{
  for(let i=0;i<experiments.length;i++){
   const exp=experiments[i];progress('写入：'+exp.name);attempted.push(i);await port.write(exp,structuredClone(next[i]));
   if(JSON.stringify(await port.read(exp))!==JSON.stringify(next[i]))throw Error(exp.name+'：保存后回读不一致');
  }
 }catch(error){
  const failed:string[]=[];
  for(const i of attempted.reverse()){
   const exp=experiments[i];try{await port.write(exp,structuredClone(originals[i]));if(JSON.stringify(await port.read(exp))!==JSON.stringify(originals[i]))throw Error('回读不一致');}catch{failed.push(exp.name);}
  }
  let markerFailed=false;
  if(!failed.length){try{await port.pending(interrupted?'fill':null);}catch{markerFailed=true;}}
  throw Error(failed.length?'操作中断，以下实验未能恢复，请保留备份后重试：'+failed.join('、'):'操作中断，本次写入前的测量数据已恢复：'+(error instanceof Error?error.message:'写入失败')+(markerFailed?'；中断标记未清除，请重新核对备份':''));
 }
 try{await port.pending(null);}catch{throw Error('测量数据已写入并核对，但结束标记未能完整保存；请重新打开检查，备份仍保留');}
}
