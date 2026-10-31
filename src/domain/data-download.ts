import type {DataManifest} from './data-package.ts';import {MAX_DATA_BYTES} from './data-package.ts';import type {DataEnvelope} from './data-update-store.ts';
export interface DownloadReply {found:boolean;body?:string;bytes?:number;}
export interface DataDownloadPort {
 manifest:(signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<DownloadReply>;
 bundle:(manifest:DataManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<DownloadReply>;
 inspectManifest:(raw:unknown)=>Promise<{manifest:DataManifest;available:boolean}>;
 inspect:(envelope:DataEnvelope)=>Promise<{version:string;bytes:number;notes:string}>;
}
const guard=(s:AbortSignal)=>{if(s.aborted)throw Error('更新下载已停止');};
export class DataDownload {
 private port:DataDownloadPort;
 constructor(port:DataDownloadPort){this.port=port;}
 async check(signal:AbortSignal,progress:(bytes:number,total:number)=>void=()=>{}){
  guard(signal);const reply=await this.port.manifest(signal,progress);guard(signal);
  if(reply.found===false)return {state:'unpublished' as const};
  if(reply.found!==true||typeof reply.body!=='string'||new TextEncoder().encode(reply.body).length>65536)throw Error('更新服务清单格式无效');
  let raw:unknown;try{raw=JSON.parse(reply.body.replace(/^\uFEFF/,''));}catch{throw Error('更新服务清单不是有效 JSON');}
  const checked=await this.port.inspectManifest(raw);guard(signal);
  return {state:checked.available?'available' as const:'current' as const,manifest:checked.manifest};
 }
 async download(manifest:DataManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void=()=>{}){
  guard(signal);const checked=await this.port.inspectManifest(structuredClone(manifest));guard(signal);
  const reply=await this.port.bundle(checked.manifest,signal,progress);guard(signal);
  if(reply.found!==true||typeof reply.body!=='string')throw Error('更新包未能完整下载');
  const bytes=new TextEncoder().encode(reply.body).length;if(bytes>MAX_DATA_BYTES||bytes!==checked.manifest.size||reply.bytes!==bytes)throw Error('更新包下载长度不匹配');
  const envelope={manifest:checked.manifest,body:reply.body},summary=await this.port.inspect(envelope);guard(signal);
  return {envelope,summary};
 }
}
