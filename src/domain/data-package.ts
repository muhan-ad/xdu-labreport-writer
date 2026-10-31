import type {Experiment} from './types.ts';
import {parseCredits} from './credits.ts';
import {verifyPublisherSignature} from './publisher-signature.ts';
export const MAX_DATA_BYTES=8*1024*1024;
export const DATA_HOST='labreport-1485394950.cos.ap-guangzhou.myqcloud.com';
const KIND='lab-maker-mobile-data';
export interface DataManifest {kind:typeof KIND;schema:1;dataVersion:string;minAppVersion:string;adapterVersion:1;runtimeHash:string;layoutHash:string;url:string;size:number;sha256:string;notes:string;signature:string;}
export interface DataPayload {kind:typeof KIND;schema:1;dataVersion:string;adapterVersion:1;runtimeHash:string;layoutHash:string;catalog:{version:1;sourceVersion:string;experiments:Experiment[]};variants:Record<string,Record<string,unknown>>;sources:Record<string,string>;fontBase64:string;}
export interface DataContext {appVersion:string;currentVersion:string;runtimeHash:string;experiments:readonly Experiment[];publicKey:string;}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const encoder=new TextEncoder();
export function stableJson(value:unknown,depth=0):string {
 if(depth>50)throw Error('更新数据层级过深');
 if(Array.isArray(value))return '['+value.map(v=>stableJson(v,depth+1)).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k],depth+1)).join(',')+'}';
 if(value===null||typeof value==='boolean'||typeof value==='string'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
 throw Error('更新数据类型无效');
}
export async function dataHash(value:BufferSource){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function compareDataVersion(a:string,b:string){
 const parse=(s:string)=>{if(!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(s))throw Error('版本必须为 x.y.z');return s.split('.').map(Number);};
 const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;
}
export async function dataLayoutHash(experiments:readonly Experiment[]){return dataHash(encoder.encode(stableJson(experiments)));}
export async function dataRuntimeHash(manifest:{runtimeVersion:string;files:Record<string,{bytes:number;sha256:string}>}){
 const mutable=new Set(['report-sources.json','catalog.json','LabMakerSansSC.ttf','runner.py','chart_preview.py','insert_chart.py','ai_plot.py','variant_edits.py']);
 return dataHash(encoder.encode(stableJson({runtimeVersion:manifest.runtimeVersion,files:Object.fromEntries(Object.entries(manifest.files).filter(([name])=>!mutable.has(name)))})));
}
export function manifestSigningText(manifest:Omit<DataManifest,'signature'>|DataManifest){const {kind,schema,dataVersion,minAppVersion,adapterVersion,runtimeHash,layoutHash,url,size,sha256,notes}=manifest;return stableJson({kind,schema,dataVersion,minAppVersion,adapterVersion,runtimeHash,layoutHash,url,size,sha256,notes});}
const base64=(text:string,max:number)=>{
 if(typeof text!=='string'||text.length>Math.ceil(max/3)*4||!text.length||text.length%4!==0||/[^A-Za-z0-9+/=]/.test(text))throw Error('更新包编码无效');
 const padding=text.indexOf('=');if(padding>=0&&(padding<text.length-2||!/^={1,2}$/.test(text.slice(padding))))throw Error('更新包编码无效');
 const raw=atob(text);if(btoa(raw)!==text)throw Error('更新包编码无效');if(raw.length>max)throw Error('更新包编码过大');return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
function onlyKeys(raw:Record<string,unknown>,keys:string[]){if(Object.keys(raw).length!==keys.length||Object.keys(raw).some(k=>!keys.includes(k)))throw Error('更新包字段不符合手机版协议');}
export async function verifyDataManifest(raw:unknown,context:DataContext):Promise<DataManifest>{
 if(!object(raw))throw Error('更新清单无效');
 onlyKeys(raw,['kind','schema','dataVersion','minAppVersion','adapterVersion','runtimeHash','layoutHash','url','size','sha256','notes','signature']);
 const m=raw as unknown as DataManifest;
 if(m.kind!==KIND||m.schema!==1||m.adapterVersion!==1)throw Error('此更新包不适用于手机版，请更新应用');
 if(typeof m.notes!=='string'||m.notes.length>8000||typeof m.signature!=='string'||!Number.isSafeInteger(m.size)||m.size<1||m.size>MAX_DATA_BYTES||![m.sha256,m.runtimeHash,m.layoutHash].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)))throw Error('更新清单大小、说明或校验值无效');
 let url:URL;try{url=new URL(m.url);}catch{throw Error('更新包地址无效');}
 if(url.href!==m.url||url.protocol!=='https:'||url.hostname!==DATA_HOST||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/mobile-data/data-'+m.dataVersion+'.json')throw Error('更新包来源不正确');
 if(compareDataVersion(m.dataVersion,context.currentVersion)<=0)throw Error('更新版本必须高于当前版本');
 if(compareDataVersion(context.appVersion,m.minAppVersion)<0)throw Error('请先更新应用，再更新实验数据');
 if(m.runtimeHash!==context.runtimeHash||m.layoutHash!==await dataLayoutHash(context.experiments))throw Error('运行环境或录入字段不兼容，请先更新应用');
 const signature=base64(m.signature,64);if(signature.length!==64)throw Error('更新签名格式无效');
 const pem=context.publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'');
 let verified:boolean;try{verified=await verifyPublisherSignature(base64(pem,256),signature,encoder.encode(manifestSigningText(m)));}catch{throw Error('当前环境无法验证发布签名，请更新系统 WebView 或应用');}
 if(!verified)throw Error('更新包发布签名验证失败');
 return structuredClone(m);
}
export async function verifyDataPayload(bytes:Uint8Array,manifest:DataManifest,context:DataContext):Promise<DataPayload>{
 // Re-verify the signed manifest here so callers cannot supply an unchecked object.
 const m=await verifyDataManifest(manifest,context);
 if(bytes.byteLength!==m.size||bytes.byteLength>MAX_DATA_BYTES||await dataHash(bytes as Uint8Array<ArrayBuffer>)!==m.sha256)throw Error('更新包大小或摘要不匹配');
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('更新包不是有效 UTF-8 JSON');}
 if(!object(parsed)||parsed.dataVersion!==m.dataVersion||parsed.runtimeHash!==m.runtimeHash||parsed.layoutHash!==m.layoutHash)throw Error('更新包与签名清单不一致');
 return validateDataContents(parsed,context);
}
export async function validateDataContents(parsed:unknown,context:Pick<DataContext,'runtimeHash'|'experiments'>):Promise<DataPayload>{
 if(!object(parsed))throw Error('更新包内容无效');
 onlyKeys(parsed,['kind','schema','dataVersion','adapterVersion','runtimeHash','layoutHash','catalog','variants','sources','fontBase64']);
 const p=parsed as unknown as DataPayload;compareDataVersion(p.dataVersion,p.dataVersion);
 if(p.kind!==KIND||p.schema!==1||p.adapterVersion!==1||typeof p.dataVersion!=='string'||p.runtimeHash!==context.runtimeHash||p.layoutHash!==await dataLayoutHash(context.experiments)||!object(p.catalog)||p.catalog.version!==1||typeof p.catalog.sourceVersion!=='string'||p.catalog.sourceVersion.length>200||!Array.isArray(p.catalog.experiments)||stableJson(p.catalog.experiments)!==stableJson(context.experiments))throw Error('更新包实验目录或兼容信息不匹配');
 if(!object(p.sources)||!object(p.variants)||Object.keys(p.sources).length>4096)throw Error('更新包脚本或模板目录无效');
 const roots=new Set(['common',...context.experiments.map(e=>e.sourceId)]),seen=new Set<string>();
 for(const [name,text] of Object.entries(p.sources)){
  if(name.length>240||/[\\:\x00-\x1f]/.test(name)||name.split('/').some(s=>!s||s.startsWith('.')||/[. ]$/.test(s))||!roots.has(name.split('/')[0])||!/^.+\.(py|json|md|txt)$/.test(name)||seen.has(name.toLowerCase())||typeof text!=='string'||text.length>1000000)throw Error('更新包资源路径或内容无效：'+name.slice(0,100));
  seen.add(name.toLowerCase());if(name.endsWith('.json'))try{JSON.parse(text);}catch{throw Error('更新包 JSON 资源无效：'+name);}
 }
 if(Object.keys(p.variants).length!==context.experiments.length||Object.keys(p.variants).some(id=>!context.experiments.some(e=>e.id===id)))throw Error('更新包实验模板归属不一致');
 for(const e of context.experiments){
  for(const name of ['generate.py','schema.json','variants.json','rag/原理.md'])if(typeof p.sources[e.sourceId+'/'+name]!=='string'||!p.sources[e.sourceId+'/'+name].trim())throw Error('更新包缺少实验资源：'+e.sourceId+'/'+name);
  const schema=JSON.parse(p.sources[e.sourceId+'/schema.json']);
  if(!object(schema)||stableJson(schema.groups)!==stableJson(e.schema.groups))throw Error('更新包字段与录入页面不一致：'+e.name);
  const sourceVariants=JSON.parse(p.sources[e.sourceId+'/variants.json']);
  if(!object(p.variants[e.id])||stableJson(sourceVariants)!==stableJson(p.variants[e.id]))throw Error('更新包模板与报告脚本资源不一致：'+e.name);
  for(const [section,texts] of Object.entries(p.variants[e.id])){
   if(!section||section.length>100||['__proto__','prototype','constructor'].includes(section)||!(Array.isArray(texts)||object(texts)))throw Error('更新包模板章节无效');
   const validTexts=(rows:unknown)=>Array.isArray(rows)&&rows.length>0&&rows.length<=100&&rows.every(t=>typeof t==='string'&&!!t.trim()&&t.length<=20000);
   if(Array.isArray(texts)?!validTexts(texts):!Object.keys(texts).length||Object.keys(texts).length>100||Object.entries(texts).some(([key,rows])=>!key||key.length>100||['__proto__','prototype','constructor'].includes(key)||!validTexts(rows)))throw Error('更新包章节正文无效');
  }
 }
 for(const name of ['common/__init__.py','common/data_io.py','common/docx_report.py','common/docx_omml.py','common/variants.py'])if(!p.sources[name]?.trim())throw Error('更新包缺少公共报告组件：'+name);
 if(p.sources['common/credits.json']!==undefined)parseCredits(p.sources['common/credits.json']);
 const font=base64(p.fontBase64,2*1024*1024);if(font.length<1000||!(font[0]===0&&font[1]===1&&font[2]===0&&font[3]===0))throw Error('更新包字体无效');
 return p;
}
