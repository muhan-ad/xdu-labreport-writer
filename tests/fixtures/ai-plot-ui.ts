import {AIPlotView} from '../../src/features/ai-plot.ts';
import {runIsolatedPlot} from '../../src/engine/ai-plot-client.ts';
import {Repository} from '../../src/domain/repository.ts';
import {defaultReportSettings} from '../../src/domain/reports.ts';
import type {AdoptedAIPlot,AIPlotImage} from '../../src/domain/ai-plot.ts';
export {runIsolatedPlot};
export function createPlotFixture(code:string,data:Record<string,unknown>,initialBad=false){
  const id='abcdef123456',store=new Map<string,string>(),files=new Map<string,Uint8Array>();
  const repo=new Repository({read:async key=>store.get(key)??null,write:async(key,value)=>{store.set(key,value)},remove:async key=>{store.delete(key)}});
  let selection:AdoptedAIPlot|undefined,view:AIPlotView,source=JSON.stringify(data),asks=0,repairs=0,saves=0,stages=0,answer=true,failSave=false,failStageAt=0,pending=false,late:((s:string)=>void)|undefined;
  const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const hooks={
    context:()=>({experimentId:id,source,data,sections:['数据处理','结论','实验原理']}),selection:()=>selection,
    ask:async(_requirement:string,_signal:AbortSignal)=>{asks++;if(pending)return new Promise<string>(resolve=>{late=resolve;});return '```python\n'+(initialBad?'bad_code()':code)+'\n```';},
    repair:async()=>{repairs++;return code;},
    run:runIsolatedPlot,
    stage:async(_id:string,bytes:Uint8Array)=>{stages++;if(stages===failStageAt)throw Error('模拟第二张保存失败');const image={id:crypto.randomUUID(),sha256:await hash(bytes),bytes:bytes.length};files.set(image.id,bytes.slice());return image;},
    read:async(_id:string,image:AIPlotImage)=>{const bytes=files.get(image.id);if(!bytes)throw Error('测试图片缺失');return bytes.slice();},
    save:async(_id:string,value:AdoptedAIPlot|undefined)=>{if(failSave)throw Error('模拟保存失败');saves++;const next=defaultReportSettings();if(value)next.aiPlot=value;await repo.saveReportSettings(id,next);await repo.saveReportSettings(id,next);selection=value;},
    confirm:async()=>answer,changed:()=>{},
  };
  const mount=()=>{view?.leave();view=new AIPlotView(hooks);view.mount(document.querySelector('#plot-ui-host')!);};mount();
  return {
    dispose:()=>view.leave(),
    state:()=>({asks,repairs,saves,stages,selection,busy:view.isBusy,status:document.querySelector('.ai-plot-state')?.textContent,files:files.size}),
    reopen:async()=>{selection=(await repo.loadReportSettings(id)).aiPlot;mount();},
    changeSource:()=>{source+=' changed';},
    setConfirm:(value:boolean)=>{answer=value;},failSave:(value:boolean)=>{failSave=value;},
    failStage:(value:number)=>{failStageAt=value;},
    pendingAsk:()=>{pending=true;},resolveLate:()=>{late?.('```python\n'+code+'\n```');pending=false;},
  };
}
