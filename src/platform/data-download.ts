import {Capacitor,registerPlugin} from '@capacitor/core';
import {DataDownload} from '../domain/data-download.ts';import type {DataManifest} from '../domain/data-package.ts';import {dataUpdateStore} from './data-state.ts';
import {MobileDataRequests,type DataNative} from './data-request.ts';
const requests=new MobileDataRequests(registerPlugin<DataNative>('LabDataUpdates'),()=>Capacitor.getPlatform());
const transfer=new DataDownload({manifest:(signal,progress)=>requests.manifest(signal,progress),bundle:(m,signal,progress)=>requests.bundle(m,signal,progress),inspectManifest:async raw=>(await dataUpdateStore()).inspectManifest(raw),inspect:async envelope=>(await dataUpdateStore()).inspect(envelope)});
export const onlineDataUpdates={onlineAvailable:()=>Capacitor.getPlatform()==='android',checkOnline:(signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>transfer.check(signal,progress),download:(manifest:DataManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>transfer.download(manifest,signal,progress)};
