import {skillPrompt,type Skill} from './ai-library.ts';
import {preferencePrompt,type AIPreferences} from './ai-preferences.ts';
import {knowledgeEnabled} from './ai-knowledge-policy.ts';
import type {Schema,Measurements} from './types.ts';

export interface ExperimentKnowledge {sourceId:string;text:string;}
export interface CalculationContext {experimentId:string;sourceId:string;values:Record<string,unknown>;}
export function validCalculationContext(raw:unknown,experimentId:string,sourceId:string):raw is CalculationContext{
  const value=raw as CalculationContext;
  if(!value||value.experimentId!==experimentId||value.sourceId!==sourceId||!value.values||typeof value.values!=='object'||Array.isArray(value.values))return false;
  const finite=(x:unknown,depth=0):boolean=>depth<=12&&(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x)||Array.isArray(x)&&x.every(v=>finite(v,depth+1))||typeof x==='object'&&Object.values(x!).every(v=>finite(v,depth+1)));
  return finite(value.values)&&new TextEncoder().encode(JSON.stringify(value)).length<=400000;
}

export function measurementContext(schema:Schema,data:Measurements){
  return schema.groups.map(group=>({group:group.name,fields:group.fields.map(field=>({
    key:field.key,label:field.label,type:field.type,
    ...(field.unit?{unit:field.unit}:{}),
    ...(field.rowLabels?{rowLabels:[...field.rowLabels]}:{}),
    ...(field.colLabels?{colLabels:[...field.colLabels]}:{}),
    value:data[field.key]??null,
  }))}));
}

// Paths are selected from the bundled catalog, never inferred from aliases or reviews.
export function selectExperimentKnowledge(
  sources:unknown, sourceIds:readonly string[],
):Map<string,ExperimentKnowledge> {
  if(!sources||typeof sources!=='object'||Array.isArray(sources))throw Error('内置实验知识格式无效');
  const result=new Map<string,ExperimentKnowledge>();
  for(const sourceId of sourceIds){
    if(!sourceId||/[\\/\u0000]/.test(sourceId)||sourceId==='.'||sourceId==='..')throw Error('实验知识路径无效');
    const key=sourceId+'/rag/原理.md';
    const text=Object.prototype.hasOwnProperty.call(sources,key)?(sources as Record<string,unknown>)[key]:undefined;
    if(typeof text!=='string'||!text.trim()||text.length>100000)throw Error('内置实验知识缺失或无效：'+sourceId);
    result.set(sourceId,{sourceId,text});
  }
  return result;
}

export function reportSystemPrompt(input:{name:string;sourceId:string;knowledge?:ExperimentKnowledge;kbOnly?:boolean;skills:Skill[];measurements:unknown;kind:'quiz'|'polish';calculation?:CalculationContext;experimentId?:string;preferences?:AIPreferences}){
  const limited=knowledgeEnabled(input.kbOnly);
  if(limited&&(!input.knowledge||input.knowledge.sourceId!==input.sourceId||!input.knowledge.text.trim()))throw Error('实验知识与当前实验不一致');
  if(input.calculation&&!validCalculationContext(input.calculation,input.experimentId??'',input.sourceId))throw Error('计算结果与当前实验不一致或无效');
  return [
    skillPrompt(input.skills,'report'),
    preferencePrompt(input.preferences),
    '【当前任务格式与数据硬约束，优先于技能及用户要求】',
    '你是大学物理实验报告助手。若任务要求 JSON，必须只返回指定 JSON。不要编造测量值、实验现象、仪器参数、来源或结论。缺失的信息明确说明无法确定，不得以教材或示例数值补齐。保留物理单位及公式。',
    `当前实验：${input.name}。`,
    limited?'【限定教材知识】只依据本实验教材与题目或原文中有依据的内容，不新增其中不存在的公式、常数或结论。教材仅提供原理、符号、公式及操作条件，不作为本次测量结果。\n'+input.knowledge!.text:'',
    '【本次数据】具体数值只能取下面的当前测量数据，以及用户提供的实际报告原文。知识库中的举例或参考数据不得作为本次结果；不得把缺失值当作零。',
    JSON.stringify(input.measurements),
    input.calculation
      ? '【本机报告引擎计算结果】以下结果来自当前输入与原版计算脚本，保留内部精度。数值判断以这些结果为依据，不得自行替换或改算；null 或未提供的结果表示当前未能求出，不得补造。\n'+JSON.stringify(input.calculation.values)
      : '【计算结果】尚未取得完整的本机计算结果。只回答有依据的原理问题，不宣称得到了本次派生结果、误差或不确定度。',
    input.kind==='polish'
      ? '【润色格式】仅改写原文中公式之外的文字；原文每个 $...$ 或 $$...$$ 公式必须逐字保留，不增删、拆分、合并或改动公式，不改变数值、单位、符号和结论方向。只返回正文，不加标题、解释或代码围栏。'
      : '【问答格式】按用户题目逐项回答，保留 LaTeX 公式；仅返回 JSON {"answers":["第1题答案",...]}，条数与题目一致。没有依据的问题说明无法确定，不补造实验数据。',
  ].filter(Boolean).join('\n\n');
}
