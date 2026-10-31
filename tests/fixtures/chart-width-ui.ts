import {Reports} from '../../src/features/reports.ts';
import {AIPlotView} from '../../src/features/ai-plot.ts';
import {Repository} from '../../src/domain/repository.ts';
import {defaultReportSettings} from '../../src/domain/reports.ts';
import {recordBlank,makeDraft} from '../../src/domain/model.ts';
import catalog from '../../src/data/catalog.json';
import samples from './measurements.json';
import type {Experiment} from '../../src/domain/types.ts';
import type {AdoptedAIPlot} from '../../src/domain/ai-plot.ts';
export async function createChartWidthFixture(){
 const exp=catalog.experiments.find(e=>e.sourceId==='直螺线管磁场分布的测量') as Experiment,doc=recordBlank(exp),data=new Map<string,string>();
 doc.draft=makeDraft(exp.schema,(samples as Record<string,unknown>)[exp.id]);
 const repo=new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{data.set(k,v)},remove:async k=>{data.delete(k)}});
 let asks=0,saves=0,selection:AdoptedAIPlot|undefined,view:AIPlotView|undefined;
 const report=new Reports(repo,{context:()=>({exp,doc,profile:{name:'',studentId:'',className:''},photo:null,blocked:false}),flush:async()=>{},notice:()=>{},confirm:async()=>true,jump:()=>{},configureAI:()=>{},upload:()=>{}});
 await report.open();
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 async function ai(){report.close();view?.leave();selection=(await repo.loadReportSettings(exp.id)).aiPlot;view=new AIPlotView({context:()=>({experimentId:exp.id,source:'width-test-data',data:{x:[1,2]},sections:['数据处理','结论']}),selection:()=>selection,ask:async()=>{asks++;return 'print(DATA)'},run:async()=>({bytes:png,caption:'图一',logs:'',images:[{bytes:png,caption:'图一'},{bytes:png,caption:'图二'}]}),stage:async()=>({id:crypto.randomUUID(),sha256:'a'.repeat(64),bytes:png.length}),read:async()=>png,save:async(_id,value)=>{saves++;selection=value;await repo.saveReportSettings(exp.id,{...await repo.loadReportSettings(exp.id),aiPlot:value});},confirm:async()=>true,changed:()=>{}});view.mount(document.querySelector('#plot-host')!);}
 return {ai,settings:()=>repo.loadReportSettings(exp.id),state:()=>({asks,saves,busy:view?.isBusy||report.isSaving}),reopen:async()=>{await report.open()},legacy:async()=>{await repo.saveReportSettings(exp.id,defaultReportSettings());},close:()=>{report.close();view?.leave()}};
}
