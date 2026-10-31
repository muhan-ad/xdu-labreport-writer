import type {Experiment,Measurements,RecordData} from './types.ts';
export type SoundPhaseMode='alternating'|'same';
export const isSoundExperiment=(exp:Pick<Experiment,'sourceId'>)=>exp.sourceId==='声速的测量（空气）'||exp.sourceId==='声速的测量（水中）';
export const validSoundPhase=(value:unknown):value is SoundPhaseMode=>value==='alternating'||value==='same';
export function importedSoundPhase(exp:Experiment,raw:unknown):SoundPhaseMode|undefined {
 if(!isSoundExperiment(exp)||!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
 const value=raw as {format?:unknown;soundPhase?:unknown};
 if(value.format!=='lab-maker-measurements'||value.soundPhase===undefined)return undefined;
 if(!validSoundPhase(value.soundPhase))throw Error('位相记录间隔无效，未导入数据');
 return value.soundPhase;
}
/** No legacy default: position spacing cannot be inferred safely from measurements. */
export function calculationMeasurements(exp:Experiment,record:RecordData,data:Measurements):Measurements {
 if(!isSoundExperiment(exp))return data;
 if(!validSoundPhase(record.soundPhase))throw Error('请先在位相比较法中选择相邻记录点的间隔');
 return {...data,phase_step:record.soundPhase==='alternating'?0.5:1};
}
export function recordSource(resourceHash:string|undefined,record:RecordData){
 return JSON.stringify({resourceHash,draft:record.draft,date:record.date,...(record.soundPhase?{soundPhase:record.soundPhase}:{})});
}
