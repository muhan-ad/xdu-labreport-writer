import type {DataManifest} from '../domain/data-package.ts';import type {DownloadReply} from '../domain/data-download.ts';
interface NativeReply extends DownloadReply {id:string;}
export interface DataNative {
 manifest(v:{id:string}):Promise<NativeReply>;bundle(v:{id:string;url:string;version:string;size:number;sha256:string}):Promise<NativeReply>;cancel(v:{id:string}):Promise<unknown>;
 addListener(event:'progress',listener:(p:{id:string;bytes:number;total:number})=>void):Promise<{remove:()=>Promise<void>}>;
}
export class MobileDataRequests {
 private bridge:DataNative;private platform:()=>string;
 constructor(bridge:DataNative,platform:()=>string){this.bridge=bridge;this.platform=platform;}
 manifest(signal:AbortSignal,progress:(bytes:number,total:number)=>void){return this.request('manifest',undefined,signal,progress);}
 bundle(manifest:DataManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void){return this.request('bundle',manifest,signal,progress);}
 private async request(kind:'manifest'|'bundle',manifest:DataManifest|undefined,signal:AbortSignal,progress:(bytes:number,total:number)=>void){
  if(this.platform()!=='android')throw Error('当前平台的在线更新尚未接入');if(signal.aborted)throw Error('更新下载已停止');
  const id=crypto.randomUUID();let left=false,listener:{remove:()=>Promise<void>}|undefined,rejectStop:((e:Error)=>void)|undefined;
  const stopped=new Promise<never>((_,reject)=>rejectStop=reject),cancel=()=>{void this.bridge.cancel({id}).catch(()=>{});rejectStop?.(Error('更新下载已停止'));};
  signal.addEventListener('abort',cancel,{once:true});
  try{
   const limit=kind==='manifest'?65536:manifest!.size;
   const registering=this.bridge.addListener('progress',p=>{if(!left&&p.id===id&&!signal.aborted&&Number.isFinite(p.bytes)&&Number.isFinite(p.total)&&p.bytes>=0&&p.total>=0&&p.bytes<=limit&&p.total<=limit&&(!p.total||p.bytes<=p.total))progress(p.bytes,p.total);});
   void registering.then(handle=>{if(left)void handle.remove().catch(()=>{});},()=>{});
   listener=await Promise.race([registering,stopped]);if(signal.aborted)throw Error('更新下载已停止');
   const work=kind==='manifest'?this.bridge.manifest({id}):this.bridge.bundle({id,url:manifest!.url,version:manifest!.dataVersion,size:manifest!.size,sha256:manifest!.sha256});
   const result=await Promise.race([work,stopped]);if(signal.aborted)throw Error('更新下载已停止');if(result.id!==id)throw Error('更新下载响应标识不匹配');return result;
  }finally{left=true;signal.removeEventListener('abort',cancel);void listener?.remove().catch(()=>{});}
 }
}
