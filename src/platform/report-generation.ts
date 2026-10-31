import {ReportGeneration} from '../domain/report-generation.ts';
import {calculationMeasurements} from '../domain/sound-phase.ts';
import {generateQuiz,type QuizPort} from '../domain/generation-quiz.ts';
import {ai} from './ai.ts';import {loadSkills} from './ai-library.ts';import {loadExperimentKnowledge} from './ai-context.ts';import {convert} from '../domain/model.ts';
import type {Repository} from '../domain/repository.ts';import type {ReportEngine} from '../engine/client.ts';
import {photoBase64,stageReport,pruneReportFiles,removeReportGeneration,binaryBase64} from './reports.ts';import {readAIPlotImage} from './ai-plot.ts';
export const defaultGenerationAI={status:ai.status.bind(ai),complete:ai.complete.bind(ai),skills:loadSkills,knowledge:loadExperimentKnowledge};
export type GenerationAI=typeof defaultGenerationAI;
export function reportGenerator(repo:Repository,engine:ReportEngine,options:{ai?:GenerationAI;confirm?:QuizPort['confirm']}={}){
 const adapter=options.ai??defaultGenerationAI;
 const quiz:QuizPort={status:()=>adapter.status('chat'),skills:adapter.skills,knowledge:adapter.knowledge,knowledgePolicy:()=>repo.loadAIKnowledgePolicy(),preferences:id=>repo.loadAIPreferences(id),calculate:(exp,snapshot,progress)=>engine.calculate({experimentId:exp.id,data:calculationMeasurements(exp,snapshot.record,convert(exp.schema,snapshot.record.draft).data),profile:{name:'',studentId:'',className:''},date:snapshot.record.date,options:{}},progress),complete:(messages,signal)=>adapter.complete('chat',messages,signal),confirm:options.confirm??(async()=>false)};
 return new ReportGeneration({generate:(job,progress)=>engine.generate(job,progress),cancel:()=>engine.cancel(),quiz:(exp,snapshot,signal,fresh,progress)=>generateQuiz(quiz,exp,snapshot,signal,fresh,progress),photo:photoBase64,plot:async(id,image)=>binaryBase64(await readAIPlotImage(id,image)),stage:stageReport,publish:(exp,saved)=>repo.saveReport(exp,saved),remove:removeReportGeneration,prune:pruneReportFiles});
}
