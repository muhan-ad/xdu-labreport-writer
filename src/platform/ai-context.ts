import catalog from '../data/catalog.json';
import {createKnowledgeLoader} from '../domain/ai-knowledge.ts';
import {dataSnapshot} from './data-state.ts';
import {selectExperimentKnowledge} from '../domain/ai-context.ts';

// Cache selected Markdown (~25K chars), not the Python source archive or measurements.
const loadBuiltinKnowledge=createKnowledgeLoader(
  catalog.experiments.map(e=>e.sourceId),
  name=>fetch(new URL('/report-runtime/'+name,location.href)),
);
export async function loadExperimentKnowledge(sourceId:string){const current=await dataSnapshot();if(current.payload){if(!catalog.experiments.some(e=>e.sourceId===sourceId))throw Error('未找到对应实验知识');return selectExperimentKnowledge(current.payload.sources,[sourceId]).get(sourceId)!;}return loadBuiltinKnowledge(sourceId);}
