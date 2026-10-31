import type {AIMessage,AISlot} from './ai.ts';
import {validAIStreamEvent,type AIStreamEvent,type AIStreamObserver} from '../domain/ai-stream.ts';
export interface AICompletionBridge {
 complete(v:{slot:AISlot;id:string;messages:AIMessage[];test:boolean;stream?:boolean}):Promise<{text:string;elapsedMs:number}>;
 cancel(v:{id:string}):Promise<unknown>;
 resume(v:{id:string}):Promise<unknown>;
 addListener(event:'stream',listener:(event:AIStreamEvent)=>void):Promise<{remove:()=>Promise<void>}>;
}
export class AICompletionRequests {
 private bridge:AICompletionBridge;
 constructor(bridge:AICompletionBridge){this.bridge=bridge;}
 async complete(slot:AISlot,messages:AIMessage[],signal:AbortSignal,test=false,observer?:AIStreamObserver){
  if(signal.aborted)throw Error('请求已取消');const id=crypto.randomUUID(),stream=slot==='chat'&&!test;let left=false,listener:{remove:()=>Promise<void>}|undefined,lastSeq=0,stallPending=false,rejectStop:((e:Error)=>void)|undefined;
  const stopped=new Promise<never>((_,reject)=>rejectStop=reject);
  const cancel=()=>{void this.bridge.cancel({id}).catch(()=>{});rejectStop?.(Error('请求已取消'));};signal.addEventListener('abort',cancel,{once:true});
  try{
   if(stream){
    const registering=this.bridge.addListener('stream',event=>{
     if(left||signal.aborted||!validAIStreamEvent(event)||event.id!==id||event.seq<=lastSeq)return;lastSeq=event.seq;
     try{observer?.onEvent?.(event);}catch{} // A presentation failure must not break the native request.
     if(event.kind!=='stall'||stallPending)return;stallPending=true;
     void Promise.resolve().then(()=>observer?.onStall?.()??true).then(async keep=>{
      if(left||signal.aborted)return;if(!keep){cancel();return;}
      try{await this.bridge.resume({id});}catch{cancel();}
     },()=>{if(!left&&!signal.aborted)cancel();}).finally(()=>{stallPending=false;});
    });
    void registering.then(handle=>{if(left)void handle.remove().catch(()=>{});},()=>{});
    listener=await Promise.race([registering,stopped]);if(signal.aborted)throw Error('请求已取消');
   }
   const result=await Promise.race([this.bridge.complete({slot,id,messages,test,...(stream?{stream:true}:{})}),stopped]);if(signal.aborted)throw Error('请求已取消');return result;
  }finally{left=true;signal.removeEventListener('abort',cancel);void listener?.remove().catch(()=>{});}
 }
}
