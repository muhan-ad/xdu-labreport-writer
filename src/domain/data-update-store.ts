import type {Store} from './repository.ts';
import {verifyDataManifest,verifyDataPayload,compareDataVersion,dataHash,stableJson,type DataManifest,type DataPayload,type DataContext} from './data-package.ts';
export interface DataEnvelope {manifest:DataManifest;body:string;}
interface Ref {version:string;sha:string;}
interface Pointer {seq:number;active:Ref|null;previous:Ref|null;}
interface Floor {seq:number;ref:Ref;}
export interface DataSnapshot {payload:DataPayload|null;envelope:DataEnvelope|null;version:string;warning:string;}
const enc=new TextEncoder(),hash=(s:string)=>dataHash(enc.encode(s));
const validRef=(r:unknown):r is Ref=>{const x=r as Ref;try{return !!x&&typeof x.sha==='string'&&typeof x.version==='string'&&/^[a-f0-9]{64}$/.test(x.sha)&&compareDataVersion(x.version,x.version)===0;}catch{return false;}};
export class DataUpdateStore {
 private queue:Promise<unknown>=Promise.resolve();private epoch=0;
 private store:Store;private context:DataContext;
 constructor(store:Store,context:DataContext){this.store=store;this.context=context;}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn,fn);this.queue=next.then(()=>undefined,()=>undefined);return next;}
 private async seal(payload:unknown){const body=stableJson(payload);return JSON.stringify({body,digest:await hash(body)});}
 private async open(text:string|null){if(text===null)return null;const raw=JSON.parse(text);if(typeof raw.body!=='string'||await hash(raw.body)!==raw.digest)throw Error('更新存储校验失败');return JSON.parse(raw.body);}
 private async metadata<T>(key:string,valid:(x:any)=>boolean):Promise<{value:T|null;warning:boolean}>{
  const found:T[]=[];let errors=0,present=0;
  for(const suffix of ['a','b'])try{const text=await this.store.read(key+'-'+suffix);if(text!==null){present++;const value=await this.open(text);if(!valid(value))throw Error();found.push(value);}}catch{errors++;}
  if(!found.length){if(present||errors)throw Error('更新状态未能读取，请重试；未修改当前资源');return {value:null,warning:false};}
  if(found.length===2&&(found[0] as any).seq===(found[1] as any).seq&&stableJson(found[0])!==stableJson(found[1]))throw Error('更新状态副本冲突，未修改资源');
  found.sort((a:any,b:any)=>b.seq-a.seq);return {value:found[0],warning:errors>0||found.length<2};
 }
 private pointer(){return this.metadata<Pointer>('data-active',x=>x&&Number.isSafeInteger(x.seq)&&x.seq>=1&&(x.active===null||validRef(x.active))&&(x.previous===null||validRef(x.previous)));}
 private floor(){return this.metadata<Floor>('data-floor',x=>x&&Number.isSafeInteger(x.seq)&&x.seq>=1&&validRef(x.ref));}
 private async writeSlot(key:string,value:string){try{await this.store.write(key,value);}catch{}if(await this.store.read(key)!==value)throw Error('更新状态保存后回读不一致');}
 private async both(key:string,value:unknown){const text=await this.seal(value);await this.writeSlot(key+'-a',text);await this.writeSlot(key+'-b',text);}
 private async readBundle(ref:Ref):Promise<{payload:DataPayload;envelope:DataEnvelope}>{
  for(const suffix of ['a','b'])try{
   const text=await this.store.read('data-bundle-'+ref.sha+'-'+suffix);if(!text)throw Error();const envelope=JSON.parse(text) as DataEnvelope;
   if(!envelope||envelope.manifest?.sha256!==ref.sha||envelope.manifest?.dataVersion!==ref.version||typeof envelope.body!=='string')throw Error();
   const payload=await verifyDataPayload(enc.encode(envelope.body),envelope.manifest,{...this.context,currentVersion:'0.0.0'});return {payload,envelope};
  }catch{}
  throw Error('已下载的数据包未能核实');
 }
 private async loadNow():Promise<DataSnapshot>{
  let p;try{p=await this.pointer();}catch(e){return {payload:null,envelope:null,version:'0.0.0',warning:(e as Error).message+'，当前使用内置资源'};}
  if(!p.value?.active)return {payload:null,envelope:null,version:'0.0.0',warning:p.warning?'更新状态副本异常，当前使用内置资源':''};
  try{const found=await this.readBundle(p.value.active);return {...found,version:p.value.active.version,warning:p.warning?'更新状态从完好副本恢复':''};}
  catch{if(p.value.previous)try{const found=await this.readBundle(p.value.previous);return {...found,version:p.value.previous.version,warning:'最新数据包未能核实，当前使用上一份完好资源'};}catch{}
   return {payload:null,envelope:null,version:'0.0.0',warning:'更新资源未能核实，当前使用内置资源'};
  }
 }
 load(){return this.serial(()=>this.loadNow());}
 inspectManifest(raw:unknown){const copy=structuredClone(raw);return this.serial(async()=>{
  const manifest=await verifyDataManifest(copy,{...this.context,currentVersion:'0.0.0'}),floor=await this.floor(),pointer=await this.pointer();
  for(const ref of [floor.value?.ref,pointer.value?.active])if(ref){const order=compareDataVersion(manifest.dataVersion,ref.version);if(order<0||(order===0&&manifest.sha256!==ref.sha))throw Error('更新服务提供的版本较旧，或同一版本内容已变化，未下载');}
  const active=await this.loadNow();return {manifest,available:active.envelope?.manifest.sha256!==manifest.sha256};
 });}
 status(){return this.serial(async()=>{const snapshot=await this.loadNow();try{const floor=await this.floor();return {version:snapshot.version,warning:snapshot.warning,highestVersion:floor.value?.ref.version??'0.0.0',downloaded:!!snapshot.payload};}catch{return {version:snapshot.version,warning:[snapshot.warning,'更新版本保护状态未能读取，暂不能安装更新'].filter(Boolean).join('；'),highestVersion:'unknown',downloaded:!!snapshot.payload};}});}
 private async inspectNow(envelope:DataEnvelope){
  if(!envelope||typeof envelope.body!=='string')throw Error('请选择签名清单和对应数据包');
  const payload=await verifyDataPayload(enc.encode(envelope.body),envelope.manifest,{...this.context,currentVersion:'0.0.0'}),floor=await this.floor(),pointer=await this.pointer();
  const ref={version:payload.dataVersion,sha:envelope.manifest.sha256};
  for(const old of [floor.value?.ref,pointer.value?.active])if(old){const order=compareDataVersion(ref.version,old.version);if(order<0||(order===0&&ref.sha!==old.sha))throw Error('此包版本较旧，或同一版本的内容已变化，未启用');}
  return {payload,ref,floor,pointer};
 }
 inspect(envelope:DataEnvelope){const copy={manifest:structuredClone(envelope.manifest),body:envelope.body};return this.serial(async()=>{const checked=await this.inspectNow(copy);return {version:checked.payload.dataVersion,bytes:copy.manifest.size,notes:copy.manifest.notes};});}
 install(envelope:DataEnvelope,preflight:(payload:DataPayload)=>Promise<{complete:boolean;problems?:unknown[]}>,signal:AbortSignal,onCommit:()=>void=()=>{}){
  const copy={manifest:structuredClone(envelope.manifest),body:envelope.body},epoch=this.epoch;
  return this.serial(async()=>{
   const guard=()=>{if(signal.aborted||epoch!==this.epoch)throw Error('更新操作已停止');};guard();
   const checked=await this.inspectNow(copy);guard();
   const alreadyReferenced=[checked.floor.value?.ref,checked.pointer.value?.active,checked.pointer.value?.previous].some(r=>r?.sha===checked.ref.sha);let commitStarted=false;
   try{const encoded=JSON.stringify(copy);await this.writeSlot('data-bundle-'+checked.ref.sha+'-a',encoded);await this.writeSlot('data-bundle-'+checked.ref.sha+'-b',encoded);guard();
   const probe=await preflight(checked.payload);guard();if(!probe.complete||probe.problems?.length)throw Error('新资源运行检查未通过，原资源继续使用');
   const prior=await this.loadNow();guard();onCommit();commitStarted=true;
   // High-water mark is durable in both slots before publishing a new active pointer.
   await this.both('data-floor',{seq:(checked.floor.value?.seq??0)+1,ref:checked.ref});
   const priorRef=prior.envelope?{version:prior.version,sha:prior.envelope.manifest.sha256}:null;
   const pointer:Pointer={seq:(checked.pointer.value?.seq??0)+1,active:checked.ref,previous:priorRef?.sha===checked.ref.sha?checked.pointer.value?.previous??null:priorRef};
   let published=0;const text=await this.seal(pointer);
   for(const slot of ['a','b'])try{await this.writeSlot('data-active-'+slot,text);published++;}catch{}
   if(!published)throw Error('资源切换状态待核实，请重新读取后确认；不会自动重复更新');
   const read=await this.pointer();if(read.value?.active?.sha!==checked.ref.sha)throw Error('资源切换回读失败，请重新打开核对');
   let cleanupWarnings=0;
   if(published===2)for(const ref of [checked.pointer.value?.previous,checked.floor.value?.ref])if(ref&&ref.sha!==pointer.active?.sha&&ref.sha!==pointer.previous?.sha)for(const slot of ['a','b'])try{await this.store.remove('data-bundle-'+ref.sha+'-'+slot);}catch{cleanupWarnings++;}
   return {committed:true,version:checked.ref.version,degraded:published<2,cleanupWarnings};
   }finally{if(!commitStarted&&!alreadyReferenced)for(const slot of ['a','b'])await this.store.remove('data-bundle-'+checked.ref.sha+'-'+slot).catch(()=>{});} 

  });
 }
 restoreBuiltin(){this.epoch++;return this.serial(async()=>{
  let pointer:{value:Pointer|null}={value:null};try{pointer=await this.pointer();}catch{}
  const next={seq:Math.max((pointer.value?.seq??0)+1,Date.now()),active:null,previous:pointer.value?.active??pointer.value?.previous??null},text=await this.seal(next);let published=0;
  for(const slot of ['a','b'])try{await this.writeSlot('data-active-'+slot,text);published++;}catch{}
  if(!published)throw Error('恢复内置状态待核实，请重新读取后确认');
  if((await this.pointer()).value?.active!==null)throw Error('恢复内置回读失败，请重新读取');
  return {committed:true,version:'0.0.0',degraded:published<2};
 });}
}
