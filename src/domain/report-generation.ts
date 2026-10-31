import type {Experiment,Photo} from './types.ts';
import type {ReportSnapshot,SavedReport} from './reports.ts';
import {sameReportInputs,reportFilename} from './reports.ts';
import {inspect,convert} from './model.ts';
import {calculationMeasurements,recordSource} from './sound-phase.ts';
import {variantChoices} from './variant-edits.ts';
import {plotFigures} from './ai-plot.ts';
import {chartWidth} from './chart-width.ts';
import {textHash} from './ai-library.ts';
import type {EngineJob,EngineResult} from '../engine/client.ts';
import {ReportPreparationError,type PreparedQuiz} from './generation-quiz.ts';
export interface GenerationPort {
 generate:(job:Omit<EngineJob,'mode'>,progress:(s:string)=>void)=>Promise<EngineResult>;
 cancel:()=>void;
 quiz?:(exp:Experiment,snapshot:ReportSnapshot,signal:AbortSignal,fresh:()=>Promise<void>,progress:(s:string)=>void)=>Promise<PreparedQuiz>;
 photo:(photo:Photo)=>Promise<string>;
 plot:(id:string,image:NonNullable<ReportSnapshot['settings']['aiPlot']>['image'])=>Promise<string>;
 stage:(id:string,generation:string,result:EngineResult)=>Promise<SavedReport['charts']>;
 publish:(exp:Experiment,report:SavedReport)=>Promise<void>;
 remove:(id:string,generation:string)=>Promise<void>;
 prune:(report:SavedReport)=>Promise<void>;
}
export interface GenerationInput {exp:Experiment;snapshot:ReportSnapshot;templates:Record<string,unknown>;photo:Photo|null;fresh:()=>Promise<ReportSnapshot>;}
export const reportAISource=(snapshot:ReportSnapshot)=>recordSource(snapshot.resourceHash,snapshot.record);
export class ReportGeneration {
 private port:GenerationPort;
 constructor(port:GenerationPort){this.port=port;}
 async run(input:GenerationInput,signal:AbortSignal,progress:(s:string)=>void,phase:(s:'computing'|'saving')=>void){
  const snapshot=structuredClone(input.snapshot),exp=input.exp,settings=snapshot.settings,generation=crypto.randomUUID();let staged=false,publishAttempt=false;
  const guard=async()=>{if(signal.aborted)throw Error('已取消生成');if(!sameReportInputs(snapshot,await input.fresh()))throw Error('录入内容或报告配置已变化，本次结果未启用');if(signal.aborted)throw Error('已取消生成');};
  const source=reportAISource(snapshot),notices:string[]=[],imported=settings.ai?.source===source?settings.ai:undefined;
  if(settings.ai&&!imported)notices.push('旧 AI 导入内容对应的数据已变化，本次使用原有章节');
  if(imported?.reviewWarnings&&Object.keys(imported.reviewWarnings).length)notices.push(('AI 导入内容数值待核对：'+Object.keys(imported.reviewWarnings).join('、')).slice(0,1000));
  const issues=inspect(exp.schema,snapshot.record.draft);if(issues.length)throw Error(issues[0].message);const measurements=calculationMeasurements(exp,snapshot.record,convert(exp.schema,snapshot.record.draft).data);
  if(snapshot.photoPath!==(input.photo?.path??null))throw Error('原始照片已变化');
  const variants=variantChoices(input.templates,settings.customVariants),choices:Record<string,number>={};
  for(const [name,values] of Object.entries(variants))if(Array.isArray(values)&&values.length){const choice=settings.variants[name]??0;choices[name]=choice<0?Math.floor(Math.random()*values.length):choice;if(choices[name]>=values.length)throw Error('章节变体已变化，请重新选择');}
  const cancel=()=>this.port.cancel();signal.addEventListener('abort',cancel,{once:true});
  try{
   await guard();phase('computing');for(const notice of notices)progress(notice);let quiz=imported?.customQuiz;
   if(settings.customQuestions){if(!this.port.quiz)throw new ReportPreparationError('生成前回答尚未接入');const prepared=await this.port.quiz(exp,snapshot,signal,guard,progress);await guard();quiz=prepared.quiz;notices.push(...prepared.notices);}
   const photo=settings.embedPhoto&&input.photo?await this.port.photo(input.photo):undefined;
   let aiPlotImages:EngineJob['aiPlotImages'];const selected=settings.aiPlot;
   if(selected&&plotFigures(selected).some(f=>f.embed)){
    chartWidth(selected.widthCm);
    if(selected.experimentId!==exp.id||selected.sourceHash!==await textHash(source))throw Error('AI 图表对应的数据已变化，请重新预览并采用，或移除旧图');
    aiPlotImages=[];for(const figure of plotFigures(selected).filter(f=>f.embed))aiPlotImages.push({base64:await this.port.plot(exp.id,figure.image),sha256:figure.image.sha256,caption:figure.caption,section:figure.section,...(selected.widthCm===undefined?{}:{widthCm:selected.widthCm})});
   }
   await guard();const result=await this.port.generate({experimentId:exp.id,data:measurements,profile:snapshot.profile,date:snapshot.record.date,options:{variants:choices,disabledSections:settings.disabledSections,...(quiz?{customQuiz:quiz}:{}),...(imported?.polish?{polish:imported.polish}:{}),...(settings.variantEdits?{variantEdits:settings.variantEdits}:{}),...(settings.customVariants?{customVariants:settings.customVariants}:{}),customCharts:settings.customCharts??[],...(settings.officialCharts?{officialCharts:settings.officialCharts}:{})},...(photo?{photoBase64:photo}:{}),...(aiPlotImages?{aiPlotImages}:{})},s=>{if(!signal.aborted)progress(s);});
   await guard();phase('saving');progress('正在保存报告与图表…');staged=true;const charts=await this.port.stage(exp.id,generation,result);await guard();
   const saved:SavedReport={version:1,experimentId:exp.id,generation,createdAt:new Date().toISOString(),name:reportFilename(exp.name),formulaCount:result.metadata.formulaCount,...(notices.length?{notices}:{}),sections:result.metadata.sections,copySections:result.metadata.copySections,copyIssues:result.metadata.copyIssues,headings:result.metadata.headings,charts,snapshot};
   // A failed publish may have written one recovery copy. Keep staged files then.
   publishAttempt=true;await this.port.publish(exp,saved);await this.port.prune(saved).catch(()=>progress('报告已保存，旧缓存可在清除数据时清理'));return saved;
  }catch(error){if(staged&&!publishAttempt)await this.port.remove(exp.id,generation).catch(()=>{});throw error;}finally{signal.removeEventListener('abort',cancel);}
 }
}
