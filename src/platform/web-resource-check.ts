import type {ResourceProgress, ResourceResult} from './resources.ts';

type Entry = {path:string;bytes:number;sha256:string};
const required=['index.html','report-worker.js','report-runtime/manifest.json','report-runtime/pyodide.asm.wasm'];
function validate(raw:unknown,version:string):Entry[]{
 const m=raw as {schema?:unknown;version?:unknown;scope?:unknown;files?:unknown};
 if(!m||m.schema!==1||m.version!==version||m.scope!=='shared-web-resources'||!Array.isArray(m.files)||m.files.length<1||m.files.length>3000)throw Error('共享资源清单缺失或版本不一致');
 const seen=new Set<string>();let total=0;
 for(const f of m.files){
  if(!f||typeof f.path!=='string'||!/^[-A-Za-z0-9._/]+$/.test(f.path)||f.path.length>240||f.path.split('/').some((p:string)=>!p||p==='.'||p==='..')||f.path==='web-resource-integrity.json'||seen.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>32*1024*1024||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('共享资源清单格式无效');
  seen.add(f.path);total+=f.bytes;if(total>250*1024*1024)throw Error('共享资源清单大小异常');
 }
 if(required.some(p=>!seen.has(p)))throw Error('共享资源清单缺少必要文件');
 return m.files as Entry[];
}
async function boundedRead(response:Response,limit:number,exact:boolean,signal:AbortSignal):Promise<Uint8Array>{
 if(!response.body)throw Error('当前平台无法安全读取资源');
 const reader=response.body.getReader(),buffer=new Uint8Array(limit);let used=0,done=false;
 try{
  while(true){
   if(signal.aborted)throw Error('检查已停止');
   const part=await reader.read();if(part.done){done=true;break;}
   if(!(part.value instanceof Uint8Array)||used+part.value.byteLength>limit)throw Error(exact?'文件大小不一致':'共享资源清单大小异常');
   buffer.set(part.value,used);used+=part.value.byteLength;
  }
  if(exact&&used!==limit)throw Error('文件大小不一致');
  return used===limit?buffer:buffer.subarray(0,used);
 }finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Checks only the signed application bundle's web files, not native iOS binaries. */
export class WebResourceChecker {
 private active:{id:string;controller:AbortController}|null=null;
 private listeners=new Set<(value:ResourceProgress)=>void>();
 private version:string;private read:typeof fetch;
 constructor(version:string,read?:typeof fetch){this.version=version;this.read=read??globalThis.fetch.bind(globalThis);}
 async progress(listener:(value:ResourceProgress)=>void){this.listeners.add(listener);return {remove:async()=>{this.listeners.delete(listener);}};}
 async cancel(id:string){if(this.active?.id===id)this.active.controller.abort();}
 async check(id:string):Promise<ResourceResult>{
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('检查标识无效');
  if(this.active)throw Error('资源检查正在进行，请稍候');
  const controller=new AbortController();this.active={id,controller};let files:Entry[]=[],checked=0,bytes=0;const problems:{path:string;reason:string}[]=[];
  try{
   const response=await this.read('./web-resource-integrity.json',{signal:controller.signal});
   if(!response.ok)throw Error('共享资源清单无法读取');const text=new TextDecoder('utf-8',{fatal:true}).decode(await boundedRead(response,2*1024*1024,false,controller.signal));
   let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('共享资源清单格式无效');}files=validate(raw,this.version);
   for(const f of files){
    if(controller.signal.aborted)break;
    try{
     const result=await this.read('./'+f.path.split('/').map(encodeURIComponent).join('/'),{signal:controller.signal});
     if(!result.ok)throw Error('读取失败');
     const content=await boundedRead(result,f.bytes,true,controller.signal);if(controller.signal.aborted)break;
     bytes+=content.byteLength;
     if(content.byteLength!==f.bytes)throw Error('文件大小不一致');
     const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('');
     if(controller.signal.aborted)break;
     if(digest!==f.sha256)throw Error('文件内容不一致');
    }catch(error){if(controller.signal.aborted)break;problems.push({path:f.path,reason:error instanceof Error&&['文件大小不一致','文件内容不一致','当前平台无法安全读取资源'].includes(error.message)?error.message:'读取失败'});}
    checked++;const value={id,checked,total:files.length,bytes,path:f.path};for(const listener of this.listeners)try{listener(value);}catch{}
   }
   const cancelled=controller.signal.aborted;
   return {id,version:this.version,scope:'shared',checked,total:files.length,bytes,problems,cancelled,complete:!cancelled&&checked===files.length&&!problems.length};
  }finally{if(this.active?.controller===controller)this.active=null;}
 }
}
