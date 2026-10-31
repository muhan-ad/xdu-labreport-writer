import publicKey from '../data/update-public-key.pem?raw';
import catalog from '../data/catalog.json';
import templates from '../data/report-variants.json';
import runtimeManifest from '../../public/report-runtime/manifest.json';
import app from '../../package.json';
import builtinCredits from '../data/credits.json';
import {parseCredits} from '../domain/credits.ts';
import type {Experiment} from '../domain/types.ts';
import {DataUpdateStore,type DataEnvelope} from '../domain/data-update-store.ts';
import {dataRuntimeHash,verifyDataPayload,type DataContext,type DataPayload} from '../domain/data-package.ts';
import {privateStore} from './storage.ts';
const context:Promise<DataContext>=dataRuntimeHash(runtimeManifest).then(runtimeHash=>({appVersion:app.version,currentVersion:'0.0.0',runtimeHash,experiments:catalog.experiments as Experiment[],publicKey}));
interface SessionData {payload:DataPayload|null;version:string;warning:string;resourceHash?:string;}
let manager:Promise<DataUpdateStore>|undefined,initial:Promise<SessionData>|undefined;
export const dataUpdateStore=()=>manager??=context.then(value=>new DataUpdateStore(privateStore,value));
// One immutable resource choice per app session. Switching persisted pointers takes
// effect only after a full user-requested reload, never halfway through a report.
export const dataSnapshot=():Promise<SessionData>=>initial??=dataUpdateStore().then(store=>store.load()).then(({payload,version,warning,envelope})=>({payload,version,warning,resourceHash:envelope?.manifest.sha256})).catch(()=>({payload:null,version:'0.0.0',warning:'更新资源未能读取，当前使用内置资源'}));
export async function reportTemplates():Promise<Record<string,Record<string,unknown>>>{return (await dataSnapshot()).payload?.variants??templates;}
export async function reportCredits(){
 const snapshot=await dataSnapshot(),raw=snapshot.payload?.sources['common/credits.json'];
 if(snapshot.payload){try{if(raw===undefined)throw Error('missing');return {credits:parseCredits(raw),warning:snapshot.warning};}catch{return {credits:parseCredits(builtinCredits),warning:'更新资源中的致谢名单不可用，当前显示内置名单'};}}
 return {credits:parseCredits(builtinCredits),warning:snapshot.warning};
}
export async function resolveReportData(candidate?:DataEnvelope){
 if(candidate)return verifyDataPayload(new TextEncoder().encode(candidate.body),candidate.manifest,await context);
 const current=await dataSnapshot();return current.payload?structuredClone(current.payload):null;
}
