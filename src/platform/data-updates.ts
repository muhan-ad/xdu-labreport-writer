import {dataUpdateStore,dataSnapshot} from './data-state.ts';
import {ReportEngine} from '../engine/client.ts';
import type {DataEnvelope} from '../domain/data-update-store.ts';
import {onlineDataUpdates} from './data-download.ts';
const engine=new ReportEngine();
export const dataUpdates={
 ...onlineDataUpdates,
 async status(){const store=await dataUpdateStore(),snapshot=await dataSnapshot();return {...await store.status(),sessionVersion:snapshot.version};},
 async inspect(envelope:DataEnvelope){return (await dataUpdateStore()).inspect(envelope);},
 async install(envelope:DataEnvelope,signal:AbortSignal,progress:(s:string)=>void,commit:()=>void){
  const copy={manifest:structuredClone(envelope.manifest),body:envelope.body},cancel=()=>engine.cancel();signal.addEventListener('abort',cancel,{once:true});
  try{const store=await dataUpdateStore();return await store.install(copy,()=>engine.diagnose(progress,copy),signal,commit);}finally{signal.removeEventListener('abort',cancel);}
 },
 async restore(){return (await dataUpdateStore()).restoreBuiltin();},
 reload(){location.reload();},
};
