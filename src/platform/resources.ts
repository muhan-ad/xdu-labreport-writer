import {Capacitor,registerPlugin,type PluginListenerHandle} from '@capacitor/core';
import {ReportEngine,type RuntimeDiagnostic} from '../engine/client.ts';
import {exportJson} from './storage.ts';
import app from '../../package.json';
import {WebResourceChecker} from './web-resource-check.ts';
export interface ResourceProgress {id:string;checked:number;total:number;bytes:number;path:string;}
export interface ResourceResult extends Omit<ResourceProgress,'path'> {version:string;complete:boolean;cancelled:boolean;scope?:'shared';cacheCleared?:boolean;problems:{path:string;reason:string}[];}
export interface ResourcePort {
 platform:()=>string;check:(id:string,refresh:boolean)=>Promise<ResourceResult>;cancel:(id:string)=>Promise<void>;
 progress:(listener:(p:ResourceProgress)=>void)=>Promise<{remove:()=>Promise<void>}>;
 diagnose:(onProgress:(s:string)=>void)=>Promise<RuntimeDiagnostic>;stopDiagnostic:()=>void;export:(result:unknown)=>Promise<void>;
}
const native=registerPlugin<{check(v:{id:string}):Promise<ResourceResult>;refresh(v:{id:string}):Promise<ResourceResult>;cancel(v:{id:string}):Promise<void>;addListener(name:'progress',listener:(p:ResourceProgress)=>void):Promise<PluginListenerHandle>}>('LabResources');
const engine=new ReportEngine();
const shared=new WebResourceChecker(app.version);
export const resources:ResourcePort={platform:()=>Capacitor.getPlatform(),check:(id,refresh)=>Capacitor.getPlatform()==='ios'?(refresh?Promise.reject(Error('当前平台暂不支持刷新运行缓存')):shared.check(id)):refresh?native.refresh({id}):native.check({id}),cancel:id=>Capacitor.getPlatform()==='ios'?shared.cancel(id):native.cancel({id}),progress:listener=>Capacitor.getPlatform()==='ios'?shared.progress(listener):native.addListener('progress',listener),diagnose:progress=>engine.diagnose(progress),stopDiagnostic:()=>engine.cancel(),export:result=>exportJson('资源检查结果',result,'导出资源检查结果')};
