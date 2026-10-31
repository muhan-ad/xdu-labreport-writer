import type {AIHistorySummary} from './ai-library.ts';
import type {ReportSettings} from './reports.ts';
export interface HistoryContext {source:string;sourceHash:string;settings:ReportSettings;warning:string;}
export function historyUseState(row:AIHistorySummary,context:HistoryContext|null){
  if(!context||context.warning)return '数据待核实';
  if(row.sourceHash!==context.sourceHash)return '数据已变化';
  const ai=context.settings.ai,refs=ai?.historyRefs;
  const linked=row.kind==='quiz'?!!ai?.customQuiz&&refs?.quiz===row.id:typeof ai?.polish?.[row.section]==='string'&&refs?.polish?.[row.section]===row.id;
  return linked&&ai?.source===context.source?'当前已导入':'数据匹配';
}
