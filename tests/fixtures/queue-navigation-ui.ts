import {ReportQueueView} from '../../src/features/report-queue.ts';import {ReportPreparationError} from '../../src/domain/generation-quiz.ts';import {assertReportRuntime} from '../../src/domain/report-runtime.ts';import type {Experiment} from '../../src/domain/types.ts';
import {runIsolatedPlot} from '../../src/engine/ai-plot-client.ts';
export function createQueueNavigationFixture(){
 let release:(()=>void)|undefined,review=false,hold=true,changes=0;const calls:string[]=[];
 const view=new ReportQueueView([{id:'a',name:'第一实验'},{id:'b',name:'第二实验'}] as Experiment[],async(id,signal)=>{calls.push(id);if(id==='a'){if(review){if(!await view.requestConfirmation('答案 <img src=x> 待处理','未通过数值校验\n留空后继续？',signal))throw new ReportPreparationError('停止回答');}else if(hold)await new Promise<void>(r=>release=r);}},async()=>true,()=>changes++);
 const mount=()=>{document.querySelector('#queue-root')!.innerHTML='<div id="queue-host"></div>';view.mount(document.querySelector('#queue-host')!)};mount();
 return {plotBlocked:async()=>{try{await runIsolatedPlot({code:'print(DATA)',data:{}},new AbortController().signal,()=>{});return '';}catch(error){return (error as Error).message;}},state:()=>({calls,busy:view.isSaving,paused:view.queue.paused,attention:view.needsConfirmation,items:view.queue.items,changes}),release:()=>release?.(),review:(v:boolean)=>review=v,hold:(v:boolean)=>hold=v,detach:()=>{view.leave();document.querySelector('#queue-root')!.innerHTML='<p id="other-page">正在浏览另一页</p>';},mount,runtimeBlocked:()=>{try{assertReportRuntime();return false;}catch{return true;}}};
}
