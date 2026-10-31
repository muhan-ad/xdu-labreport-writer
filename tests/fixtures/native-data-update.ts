// Ephemeral publisher and isolated acceptance UID only; never changes release trust.
import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';
import {privateStore} from '../../src/platform/storage.ts';
import {DataUpdateStore,type DataEnvelope} from '../../src/domain/data-update-store.ts';
import {verifyDataPayload,type DataContext} from '../../src/domain/data-package.ts';
import {ReportEngine} from '../../src/engine/client.ts';
import {selectExperimentKnowledge} from '../../src/domain/ai-context.ts';
import {makeBrowserDataPackage} from './data-signature-browser.ts';
import measurements from './measurements.json';
import {verifyAppManifest,appSigningText,type AppManifest} from '../../src/domain/app-update.ts';
const cache='acceptance-data-context.json';
let ctx:DataContext,envelopes:DataEnvelope[],manager:DataUpdateStore;
const state={held:false,hold:'',preflight:0,progress:''};
function reset(){manager=new DataUpdateStore(privateStore,ctx);}
export async function prepare(){
 const test=await makeBrowserDataPackage(p=>{const e=p.catalog.experiments[0];(p.variants[e.id].实验原理 as string[])[0]='NATIVE_DATA_TEMPLATE_V1.'+(p.variants[e.id].实验原理 as string[])[0];p.sources[e.sourceId+'/variants.json']=JSON.stringify(p.variants[e.id]);p.sources[e.sourceId+'/rag/原理.md']+='\nNATIVE_DATA_KNOWLEDGE_V1.';},true);
 ctx=test.ctx;const second=structuredClone(test.payload);second.dataVersion='1.0.2';const e=second.catalog.experiments[0];(second.variants[e.id].实验原理 as string[])[0]='NATIVE_DATA_TEMPLATE_V2.'+(second.variants[e.id].实验原理 as string[])[0];second.sources[e.sourceId+'/variants.json']=JSON.stringify(second.variants[e.id]);second.sources[e.sourceId+'/rag/原理.md']+='\nNATIVE_DATA_KNOWLEDGE_V2.';
 envelopes=[test.envelope,await test.resign(second)];
 await Filesystem.writeFile({path:cache,directory:Directory.Cache,encoding:Encoding.UTF8,data:JSON.stringify({ctx,envelopes})});reset();let nativeEd25519=true;try{const raw=Uint8Array.from(atob(ctx.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'')),c=>c.charCodeAt(0));await crypto.subtle.importKey('spki',raw,{name:'Ed25519'},false,['verify']);}catch(error){if((error as {name:string}).name!=='NotSupportedError')throw error;nativeEd25519=false;}return {versions:envelopes.map(v=>v.manifest.dataVersion),hashes:envelopes.map(v=>v.manifest.sha256),bytes:envelopes[0].manifest.size,nativeEd25519};
}
export async function reopen(){const r=await Filesystem.readFile({path:cache,directory:Directory.Cache,encoding:Encoding.UTF8});({ctx,envelopes}=JSON.parse(r.data as string));reset();return status();}
export async function status(){const snapshot=await manager.load(),s=await manager.status();return {version:snapshot.version,warning:snapshot.warning,highestVersion:s.highestVersion,sha:snapshot.envelope?.manifest.sha256??null};}
export function holdAfter(key:string){state.held=false;state.hold=key;const original=privateStore.write;privateStore.write=async(k,v)=>{await original(k,v);if(k===key){state.held=true;await new Promise(()=>{});}};}
export function observation(){return {...state};}
export async function signatureChecks(){
 let rejected=false;try{await verifyDataPayload(new TextEncoder().encode(envelopes[0].body),{...envelopes[0].manifest,notes:'tampered'},ctx);}catch(error){rejected=String(error).includes('签名验证失败');}if(!rejected)throw Error('Tampered data signature was not rejected');
 const ed=await import('@noble/ed25519'),seed=crypto.getRandomValues(new Uint8Array(32)),raw=await ed.getPublicKeyAsync(seed),der=new Uint8Array([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00,...raw]),pem=btoa(String.fromCharCode(...der));
 const m:AppManifest={kind:'lab-maker-mobile-app',schema:1,appId:'com.labmaker.app',version:'1.0.1',versionCode:100,minAndroid:24,size:100,sha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),url:'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-app/lab-maker-app-1.0.1.apk',notes:'Synthetic native signature verification only',signature:''};
 m.signature=btoa(String.fromCharCode(...await ed.signAsync(new TextEncoder().encode(appSigningText(m)),seed)));await verifyAppManifest(m,pem);let tamper=false;try{await verifyAppManifest({...m,notes:'tampered'},pem);}catch(error){tamper=String(error).includes('签名验证失败');}if(!tamper)throw Error('Tampered application manifest was not rejected');return {tamperedDataRejected:true,signedAppAccepted:true,tamperedAppRejected:true};
}
export async function install(index:number){const envelope=envelopes[index],probe=new ReportEngine(async candidate=>candidate?verifyDataPayload(new TextEncoder().encode(candidate.body),candidate.manifest,ctx):null);return manager.install(envelope,async()=>{const result=await probe.diagnose(s=>state.progress=s,envelope);state.preflight++;return result;},new AbortController().signal);}
export async function downgradeRejected(){try{await manager.inspect(envelopes[0]);return false;}catch(error){return String(error).includes('较旧');}}
export async function corrupt(index:number,slot:'a'|'b'){await privateStore.write('data-bundle-'+envelopes[index].manifest.sha256+'-'+slot,'corrupted local test bundle');reset();return status();}
export async function restore(){await manager.restoreBuiltin();return status();}
export async function generate(){
 const snapshot=await manager.load();if(!snapshot.payload)throw Error('Expected verified downloaded resource');const exp=snapshot.payload.catalog.experiments[0],marker=snapshot.version==='1.0.2'?'V2':'V1';
 const knowledge=selectExperimentKnowledge(snapshot.payload.sources,[exp.sourceId]).get(exp.sourceId);if(!knowledge?.text.includes('NATIVE_DATA_KNOWLEDGE_'+marker))throw Error('Knowledge and resource pointer mismatch');
 const engine=new ReportEngine(async()=>snapshot.payload),report=await engine.generate({experimentId:exp.id,data:(measurements as Record<string,never>)[exp.id],profile:{name:'本地资源中断验收',studentId:'TEST',className:'模拟'},date:'2026-10-28',options:{variants:{实验原理:0}}},s=>state.progress=s);
 if(!JSON.stringify(report.metadata.sections).includes('NATIVE_DATA_TEMPLATE_'+marker))throw Error('Updated template absent from actual DOCX metadata');
 let binary='';for(let i=0;i<report.docx.length;i+=8192)binary+=String.fromCharCode(...report.docx.subarray(i,i+8192));await Filesystem.writeFile({path:'acceptance-data-'+marker+'.docx',directory:Directory.Cache,data:btoa(binary)});
 return {version:snapshot.version,formulas:report.metadata.formulaCount,bytes:report.docx.length,marker};
}
