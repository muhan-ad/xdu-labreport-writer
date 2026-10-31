import type {AppManifest,InstalledApp} from '../domain/app-update.ts';
export interface AppNative{
 info():Promise<InstalledApp&{hasCache:boolean}>;
 manifest(v:{id:string}):Promise<{id:string;found:boolean;body?:string}>;
 download(v:{id:string;url:string;version:string;versionCode:number;minAndroid:number;size:number;sha256:string;certificateSha256:string}):Promise<{id:string;candidateId:string}>;
 cancel(v:{id:string}):Promise<void>;clear():Promise<void>;settings():Promise<void>;install(v:{candidateId:string;sha256:string;version:string;versionCode:number}):Promise<{state:'permission-required'|'opened'}>;
 addListener(event:'progress',listener:(p:{id:string;bytes:number;total:number})=>void):Promise<{remove:()=>Promise<void>}>;
}
export class AppUpdateRequests{
 private bridge:AppNative;
 constructor(bridge:AppNative){this.bridge=bridge;}
 async request(kind:'manifest'|'download',manifest:AppManifest|null,signal:AbortSignal,progress:(bytes:number,total:number)=>void){
  if(signal.aborted)throw Error('应用更新已停止');const id=crypto.randomUUID(),limit=manifest?.size??65536;let left=false,handle:{remove:()=>Promise<void>}|undefined,rejectStop:((e:Error)=>void)|undefined;
  const stopped=new Promise<never>((_,reject)=>rejectStop=reject),cancel=()=>{void this.bridge.cancel({id}).catch(()=>{});rejectStop?.(Error('应用更新已停止'));};signal.addEventListener('abort',cancel,{once:true});
  try{
   const registering=this.bridge.addListener('progress',p=>{if(!left&&!signal.aborted&&p.id===id&&Number.isFinite(p.bytes)&&Number.isFinite(p.total)&&p.bytes>=0&&p.total>=0&&p.bytes<=limit&&p.total<=limit&&(!p.total||p.bytes<=p.total))progress(p.bytes,p.total);});
   void registering.then(h=>{if(left)void h.remove().catch(()=>{});},()=>{});handle=await Promise.race([registering,stopped]);if(signal.aborted)throw Error('应用更新已停止');
   const result=await Promise.race([kind==='manifest'?this.bridge.manifest({id}):this.bridge.download({id,url:manifest!.url,version:manifest!.version,versionCode:manifest!.versionCode,minAndroid:manifest!.minAndroid,size:manifest!.size,sha256:manifest!.sha256,certificateSha256:manifest!.certificateSha256}),stopped]);
   if(signal.aborted||result.id!==id)throw Error('应用更新已停止或响应不匹配');return result;
  }finally{left=true;signal.removeEventListener('abort',cancel);void handle?.remove().catch(()=>{});}
 }
}
