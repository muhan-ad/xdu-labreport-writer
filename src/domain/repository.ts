import type { ReportSettings, SavedReport } from "./reports.ts";
import {mergeSectionSwitches} from './report-sections.ts';
import {validSavedOCR,type SavedOCR} from './ocr-cache.ts';
import {studentFields,validStudentProfile} from './ocr-student.ts';
import {validDebugBackup,type DebugBackup} from './developer-tools.ts';
import {archiveId,validVariantArchive,validVariantSummary,type VariantArchive,type VariantSummary} from './variant-library.ts';
import {validAIPreferences,defaultAIPreferences,type AIPreferences} from './ai-preferences.ts';
import {validAIKnowledgePolicy,defaultAIKnowledgePolicy,type AIKnowledgePolicy} from './ai-knowledge-policy.ts';
import {validSchoolPreload,defaultSchoolPreload,type SchoolPreloadPreference} from './school-preload.ts';
import {validPlotSummary,validPlotHistory,type PlotHistoryEntry,type PlotHistorySummary} from './plot-history.ts';
import {validSkills,validHistoryEntry,validHistorySummary,type Skill,type AIHistoryEntry,type AIHistorySummary} from './ai-library.ts';
import {
  validReportSettings,
  detachAIHistory,
  validSavedReport,
  defaultReportSettings,
} from "./reports.ts";
import type { Experiment, RecordData, Photo, Profile } from "./types.ts";
import { recordBlank, validRecord, cleanProfile } from "./model.ts";
export interface Store {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
interface Envelope {
  revision: number;
  payload: unknown;
  digest: string;
}
async function checksum(text: string) {
  const bytes = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function validPhoto(id:string,x:unknown):x is Photo{
 const photo=x as Photo;
 return /^[a-f0-9]{12}$/.test(id)&&!!photo&&typeof photo==='object'&&typeof photo.path==='string'
  &&new RegExp('^photos/'+id+'/[a-f0-9-]+\\.(jpg|png|webp)$').test(photo.path)
  &&['image/jpeg','image/png','image/webp'].includes(photo.mime)&&typeof photo.name==='string';
}
function validStoredProfile(raw:unknown):raw is Profile{
 return !!raw&&typeof raw==='object'&&!Array.isArray(raw)&&['name','studentId','className'].every(k=>typeof (raw as Record<string,unknown>)[k]==='string');
}
export class Repository {
  private jobs = new Map<string, Promise<unknown>>();
  private epochs = new Map<string, number>();
  private revisions = new Map<string, number>();
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  loadOCR(id:string){if(!/^[a-f0-9]{12}$/.test(id))return Promise.reject(Error('实验标识无效'));const key=`ocr-${id}`,epoch=this.epochs.get(key)??0;return this.queue(key,async()=>{const result=await this.read(key,(v):v is SavedOCR=>validSavedOCR(v)&&v.experimentId===id);return {...result,...((this.epochs.get(key)??0)!==epoch?{value:null,warning:'识图缓存已变化，请重新打开'}:{}),epoch};});}
  saveOCR(id:string,value:SavedOCR,epoch:number){const key=`ocr-${id}`,copy=structuredClone(value);if(!/^[a-f0-9]{12}$/.test(id)||!validSavedOCR(copy)||copy.experimentId!==id)return Promise.reject(Error('识图缓存格式无效'));return this.queue(key,async()=>{if((this.epochs.get(key)??0)!==epoch)return false;await this.read(key,validSavedOCR);await this.write(key,copy);await this.write(key,copy);const actual=await this.read(key,validSavedOCR);if(JSON.stringify(actual.value)!==JSON.stringify(copy))throw Error('识图缓存保存未能核实');return true;});}
  clearOCR(id:string){if(!/^[a-f0-9]{12}$/.test(id))return Promise.reject(Error('实验标识无效'));const key=`ocr-${id}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{for(const slot of ['a','b'])await this.store.remove(`${key}-${slot}`);if(await this.store.read(key+'-a')!==null||await this.store.read(key+'-b')!==null)throw Error('识图缓存清除未能核实');this.revisions.delete(key);});}
  loadDeveloperMode(){return this.queue('developer-settings',async()=>{const r=await this.read('developer-settings',(v):v is {enabled:boolean}=>!!v&&typeof v==='object'&&typeof (v as {enabled?:unknown}).enabled==='boolean');return r.value?.enabled??false;});}
  loadDebugInterrupted(){return this.queue('debug-operation',async()=>{const r=await this.read('debug-operation',(v):v is {phase:'fill'|'restore';startedAt:string}|null=>v===null||!!v&&typeof v==='object'&&['fill','restore'].includes((v as {phase:string}).phase)&&typeof (v as {startedAt?:unknown}).startedAt==='string');return !!r.value;});}
  saveDebugOperation(phase:'fill'|'restore'|null){return this.queue('debug-operation',async()=>{const value=phase?{phase,startedAt:new Date().toISOString()}:null;await this.write('debug-operation',value);await this.write('debug-operation',value);const read=await this.read('debug-operation',(v):v is typeof value=>v===null||!!v&&typeof v==='object'&&['fill','restore'].includes((v as {phase:string}).phase)&&typeof (v as {startedAt?:unknown}).startedAt==='string');if(JSON.stringify(read.value)!==JSON.stringify(value))throw Error('调试操作标记回读不一致');});}
  saveDeveloperMode(enabled:boolean){return this.queue('developer-settings',()=>this.write('developer-settings',{enabled:!!enabled}));}
  loadDebugBackup(experiments:Experiment[]){return this.queue('debug-backup',async()=>{const r=await this.read('debug-backup',(v):v is DebugBackup=>validDebugBackup(experiments,v));return r.value;});}
  clearDebugBackup(){return this.queue('debug-backup',async()=>{await this.store.remove('debug-backup-a');await this.store.remove('debug-backup-b');this.revisions.delete('debug-backup');});}
  saveDebugBackup(experiments:Experiment[],backup:DebugBackup){
    const copy=structuredClone(backup);if(!validDebugBackup(experiments,copy)||new TextEncoder().encode(JSON.stringify(copy)).length>1800000)return Promise.reject(Error('测试前备份无效或过大，未改动测量数据'));
    return this.queue('debug-backup',async()=>{await this.write('debug-backup',copy);await this.write('debug-backup',copy);const read=await this.read('debug-backup',(v):v is DebugBackup=>validDebugBackup(experiments,v));if(JSON.stringify(read.value)!==JSON.stringify(copy))throw Error('备份回读不一致，未填入测试数据');});
  }
  loadSkills(defaults:Skill[]){return this.queue('ai-skills',async()=>{const r=await this.read('ai-skills',validSkills);return r.value??structuredClone(defaults);});}
  loadAIPreferences(id:string){if(!/^[a-f0-9]{12}$/.test(id))return Promise.reject(Error('实验标识无效'));const key=`ai-preferences-${id}`;return this.queue(key,async()=>(await this.read(key,validAIPreferences)).value??defaultAIPreferences());}
  loadAIKnowledgePolicy(){return this.queue('ai-knowledge-policy',async()=>(await this.read('ai-knowledge-policy',validAIKnowledgePolicy)).value??defaultAIKnowledgePolicy());}
  loadSchoolPreload(){return this.queue('school-preload',async()=>{const result=await this.read('school-preload',validSchoolPreload);if(result.warning)throw Error('自动加载设置副本异常，请重置后重新选择');return result.value??defaultSchoolPreload();});}
  saveSchoolPreload(value:SchoolPreloadPreference){if(!validSchoolPreload(value))return Promise.reject(Error('自动加载设置无效'));const copy=structuredClone(value);return this.queue('school-preload',async()=>{const old=await this.read('school-preload',validSchoolPreload);if(old.warning)throw Error('自动加载设置副本异常，请先重置');await this.write('school-preload',copy);await this.write('school-preload',copy);const actual=await this.read('school-preload',validSchoolPreload);if(actual.warning||JSON.stringify(actual.value)!==JSON.stringify(copy))throw Error('自动加载设置保存未能核实');});}
  resetSchoolPreload(){return this.queue('school-preload',async()=>{
    try{await this.read('school-preload',validSchoolPreload);}catch(error){if(!(error as Error).message.includes('本机数据损坏'))throw error;await this.store.remove('school-preload-a');await this.store.remove('school-preload-b');if(await this.store.read('school-preload-a')!==null||await this.store.read('school-preload-b')!==null)throw Error('自动加载设置重置未能核实');this.revisions.delete('school-preload');return;}
    const empty=defaultSchoolPreload();await this.write('school-preload',empty);await this.write('school-preload',empty);const read=await this.read('school-preload',validSchoolPreload);if(read.warning||JSON.stringify(read.value)!==JSON.stringify(empty))throw Error('自动加载设置重置未能核实');
  });}
  saveAIKnowledgePolicy(value:AIKnowledgePolicy){if(!validAIKnowledgePolicy(value))return Promise.reject(Error('知识库设置无效'));const copy=structuredClone(value);return this.queue('ai-knowledge-policy',async()=>{await this.read('ai-knowledge-policy',validAIKnowledgePolicy);await this.write('ai-knowledge-policy',copy);await this.write('ai-knowledge-policy',copy);const actual=await this.read('ai-knowledge-policy',validAIKnowledgePolicy);if(actual.warning||JSON.stringify(actual.value)!==JSON.stringify(copy))throw Error('知识库设置保存未能核实');});}
  saveAIPreferences(id:string,value:AIPreferences){if(!/^[a-f0-9]{12}$/.test(id)||!validAIPreferences(value))return Promise.reject(Error('AI 写作偏好无效'));const copy=structuredClone(value),key=`ai-preferences-${id}`;return this.queue(key,async()=>{await this.write(key,copy);await this.write(key,copy);});}
  saveSkills(skills:Skill[]){if(!validSkills(skills))return Promise.reject(Error('技能配置无效或总量过大'));const copy=structuredClone(skills);return this.queue('ai-skills',()=>this.write('ai-skills',copy));}
  private historyIndex(id:string){if(!/^[a-f0-9]{12}$/.test(id))throw Error('实验标识无效');return this.read(`history-${id}`,(x):x is AIHistorySummary[]=>Array.isArray(x)&&x.length<=10000&&x.every(validHistorySummary)&&new Set(x.map(r=>r.id)).size===x.length);}
  listAIHistory(id:string){return this.queue(`history-${id}`,async()=>(await this.historyIndex(id)).value??[]);}
  inspectAIHistory(id:string){return this.queue(`history-${id}`,async()=>{const result=await this.historyIndex(id);return {rows:result.value??[],warning:result.warning};});}
  removeManagedAIHistory(expId:string,expected:AIHistorySummary[]){
    if(!Array.isArray(expected)||!expected.length||expected.length>10000)return Promise.reject(Error('待删除历史无效'));
    const targets=structuredClone(expected);
    if(!/^[a-f0-9]{12}$/.test(expId)||!targets.length||targets.length>10000||!targets.every(validHistorySummary)||new Set(targets.map(r=>r.id)).size!==targets.length)return Promise.reject(Error('待删除历史无效'));
    const key=`history-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);
    return this.queue(`options-${expId}`,()=>this.queue(key,async()=>{
      const index=await this.historyIndex(expId);if(index.warning)throw Error('历史保存副本异常，请核对后在实验页维护，未删除记录');
      const rows=index.value??[],ids=new Set(targets.map(r=>r.id));
      const byId=new Map(rows.map(row=>[row.id,row]));if(targets.some(r=>{const current=byId.get(r.id);return !current||(['kind','section','createdAt','sourceHash'] as const).some(k=>current[k]!==r[k]);}))throw Error('历史已变化，请刷新后重新确认');
      const options=await this.read(`options-${expId}`,(v):v is ReportSettings=>validReportSettings(v)&&(!v.aiPlot||v.aiPlot.experimentId===expId));
      if(options.warning)throw Error('报告配置副本异常，历史保留，请先核对');
      const original=options.value??defaultReportSettings();let next=original;const refs=original.ai?.historyRefs;
      for(const id of new Set([refs?.quiz,...Object.values(refs?.polish??{})]))if(id&&ids.has(id))next=detachAIHistory(next,id);
      if(JSON.stringify(next)!==JSON.stringify(original)){
        await this.write(`options-${expId}`,next);await this.write(`options-${expId}`,next);
        const check=await this.read(`options-${expId}`,validReportSettings);if(check.warning||JSON.stringify(check.value)!==JSON.stringify(next))throw Error('报告配置回读未通过，历史保留');
      }
      // Keep the index retryable until file cleanup succeeds. Existing reports remain untouched.
      for(const row of targets)for(const slot of ['a','b'])await this.store.remove(`history-item-${expId}-${row.id}-${slot}`);
      const remaining=rows.filter(r=>!ids.has(r.id));await this.write(key,remaining);await this.write(key,remaining);
      const verified=await this.historyIndex(expId);if(verified.warning||JSON.stringify(verified.value)!==JSON.stringify(remaining))throw Error('历史目录回读未通过，请刷新核对');
      return targets.length;
    }));
  }
  appendAIHistory(entry:AIHistoryEntry){const copy=structuredClone(entry),key=`history-${entry.experimentId}`,epoch=this.epochs.get(key)??0;if(!validHistoryEntry(copy))return Promise.reject(Error('历史记录无效或超过 1 MB'));return this.queue(key,async()=>{
    if((this.epochs.get(key)??0)!==epoch)throw Error('历史任务已失效');const list=(await this.historyIndex(copy.experimentId)).value??[];if(list.length>=10000)throw Error('历史目录已满，请清理旧记录');
    const {id,kind,section,createdAt,sourceHash}=copy,summary={id,kind,section,createdAt,sourceHash};const next=[summary,...list.filter(r=>r.id!==id)];if(new TextEncoder().encode(JSON.stringify(next)).length>1500000)throw Error('历史目录过大，请清理旧记录');
    const item=`history-item-${copy.experimentId}-${id}`;await this.write(item,copy);await this.write(item,copy);await this.write(key,next);await this.write(key,next);
  });}
  readAIHistory(expId:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))return Promise.reject(Error('历史标识无效'));return this.queue(`history-${expId}`,async()=>{const list=(await this.historyIndex(expId)).value??[];const summary=list.find(r=>r.id===id);if(!summary)throw Error('历史记录不存在');const r=await this.read(`history-item-${expId}-${id}`,validHistoryEntry);if(!r.value||r.value.experimentId!==expId||r.value.id!==id||r.value.sourceHash!==summary.sourceHash||await checksum(r.value.source)!==summary.sourceHash||(['kind','section','createdAt'] as const).some(k=>r.value![k]!==summary[k]))throw Error('历史记录未能核实');return r.value;});}
  deleteAIHistory(expId:string,ids?:string[]){const key=`history-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{const list=(await this.historyIndex(expId)).value??[],removed=list.filter(r=>!ids||ids.includes(r.id)),next=list.filter(r=>!removed.includes(r));await this.write(key,next);await this.write(key,next);for(const r of removed)for(const slot of ['a','b'])await this.store.remove(`history-item-${expId}-${r.id}-${slot}`);});}
  clearAIHistory(expId:string,cleanup:()=>Promise<void>){if(!/^[a-f0-9]{12}$/.test(expId))return Promise.reject(Error('实验标识无效'));const key=`history-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{await cleanup();this.revisions.delete(key);});}
  private plotIndex(id:string){if(!/^[a-f0-9]{12}$/.test(id))throw Error('实验标识无效');return this.read(`plot-history-${id}`,(x):x is PlotHistorySummary[]=>Array.isArray(x)&&x.length<=10000&&x.every(validPlotSummary)&&new Set(x.map(r=>r.id)).size===x.length&&new TextEncoder().encode(JSON.stringify(x)).length<=1500000);}
  listPlotHistory(id:string){return this.queue(`plot-history-${id}`,async()=>(await this.plotIndex(id)).value??[]);}
  appendPlotHistory(entry:PlotHistoryEntry){const copy=structuredClone(entry),key=`plot-history-${entry.experimentId}`,epoch=this.epochs.get(key)??0;if(!validPlotHistory(copy))return Promise.reject(Error('绘图历史记录无效'));return this.queue(key,async()=>{
    if((this.epochs.get(key)??0)!==epoch)throw Error('绘图历史任务已失效');const list=(await this.plotIndex(copy.experimentId)).value??[];if(list.length>=10000)throw Error('绘图历史已满，请清理旧记录');
    const {id,createdAt,sourceHash,requirement}=copy,next=[{id,createdAt,sourceHash,requirement},...list.filter(r=>r.id!==id)];if(new TextEncoder().encode(JSON.stringify(next)).length>1500000)throw Error('绘图历史目录过大，请清理旧记录');
    const item=`plot-item-${copy.experimentId}-${id}`;await this.write(item,copy);await this.write(item,copy);await this.write(key,next);await this.write(key,next);
  });}
  readPlotHistory(expId:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))return Promise.reject(Error('历史标识无效'));return this.queue(`plot-history-${expId}`,async()=>{const summary=((await this.plotIndex(expId)).value??[]).find(r=>r.id===id);if(!summary)throw Error('绘图历史不存在');const r=await this.read(`plot-item-${expId}-${id}`,validPlotHistory);if(!r.value||r.value.experimentId!==expId||r.value.id!==id||r.value.sourceHash!==summary.sourceHash)throw Error('绘图历史未能核实');return r.value;});}
  deletePlotHistory(expId:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id))return Promise.reject(Error('历史标识无效'));const key=`plot-history-${expId}`;return this.queue(key,async()=>{const list=(await this.plotIndex(expId)).value??[],next=list.filter(r=>r.id!==id);await this.write(key,next);await this.write(key,next);for(const slot of ['a','b'])await this.store.remove(`plot-item-${expId}-${id}-${slot}`);});}
  clearPlotHistory(expId:string,cleanup:()=>Promise<void>){if(!/^[a-f0-9]{12}$/.test(expId))return Promise.reject(Error('实验标识无效'));const key=`plot-history-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{await cleanup();this.revisions.delete(key);});}
  private variantLibraryIndex(expId:string){if(!/^[a-f0-9]{12}$/.test(expId))throw Error('实验标识无效');return this.read(`variant-library-${expId}`,(x):x is VariantSummary[]=>Array.isArray(x)&&x.length<=10000&&x.every(validVariantSummary)&&new Set(x.map(r=>r.id)).size===x.length&&new TextEncoder().encode(JSON.stringify(x)).length<=1500000);}
  listVariantLibrary(expId:string){return this.queue(`variant-library-${expId}`,async()=>(await this.variantLibraryIndex(expId)).value??[]);}
  async archiveVariant(value:Pick<VariantArchive,'experimentId'|'section'|'index'|'original'|'text'|'desktop'|'unbound'>&{createdAt?:string}){const copy={experimentId:value.experimentId,section:value.section,index:value.index,original:value.original,text:value.text,...(value.desktop?{desktop:true as const}:{}),...(value.unbound?{unbound:true as const}:{})},createdAt=value.createdAt??new Date().toISOString(),key=`variant-library-${copy.experimentId}`,epoch=this.epochs.get(key)??0,entry:VariantArchive={...copy,version:1,createdAt,id:await archiveId(copy)};if(!validVariantArchive(entry))throw Error('自建变体无效');return this.queue(key,async()=>{if((this.epochs.get(key)??0)!==epoch)throw Error('自建变体任务已失效');const rows=(await this.variantLibraryIndex(copy.experimentId)).value??[];if(rows.length>=10000&&!rows.some(r=>r.id===entry.id))throw Error('自建变体目录已满');const summary:VariantSummary={id:entry.id,section:entry.section,index:entry.index,createdAt:entry.createdAt,preview:entry.text.replace(/\s+/g,' ').slice(0,100)},next=[summary,...rows.filter(r=>r.id!==entry.id)];if(new TextEncoder().encode(JSON.stringify(next)).length>1500000)throw Error('自建变体目录过大');const item=`variant-entry-${entry.experimentId}-${entry.id}`;await this.write(item,entry);await this.write(item,entry);await this.write(key,next);await this.write(key,next);return entry.id;});}
  readVariantArchive(expId:string,id:string){if(!/^[a-f0-9]{64}$/.test(id))return Promise.reject(Error('自建变体编号无效'));return this.queue(`variant-library-${expId}`,async()=>{const row=((await this.variantLibraryIndex(expId)).value??[]).find(r=>r.id===id);if(!row)throw Error('自建变体不存在');const entry=(await this.read(`variant-entry-${expId}-${id}`,validVariantArchive)).value;if(!entry||entry.experimentId!==expId||entry.id!==id||entry.section!==row.section||entry.index!==row.index||await archiveId(entry)!==id)throw Error('自建变体未能核实');return entry;});}
  removeVariantArchive(expId:string,id:string){if(!/^[a-f0-9]{64}$/.test(id))return Promise.reject(Error('自建变体编号无效'));const key=`variant-library-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{const rows=(await this.variantLibraryIndex(expId)).value??[],next=rows.filter(r=>r.id!==id);await this.write(key,next);await this.write(key,next);for(const slot of ['a','b'])await this.store.remove(`variant-entry-${expId}-${id}-${slot}`);});}
  clearVariantLibrary(expId:string,cleanup:()=>Promise<void>){if(!/^[a-f0-9]{12}$/.test(expId))return Promise.reject(Error('实验标识无效'));const key=`variant-library-${expId}`;this.epochs.set(key,(this.epochs.get(key)??0)+1);return this.queue(key,async()=>{await cleanup();this.revisions.delete(key);});}
  loadTutorialProgress() {
    return this.queue("api-tutorial", async () => {
      const result = await this.read("api-tutorial", (raw): raw is number[] => Array.isArray(raw) && raw.length <= 4 && raw.every(n => Number.isInteger(n) && n >= 0 && n < 4) && new Set(raw).size === raw.length);
      return result.value ?? [];
    });
  }
  saveTutorialProgress(completed: number[]) {
    const value = [...new Set(completed.filter(n => Number.isInteger(n) && n >= 0 && n < 4))].sort();
    return this.queue("api-tutorial", () => this.write("api-tutorial", value));
  }
  private queue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const job = (this.jobs.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(task);
    this.jobs.set(key, job);
    return job;
  }
  private async read<T>(
    key: string,
    valid: (raw: unknown) => raw is T,
  ): Promise<{ value: T | null; warning: string; revision: number }> {
    const values = await Promise.all(
      ["a", "b"].map((x) => this.store.read(`${key}-${x}`)),
    );
    const entries: Envelope[] = [];
    let broken = 0;
    for (const text of values) {
      if (text === null) continue;
      try {
        if (text.length > 2 * 1024 * 1024) throw Error();
        const e = JSON.parse(text) as Envelope;
        if (
          !Number.isSafeInteger(e.revision) ||
          e.revision < 1 ||
          !valid(e.payload) ||
          (await checksum(JSON.stringify(e.payload))) !== e.digest
        )
          throw Error();
        entries.push(e);
      } catch {
        broken++;
      }
    }
    entries.sort((a, b) => b.revision - a.revision);
    const item = entries[0];
    if (!item && broken)
      throw Error(
        "本机数据损坏，未覆盖原文件。可重试读取，或清除该实验后重新录入。",
      );
    this.revisions.set(key, item?.revision ?? 0);
    return {
      value: (item?.payload as T) ?? null,
      warning: broken ? "一份保存副本异常，已读取可用副本，请核对数据。" : "",
      revision: item?.revision ?? 0,
    };
  }
  private async write(key: string, payload: unknown) {
    const revision = (this.revisions.get(key) ?? 0) + 1;
    const e = {
      revision,
      payload,
      digest: await checksum(JSON.stringify(payload)),
    };
    await this.store.write(
      `${key}-${revision % 2 ? "a" : "b"}`,
      JSON.stringify(e),
    );
    this.revisions.set(key, revision);
  }
  async load(exp: Experiment) {
    const key = `record-${exp.id}`;
    return this.queue(key, async () => {
      const recovered = await this.recoverInterruptedReset(exp, key);
      const r = await this.read(key, (raw): raw is RecordData =>
        validRecord(exp, raw),
      );
      return { record: r.value ?? recordBlank(exp), warning: [recovered ? '上次清除未完成，已恢复原测量数据，请核对。' : '', r.warning].filter(Boolean).join(' ') };
    });
  }
  private resetJournalValid(exp:Experiment, value:unknown):value is {state:'pending';record:RecordData}|{state:'committed'} {
    if(!value || typeof value!=='object' || Array.isArray(value))return false;
    const item=value as {state?:unknown;record?:unknown};
    return item.state==='committed' || (item.state==='pending' && validRecord(exp,item.record));
  }
  private async writeResetJournal(exp:Experiment, value:{state:'pending';record:RecordData}|{state:'committed'}){
    const key=`reset-journal-${exp.id}`, expected=JSON.stringify(value), digest=await checksum(expected);
    await this.read(key,(v):v is typeof value=>this.resetJournalValid(exp,v));
    for(let i=0;i<2;i++){
      await this.write(key,value);const revision=this.revisions.get(key)!;
      const raw=await this.store.read(`${key}-${revision%2?'a':'b'}`);
      try{if(raw===null)throw Error();const copy=JSON.parse(raw) as Envelope;if(copy.revision!==revision||copy.digest!==digest||JSON.stringify(copy.payload)!==expected)throw Error();}catch{throw Error('清除恢复记录未能核实，请重试');}
    }
  }
  private async finishResetJournal(exp:Experiment){
    const key=`reset-journal-${exp.id}`;
    await this.writeResetJournal(exp,{state:'committed'});
    for(const slot of ['a','b'])await this.store.remove(`${key}-${slot}`);
    if(await this.store.read(key+'-a')!==null||await this.store.read(key+'-b')!==null)throw Error('清除恢复记录未能移除，请重试');
    this.revisions.delete(key);
  }
  private async recoverInterruptedReset(exp:Experiment,key:string){
    const journal=await this.read(`reset-journal-${exp.id}`,(v):v is {state:'pending';record:RecordData}|{state:'committed'}=>this.resetJournalValid(exp,v));
    if(!journal.value)return false;
    if(journal.value.state==='committed'){await this.finishResetJournal(exp);return false;}
    try{await this.read(key,(v):v is RecordData=>validRecord(exp,v));}catch(error){if(!(error instanceof Error)||!error.message.includes('本机数据损坏'))throw error;this.revisions.set(key,Date.now());}
    await this.writeRecordVerified(exp,key,journal.value.record,this.epochs.get(key)??0);
    await this.finishResetJournal(exp);
    return true;
  }
  private async writeRecordVerified(exp:Experiment,key:string,payload:RecordData,epoch:number){
    const expected=JSON.stringify(payload),digest=await checksum(expected),revisions:number[]=[];
    const verify=async(revision:number)=>{try{const raw=await this.store.read(key+'-'+(revision%2?'a':'b'));if(raw===null||raw.length>2*1024*1024)throw Error();const copy=JSON.parse(raw) as Envelope;if(copy.revision!==revision||copy.digest!==digest||JSON.stringify(copy.payload)!==expected||!validRecord(exp,copy.payload))throw Error();}catch{throw Error('测量数据保存未能核实，请重试');}};
    for(let i=0;i<2;i++){
      if((this.epochs.get(key)??0)!==epoch)throw Error('测量数据已变化，请重新读取');
      await this.write(key,payload);const revision=this.revisions.get(key)!;revisions.push(revision);await verify(revision);
    }
    for(const revision of revisions)await verify(revision);
    if((this.epochs.get(key)??0)!==epoch)throw Error('测量数据已变化，请重新读取');
  }
  save(exp: Experiment, record: RecordData) {
    const key = `record-${exp.id}`,
      epoch = this.epochs.get(key) ?? 0,
      payload = structuredClone(record);
    if (!validRecord(exp, payload))
      return Promise.reject(Error("表单结构异常，未写入数据"));
    return this.queue(key, async () => {
      if ((this.epochs.get(key) ?? 0) !== epoch) throw Error('测量数据已变化，请重新读取');
      await this.recoverInterruptedReset(exp,key);
      await this.read(key,(raw):raw is RecordData=>validRecord(exp,raw));
      await this.writeRecordVerified(exp,key,payload,epoch);
    });
  }
  reset(exp: Experiment, cleanup: () => Promise<void>) {
    const key = `record-${exp.id}`;
    const ocrKey=`ocr-${exp.id}`;this.epochs.set(ocrKey,(this.epochs.get(ocrKey)??0)+1);
    const epoch=(this.epochs.get(key) ?? 0) + 1;this.epochs.set(key,epoch);
    return this.queue(key, async () => {
      await this.recoverInterruptedReset(exp,key);
      let previous:RecordData|null=null;
      try {
        previous=(await this.read(key, (raw): raw is RecordData => validRecord(exp, raw))).value??recordBlank(exp);
      } catch (error) {
        if(!(error instanceof Error)||!error.message.includes('本机数据损坏'))throw error;
        this.revisions.set(key, Date.now());
      }
      if(previous)await this.writeResetJournal(exp,{state:'pending',record:previous});
      const blank = recordBlank(exp);
      await this.writeRecordVerified(exp,key,blank,epoch);
      await this.clearOCR(exp.id);
      await cleanup();
      if(previous)await this.finishResetJournal(exp);
      return blank;
    });
  }
  async loadProfile() {
    return this.queue("profile", async () => {
      const r = await this.read("profile",validStoredProfile);
      return cleanProfile(r.value);
    });
  }
  saveProfile(profile: Profile) {
    const value = cleanProfile(profile);
    return this.queue("profile", async () => {await this.read('profile',validStoredProfile);await this.writeProfileVerified(value);});
  }
  private async writeProfileVerified(value:Profile){
    const expected=JSON.stringify(value),digest=await checksum(expected),revisions:number[]=[];
    const verify=async(revision:number)=>{try{const raw=await this.store.read('profile-'+(revision%2?'a':'b'));if(raw===null||raw.length>2*1024*1024)throw Error();const copy=JSON.parse(raw) as Envelope;if(copy.revision!==revision||copy.digest!==digest||JSON.stringify(copy.payload)!==expected||!validStoredProfile(copy.payload))throw Error();}catch{throw Error('学生信息保存未能核实，请重试');}};
    for(let i=0;i<2;i++){await this.write('profile',value);const revision=this.revisions.get('profile')!;revisions.push(revision);await verify(revision);}
    for(const revision of revisions)await verify(revision);
  }
  mergeOCRProfile(patch:Partial<Profile>,expected:Profile){const copy=structuredClone(patch),baseline=structuredClone(expected),keys=Object.keys(copy) as (keyof Profile)[];
    if(!validStudentProfile(baseline)||!keys.length||keys.some(k=>!studentFields.some(f=>f.key===k))||!validStudentProfile({...{name:'',studentId:'',className:''},...copy})||keys.some(k=>!copy[k]?.trim()))return Promise.reject(Error('学生信息格式无效'));
    return this.queue('profile',async()=>{const current=cleanProfile((await this.read('profile',validStudentProfile)).value);if(keys.some(k=>current[k]!==baseline[k]))throw Error('学生信息已变化，请重读现有信息后核对');const next={...current,...copy};await this.writeProfileVerified(next);return next;});
  }
  async loadPhoto(id: string) {
    return this.queue('photo-'+id, async () => (await this.read('photo-'+id,(x):x is Photo=>validPhoto(id,x))).value);
  }
  savePhoto(id: string, photo: Photo) {
    if(!validPhoto(id,photo))return Promise.reject(Error('照片信息无效，未覆盖原照片'));
    const key='photo-'+id,payload=structuredClone(photo),epoch=this.epochs.get(key)??0;
    return this.queue(key,async()=>{
      if((this.epochs.get(key)??0)!==epoch)throw Error('照片操作已失效');
      try{await this.read(key,(x):x is Photo=>validPhoto(id,x));}
      catch{throw Error('照片索引无法读取，应用未删除原照片，请检查本机存储');}
      const expected=JSON.stringify(payload),digest=await checksum(expected),written:number[]=[];
      const verify=async(revision:number)=>{try{
        const raw=await this.store.read(key+'-'+(revision%2?'a':'b'));if(raw===null||raw.length>2*1024*1024)throw Error();
        const copy=JSON.parse(raw) as Envelope;
        if(copy.revision!==revision||copy.digest!==digest||JSON.stringify(copy.payload)!==expected||!validPhoto(id,copy.payload))throw Error();
      }catch{throw Error('照片索引回读未能核实，请重新打开实验检查');}};
      for(let i=0;i<2;i++){
        if((this.epochs.get(key)??0)!==epoch)throw Error('照片操作已失效');
        await this.write(key,payload);const revision=this.revisions.get(key)!;written.push(revision);await verify(revision);
      }
      for(const revision of written)await verify(revision);
      if((this.epochs.get(key)??0)!==epoch)throw Error('照片操作已失效');
    });
  }
  async removePhoto(id: string) {
    const key='photo-'+id;this.epochs.set(key,(this.epochs.get(key)??0)+1);
    return this.queue(key, async () => {
      await this.store.remove(key+'-a');
      await this.store.remove(key+'-b');
    });
  }
  loadReportSettings(id: string) {
    return this.queue(`options-${id}`, async () => {
      const r = await this.read(`options-${id}`, (x):x is ReportSettings=>validReportSettings(x)&&(!x.aiPlot||x.aiPlot.experimentId===id));
      return r.value ?? defaultReportSettings();
    });
  }
  inspectReportSettings(id:string){if(!/^[a-f0-9]{12}$/.test(id))return Promise.reject(Error('实验标识无效'));return this.queue(`options-${id}`,()=>this.read(`options-${id}`,(v):v is ReportSettings=>validReportSettings(v)&&(!v.aiPlot||v.aiPlot.experimentId===id)));}
  saveSectionSwitches(id:string,names:string[],disabled:string[],expected:string[]){
    if(!/^[a-f0-9]{12}$/.test(id))return Promise.reject(Error('实验标识无效'));
    const input=structuredClone({names,disabled,expected}),key=`options-${id}`;
    return this.queue(key,async()=>{
      const result=await this.read(key,(v):v is ReportSettings=>validReportSettings(v)&&(!v.aiPlot||v.aiPlot.experimentId===id));if(result.warning)throw Error('报告配置副本异常，请先在实验中核对，未覆盖配置');
      const next=mergeSectionSwitches(result.value??defaultReportSettings(),input.names,input.disabled,input.expected);if(!validReportSettings(next))throw Error('报告章节配置无效');
      try{await this.write(key,next);await this.write(key,next);}catch{throw Error('保存未能确认，请重新读取核对');}
      const check=await this.read(key,validReportSettings);if(check.warning||JSON.stringify(check.value)!==JSON.stringify(next))throw Error('章节保存回读未通过，请重新读取核对');return next.disabledSections;
    });
  }
  saveReportSettings(id: string, settings: ReportSettings) {
    if (!validReportSettings(settings)||(settings.aiPlot&&settings.aiPlot.experimentId!==id))
      return Promise.reject(Error("报告配置格式无效"));
    const payload = structuredClone(settings);
    return this.queue(`options-${id}`, () =>
      this.write(`options-${id}`, payload),
    );
  }
  loadReport(exp: Experiment) {
    return this.queue(`report-${exp.id}`, async () => {
      const r = await this.read(`report-${exp.id}`, (x): x is SavedReport =>
        validSavedReport(exp, x),
      );
      return r;
    });
  }
  saveReport(exp: Experiment, report: SavedReport) {
    const key = `report-${exp.id}`,
      epoch = this.epochs.get(key) ?? 0,
      payload = structuredClone(report);
    if (!validSavedReport(exp, payload))
      return Promise.reject(Error("报告记录格式无效"));
    return this.queue(key, async () => {
      if ((this.epochs.get(key) ?? 0) !== epoch) throw Error("报告任务已失效");
      // A queue may generate directly after a cold start, without loadReport.
      // Read the existing revision before choosing which recovery copy to replace.
      try{await this.read(key, (x): x is SavedReport => validSavedReport(exp, x));}
      catch{throw Error("报告索引无法读取，应用未删除原报告和测量数据，请先检查本机存储");}
      const expected=JSON.stringify(payload),digest=await checksum(expected),written:number[]=[];
      const verify=async(revision:number)=>{
        try{
          const raw=await this.store.read(key+'-'+(revision%2?'a':'b'));
          if(raw===null||raw.length>2*1024*1024)throw Error();
          const copy=JSON.parse(raw) as Envelope;
          if(copy.revision!==revision||copy.digest!==digest||JSON.stringify(copy.payload)!==expected||!validSavedReport(exp,copy.payload))throw Error();
        }catch{throw Error("报告索引回读未能核实，已保留报告文件，请重新读取检查");}
      };
      for(let i=0;i<2;i++){
        if ((this.epochs.get(key) ?? 0) !== epoch) throw Error("报告任务已失效");
        await this.write(key,payload);
        const revision=this.revisions.get(key)!;written.push(revision);
        // Never replace the remaining good copy before the first new copy is verified.
        await verify(revision);
      }
      for(const revision of written)await verify(revision);
      if ((this.epochs.get(key) ?? 0) !== epoch) throw Error("报告任务已失效");
    });
  }
  clearReports(id: string) {
    const key = `report-${id}`;
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    return this.queue(key, async () => {
      await this.store.remove(key + "-a");
      await this.store.remove(key + "-b");
      await this.queue(`options-${id}`, async () => {
        await this.store.remove(`options-${id}-a`);
        await this.store.remove(`options-${id}-b`);
      });
    });
  }
  deleteReport(exp: Experiment, generation: string, cleanup: () => Promise<void>) {
    const key = `report-${exp.id}`;
    return this.queue(key, async () => {
      const current = await this.read(key, (x): x is SavedReport => validSavedReport(exp, x));
      if (!current.value || current.value.generation !== generation) throw Error("报告已变化，请刷新列表后重新确认");
      this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
      // Keep measurements, photos, variants, charts configuration and imported AI text.
      // Keep the index while file cleanup is pending so failed cleanup stays visible/retryable.
      await cleanup();
      await this.store.remove(key + "-a");
      await this.store.remove(key + "-b");
    });
  }
}
