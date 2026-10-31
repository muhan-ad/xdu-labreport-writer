import {Reports} from '../../src/features/reports.ts';
import {Repository} from '../../src/domain/repository.ts';
import {makeDraft} from '../../src/domain/model.ts';
import catalog from '../../src/data/catalog.json';
import samples from './measurements.json';
import type {Experiment} from '../../src/domain/types.ts';
export async function createOfficialFixture(imageBase64:string){
 const values=new Map<string,string>();let failed=false,calls=0,pending=false,resolveLate:((value:unknown)=>void)|undefined;
 const repo=new Repository({read:async key=>values.get(key)??null,write:async(key,value)=>{if(failed)throw Error('模拟保存失败');values.set(key,value);},remove:async key=>{values.delete(key);}});
 let exp=catalog.experiments.find(e=>e.sourceId==='RLC电路的稳态特性研究实验') as Experiment;
 const context=()=>({exp,doc:{version:1 as const,experimentId:exp.id,date:'2026-10-24',updatedAt:new Date().toISOString(),draft:makeDraft(exp.schema,(samples as Record<string,unknown>)[exp.id])},profile:{name:'模拟',studentId:'000000',className:'测试'},photo:null,blocked:false});
 const reports=new Reports(repo,{context,flush:async()=>{},confirm:async()=>true,notice:()=>{},jump:()=>{},configureAI:()=>{},upload:()=>{throw Error('不应上传');}});
 const fake={generate:async(job:{options:{officialCharts:{preset:string}}})=>{calls++;const response={charts:(job.options.officialCharts.preset==='all'?['幅频特性','相频特性']:['幅频特性']).map(name=>({name,bytes:Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0))})),metadata:{},docx:new Uint8Array()};if(pending)return new Promise(resolve=>{resolveLate=resolve;});return response;},cancel:()=>{}};
 Object.assign(reports,{engine:fake});
 const open=async()=>{await reports.open();document.querySelector<HTMLButtonElement>('[data-report-tab=charts]')!.click();};await open();
 return {state:async()=>({calls,settings:await repo.loadReportSettings(exp.id)}),backPreview:()=>reports.closeTopPreview(),fail:(v:boolean)=>{failed=v;},pending:()=>{pending=true;},late:()=>{resolveLate?.({charts:[{name:'过期结果',bytes:new Uint8Array([1])}]});pending=false;},reopen:async()=>{reports.close();await open();},close:()=>reports.close(),switch:async(sourceId:string)=>{reports.close();exp=catalog.experiments.find(e=>e.sourceId===sourceId) as Experiment;await open();}};
}
