import samples from '../data/test-measurements.json';
import app from '../../package.json';
import {Capacitor} from '@capacitor/core';
import {fillDebugData,restoreDebugData} from '../domain/developer-tools.ts';
import {hasValues,recordProgress} from '../domain/model.ts';
import type {Repository} from '../domain/repository.ts';
import type {Experiment} from '../domain/types.ts';
import type {DeveloperPort} from '../features/developer-tools.ts';
import {exportJson} from './storage.ts';
function debugDataPort(repo:Repository,experiments:Experiment[]){return {
 read:async(exp:Experiment)=>{const result=await repo.load(exp);if(result.warning)throw Error(exp.name+'：'+result.warning);return result.record;},
 write:repo.save.bind(repo),backup:repo.saveDebugBackup.bind(repo,experiments),
 interrupted:()=>repo.loadDebugInterrupted(),pending:(phase:'fill'|'restore'|null)=>repo.saveDebugOperation(phase),
};}
export async function fillOneDebugData(repo:Repository,experiments:Experiment[],exp:Experiment){
 if(!experiments.some(e=>e.id===exp.id))throw Error('实验不存在');
 await fillDebugData([exp],samples,debugDataPort(repo,experiments));
}
export function developerTools(repo:Repository,experiments:Experiment[],changed:()=>Promise<void>,confirm:DeveloperPort['confirm']):DeveloperPort{
 const port=debugDataPort(repo,experiments);
 return {
  count:experiments.length,confirm,loadMode:()=>repo.loadDeveloperMode(),saveMode:value=>repo.saveDeveloperMode(value),
  interrupted:()=>repo.loadDebugInterrupted(),
  backupInfo:async()=>{const backup=await repo.loadDebugBackup(experiments);return backup?new Date(backup.createdAt).toLocaleString('zh-CN')+' · '+backup.records.length+' 个实验':null;},
  removeBackup:()=>repo.clearDebugBackup(),
  fill:async progress=>{try{await fillDebugData(experiments,samples,port,progress);}finally{await changed();}},
  restore:async progress=>{const backup=await repo.loadDebugBackup(experiments);if(!backup)throw Error('没有可用的测试前备份');try{await restoreDebugData(experiments,backup,port,progress);}finally{await changed();}},
  diagnostics:async()=>{
   const rows=[];for(const exp of experiments){try{const result=await repo.load(exp);const p=recordProgress(exp,result.record);rows.push({experiment:exp.name,hasData:hasValues(result.record.draft),completed:p.done,total:p.total,storage:result.warning?'degraded':'readable'});}catch{rows.push({experiment:exp.name,storage:'unreadable'});}}
   await exportJson('实验搭子诊断摘要',{version:1,appVersion:app.version,platform:Capacitor.getPlatform(),createdAt:new Date().toISOString(),experiments:rows},'导出诊断摘要');
  },
 };
}
