import {makeBrowserDataPackage} from './data-signature-browser.ts';
import {ReportEngine} from '../../src/engine/client.ts';
import {DataUpdateStore} from '../../src/domain/data-update-store.ts';
import {verifyDataPayload} from '../../src/domain/data-package.ts';
import {selectExperimentKnowledge} from '../../src/domain/ai-context.ts';
import measurements from './measurements.json';
export async function verifyRealUpdateWorker(){
 const marker='DATA_UPDATE_TEST.',knowledgeMarker='DATA_KNOWLEDGE_TEST.';
 const test=await makeBrowserDataPackage(p=>{const e=p.catalog.experiments[0];(p.variants[e.id].实验原理 as string[])[0]=marker+(p.variants[e.id].实验原理 as string[])[0];p.sources[e.sourceId+'/variants.json']=JSON.stringify(p.variants[e.id]);p.sources[e.sourceId+'/rag/原理.md']+='\n'+knowledgeMarker;});
 const files=new Map<string,string>(),store={read:async(k:string)=>files.get(k)??null,write:async(k:string,v:string)=>{files.set(k,v);},remove:async(k:string)=>{files.delete(k);}},manager=new DataUpdateStore(store,test.ctx);
 const preflight=new ReportEngine(async candidate=>candidate?verifyDataPayload(new TextEncoder().encode(candidate.body),candidate.manifest,test.ctx):null);
 const committed=await manager.install(test.envelope,()=>preflight.diagnose(()=>{},test.envelope),new AbortController().signal);if(!committed.committed)throw Error('未切换');
 const reloaded=new DataUpdateStore(store,test.ctx),snapshot=await reloaded.load();if(snapshot.version!=='1.0.1'||!snapshot.payload)throw Error('重开未恢复');const e=snapshot.payload.catalog.experiments[0];
 const knowledge=selectExperimentKnowledge(snapshot.payload.sources,[e.sourceId]).get(e.sourceId)!;if(!knowledge.text.includes(knowledgeMarker))throw Error('知识未更新');
 const engine=new ReportEngine(async()=> (await reloaded.load()).payload);
 const report=await engine.generate({experimentId:e.id,data:(measurements as Record<string,never>)[e.id],profile:{name:'更新流程测试',studentId:'TEST',className:'模拟数据'},date:'2026-10-25',options:{variants:{实验原理:0}}},()=>{});
 if(!JSON.stringify(report.metadata.sections).includes(marker)||report.docx.length<1000||report.metadata.formulaCount<1)throw Error('新模板未进入报告');
 const bad=structuredClone(test.payload);bad.dataVersion='1.0.2';const fakeFont=new Uint8Array(1000);fakeFont[1]=1;bad.fontBase64=btoa(String.fromCharCode(...fakeFont));const brokenEnvelope=await test.resign(bad);let rejected=false;try{await manager.install(brokenEnvelope,()=>preflight.diagnose(()=>{},brokenEnvelope),new AbortController().signal);}catch{rejected=true;}if(!rejected||(await manager.load()).version!=='1.0.1')throw Error('坏字体更新被启用');
 const missingGlyph=structuredClone(test.payload);missingGlyph.dataVersion='1.0.3';missingGlyph.sources[e.sourceId+'/rag/原理.md']+='\u9fff';const glyphEnvelope=await test.resign(missingGlyph);let glyphRejected=false;try{await manager.install(glyphEnvelope,()=>preflight.diagnose(()=>{},glyphEnvelope),new AbortController().signal);}catch{glyphRejected=true;}if(!glyphRejected||(await manager.load()).version!=='1.0.1')throw Error('缺字字体更新被启用');
 await manager.restoreBuiltin();if((await manager.load()).payload!==null)throw Error('未恢复内置');
 return {checks:['real signed local package passes ReportEngine worker preflight before pointer commit','verified resource persists and reload binds both UI template and knowledge to the same package','fresh production worker produces actual DOCX from updated template','real worker rejects a signed but unusable font and keeps active data unchanged','preflight detects valid font missing newly required Chinese glyphs','explicit builtin restore changes only resource pointer'],formulaCount:report.metadata.formulaCount,bytes:report.docx.length};
}
