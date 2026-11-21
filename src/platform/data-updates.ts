import {dataUpdateStore,dataSnapshot} from './data-state.ts';
import type {DataEnvelope} from '../domain/data-update-store.ts';
import {onlineDataUpdates} from './data-download.ts';
export const dataUpdates={
 ...onlineDataUpdates,
 async status(){const store=await dataUpdateStore(),snapshot=await dataSnapshot();return {...await store.status(),sessionVersion:snapshot.version};},
 async inspect(envelope:DataEnvelope){return (await dataUpdateStore()).inspect(envelope);},
 async install(envelope:DataEnvelope,signal:AbortSignal,_progress:(s:string)=>void,commit:()=>void){
  return (await dataUpdateStore()).install(envelope,null,signal,commit);
 },
 async restore(){return (await dataUpdateStore()).restoreBuiltin();},
 reload(){location.reload();},
};
