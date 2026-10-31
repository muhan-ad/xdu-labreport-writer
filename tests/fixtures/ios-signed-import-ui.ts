import {DataUpdatesView} from '../../src/features/data-updates.ts';
import {DataUpdateStore} from '../../src/domain/data-update-store.ts';
import {verifyDataPayload} from '../../src/domain/data-package.ts';
import {privateStore} from '../../src/platform/storage.ts';
import {ReportEngine} from '../../src/engine/client.ts';
import {makeBrowserDataPackage} from './data-signature-browser.ts';

export async function createImportFixture(){
 const test=await makeBrowserDataPackage(undefined,true),store=new DataUpdateStore(privateStore,test.ctx);
 const broken=structuredClone(test.payload);broken.dataVersion='1.0.2';broken.sources['common/broken-test.py']='def broken(';const brokenEnvelope=await test.resign(broken);
 const engine=new ReportEngine(async candidate=>candidate?verifyDataPayload(new TextEncoder().encode(candidate.body),candidate.manifest,test.ctx):null);
 let sessionVersion='0.0.0',preflights=0,reloads=0;
 const port={onlineAvailable:()=>false,status:async()=>({...await store.status(),sessionVersion}),inspect:(envelope:any)=>store.inspect(envelope),
  install:async(envelope:any,signal:AbortSignal,progress:(text:string)=>void,commit:()=>void)=>{const cancel=()=>engine.cancel();signal.addEventListener('abort',cancel,{once:true});try{return await store.install(envelope,async()=>{preflights++;return engine.diagnose(progress,envelope)},signal,commit)}finally{signal.removeEventListener('abort',cancel)}},
  restore:()=>store.restoreBuiltin(),reload:()=>{reloads++;},confirm:async()=>true};
 const view=new DataUpdatesView(port),host=document.querySelector<HTMLElement>('#updates-host')!;view.mount(host);
 const pick=(kind:'good'|'tampered'|'broken'='good')=>{const transfer=new DataTransfer(),envelope=kind==='broken'?brokenEnvelope:test.envelope,manifest=kind==='tampered'?{...envelope.manifest,notes:'tampered'}:envelope.manifest;transfer.items.add(new File([JSON.stringify(manifest)],'manifest.json',{type:'application/json'}));transfer.items.add(new File([envelope.body],'data.json',{type:'application/json'}));const input=host.querySelector<HTMLInputElement>('[data-update-files]')!;input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
 return {pick,status:()=>store.status(),preflights:()=>preflights,reloads:()=>reloads,leave:()=>view.leave(),session:async()=>{sessionVersion=(await store.load()).version;view.mount(host);}};
}
