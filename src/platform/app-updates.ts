import {Capacitor,registerPlugin} from '@capacitor/core';import publicKey from '../data/update-public-key.pem?raw';
import {verifyAppManifest,appUpdateState,type AppManifest,type InstalledApp} from '../domain/app-update.ts';
import {AppUpdateRequests,type AppNative} from './app-update-request.ts';

const bridge=registerPlugin<AppNative>('LabAppUpdates'),requests=new AppUpdateRequests(bridge);
const prepared=new Map<string,string>();
export const appUpdates={
 available:()=>Capacitor.getPlatform()==='android',info:()=>bridge.info(),clear:async()=>{await bridge.clear();prepared.clear();},settings:()=>bridge.settings(),
 async check(signal:AbortSignal,progress:(bytes:number,total:number)=>void){
  const reply=await requests.request('manifest',null,signal,progress) as {found:boolean;body?:string};if(!reply.found)return {state:'unpublished' as const};
  if(typeof reply.body!=='string'||new TextEncoder().encode(reply.body).byteLength>65536)throw Error('应用更新清单过大或为空');
  const manifest=await verifyAppManifest(JSON.parse(reply.body),publicKey);return {state:appUpdateState(manifest,await bridge.info()),manifest};
 },
 async download(manifest:AppManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void){
  const verified=await verifyAppManifest(manifest,publicKey);if(appUpdateState(verified,await bridge.info())!=='available')throw Error('当前不能下载此应用更新');
  const result=await requests.request('download',verified,signal,progress) as {candidateId?:string};if(!result.candidateId||!/^[a-f0-9-]{36}$/.test(result.candidateId))throw Error('安装包核对结果无效');prepared.clear();prepared.set(result.candidateId,verified.sha256);return result.candidateId;
 },
 async install(manifest:AppManifest,candidateId:string){const verified=await verifyAppManifest(manifest,publicKey);if(prepared.get(candidateId)!==verified.sha256||appUpdateState(verified,await bridge.info())!=='available')throw Error('安装前版本或文件核对失败');return bridge.install({candidateId,sha256:verified.sha256,version:verified.version,versionCode:verified.versionCode});},
};
