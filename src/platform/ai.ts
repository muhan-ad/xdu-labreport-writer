import { Capacitor, registerPlugin } from "@capacitor/core";
import {AICompletionRequests,type AICompletionBridge} from './ai-completion.ts';
import type {AIStreamObserver} from '../domain/ai-stream.ts';
import {AIStreamPreview} from '../features/ai-stream-preview.ts';
export type AISlot = "chat" | "vision";
export interface AIStatus {
  hasKey: boolean;
  inheritsChat?:boolean;inheritModel?:string;baseModel?:string;
  endpoint?: string;
  model?: string;
}
export interface AIMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | { type: string; text?: string; image_url?: { url: string } }[];
}
export interface AIModels {models:string[];partial:boolean;}
interface NativeAI extends AICompletionBridge {
  models(o:{id:string;slot:AISlot;endpoint:string;key:string}):Promise<AIModels>;
  status(o: { slot: AISlot;inheritChat?:boolean }): Promise<AIStatus>;
  configure(o: {
    slot: AISlot;
    endpoint: string;
    model: string;
    key: string;
    inheritChat?:boolean;
  }): Promise<AIStatus>;
  clear(o: { slot: AISlot }): Promise<AIStatus>;
  complete(o: {
    slot: AISlot;
    id: string;
    messages: AIMessage[];
    test?: boolean;
    stream?: boolean;
    draft?:{endpoint:string;model:string;key:string;inheritChat?:boolean};
  }): Promise<{ text: string; elapsedMs: number }>;
  cancel(o: { id: string }): Promise<void>;
}
const native = registerPlugin<NativeAI>("LabAI");
const completions = new AICompletionRequests(native);
// Browser previews deliberately do not persist secrets in localStorage or JSON.
function supported() {
  if (Capacitor.getPlatform() !== "android")
    throw Error(
      "当前仅 Android 已接入安全密钥存储，请在 Android 应用中配置；iOS 接口正在移植",
    );
}
export const ai = {
  async status(slot: AISlot,inheritChat?:boolean) {
    supported();
    return native.status({ slot,...(inheritChat===undefined?{}:{inheritChat}) });
  },
  async configure(slot: AISlot, endpoint: string, model: string, key: string,inheritChat=false) {
    supported();
    return native.configure({ slot, endpoint, model, key,inheritChat });
  },
  async clear(slot: AISlot) {
    supported();
    return native.clear({ slot });
  },
  async test(input:{slot:AISlot;endpoint:string;model:string;key:string;inheritChat?:boolean},signal:AbortSignal){supported();if(signal.aborted)throw Error('请求已取消');const id=crypto.randomUUID(),cancel=()=>{void native.cancel({id}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});try{const result=await native.complete({id,slot:input.slot,messages:[{role:'user',content:'Reply with OK only.'}],test:true,draft:{endpoint:input.endpoint,model:input.model,key:input.key,...(input.inheritChat?{inheritChat:true}:{})}});if(signal.aborted)throw Error('请求已取消');return result;}finally{signal.removeEventListener('abort',cancel);}},
  async models(input:{slot:AISlot;endpoint:string;key:string},signal:AbortSignal){supported();if(signal.aborted)throw Error('已停止获取模型');const id=crypto.randomUUID(),cancel=()=>{void native.cancel({id}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});try{const result=await native.models({...input,id});if(signal.aborted)throw Error('已停止获取模型');return result;}finally{signal.removeEventListener('abort',cancel);}},
  async complete(
    slot: AISlot,
    messages: AIMessage[],
    signal: AbortSignal,
    test = false,
    observer?: AIStreamObserver,
  ) {
    supported();
    if(slot!=='chat'||test||observer)return completions.complete(slot,messages,signal,test,observer);
    if(signal.aborted)throw Error('请求已取消');
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    const preview=new AIStreamPreview(controller.signal,()=>controller.abort());
    try{return await completions.complete(slot,messages,controller.signal,false,preview.observer);}
    finally{preview.close();signal.removeEventListener('abort',abort);}
  },
};
