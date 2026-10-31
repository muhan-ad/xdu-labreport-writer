import type {Experiment} from './types.ts';import type {ReportSettings,ReportSnapshot} from './reports.ts';
import {parseAIJson} from './ocr.ts';import {convert} from './model.ts';import {reportSystemPrompt,measurementContext,validCalculationContext,type CalculationContext,type ExperimentKnowledge} from './ai-context.ts';
import type {Skill} from './ai-library.ts';import type {AIPreferences} from './ai-preferences.ts';import {reviewImportedTexts} from './ai-import-review.ts';
import {requestKnowledge,type AIKnowledgePolicy} from './ai-knowledge-policy.ts';
export class ReportPreparationError extends Error {}
export const validQuizQuestions=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>=1&&v.length<=12&&v.every(q=>typeof q==='string'&&!!q.trim()&&q.length<=1000);
export interface QuizPort {
 status:()=>Promise<{hasKey:boolean}>;skills:()=>Promise<Skill[]>;knowledge:(id:string)=>Promise<ExperimentKnowledge>;knowledgePolicy:()=>Promise<AIKnowledgePolicy>;preferences:(id:string)=>Promise<AIPreferences>;
 calculate:(exp:Experiment,snapshot:ReportSnapshot,progress:(s:string)=>void)=>Promise<CalculationContext>;
 complete:(messages:{role:'system'|'user';content:string}[],signal:AbortSignal)=>Promise<{text:string}>;
 confirm:(title:string,body:string,signal?:AbortSignal)=>Promise<boolean>;
}
export type PreparedQuiz={quiz:NonNullable<ReportSettings['ai']>['customQuiz'];notices:string[]};
export async function generateQuiz(port:QuizPort,exp:Experiment,snapshot:ReportSnapshot,signal:AbortSignal,fresh:()=>Promise<void>,progress:(s:string)=>void):Promise<PreparedQuiz>{
 const questions=structuredClone(snapshot.settings.customQuestions);if(!validQuizQuestions(questions))throw new ReportPreparationError('请先保存 1～12 道自定义思考题');
 let rejectStop:((error:Error)=>void)|undefined;const stopped=new Promise<never>((_,reject)=>rejectStop=reject),stop=()=>rejectStop?.(Error('已停止思考题生成'));signal.addEventListener('abort',stop,{once:true});const wait=<T>(work:Promise<T>)=>Promise.race([work,stopped]);
 const guard=async()=>{if(signal.aborted)throw Error('已停止思考题生成');await wait(fresh());if(signal.aborted)throw Error('已停止思考题生成');};
 try{await guard();progress('正在准备自定义思考题…');const status=await wait(port.status());await guard();if(!status.hasKey)throw Error('尚未配置报告问答 API Key，请在 AI 服务中配置后重试');
  const [skills,preferences,policy]=await wait(Promise.all([port.skills(),port.preferences(exp.id),port.knowledgePolicy()]));await guard();
  const knowledge=await wait(requestKnowledge(policy.kbOnly,()=>port.knowledge(exp.sourceId)));await guard();
  const converted=convert(exp.schema,snapshot.record.draft);if(converted.issues.length)throw Error(converted.issues[0].message);
  const calculation=await wait(port.calculate(exp,snapshot,progress));await guard();if(!validCalculationContext(calculation,exp.id,exp.sourceId))throw Error('本次计算结果未能核实');
  const reply=await wait(port.complete([{role:'system',content:reportSystemPrompt({name:exp.name,sourceId:exp.sourceId,experimentId:exp.id,knowledge,kbOnly:policy.kbOnly,skills,measurements:measurementContext(exp.schema,converted.data),calculation,kind:'quiz',preferences})},{role:'user',content:'按题目顺序仅返回 JSON {"answers":["答案1",...]}，保留 LaTeX 公式：'+JSON.stringify(questions)}],signal));await guard();
  if(typeof reply.text!=='string'||reply.text.length>100000)throw Error('思考题回答过长');const raw=parseAIJson(reply.text).answers;
  if(!Array.isArray(raw)||raw.length!==questions.length||raw.some(v=>typeof v!=='string'||!v.trim()||v.length>20000))throw Error('思考题答案数量或格式与题目不一致');
  const answers:Record<string,string[]>={},invalid:string[]=[],advisory=new Set<string>();
  raw.forEach((text,i)=>{try{if(reviewImportedTexts([{label:'第'+(i+1)+'题',text}],calculation.values)[0].warning)advisory.add(String(i+1));answers[String(i+1)]=[text];}catch(error){invalid.push((error as Error).message);}});await guard();
  const notices:string[]=[];if(invalid.length){if(!await wait(port.confirm('部分思考题答案需要处理',invalid.join('\n')+'\n相关答案留空后继续生成？',signal)))throw Error('已停止生成，请修改未通过校验的思考题');await guard();notices.push('部分思考题答案未通过校验，已按确认留空');}
  if(advisory.size)notices.push('第 '+[...advisory].join('、')+' 题数值待核对');const quiz={questions,answers};if(new TextEncoder().encode(JSON.stringify(quiz)).length>300000)throw Error('思考题回答过大');return {quiz,notices};
 }catch(error){if(signal.aborted)throw error;throw new ReportPreparationError((error as Error).message);}finally{signal.removeEventListener('abort',stop);}
}
