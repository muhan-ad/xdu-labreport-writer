import {archiveId,parseVariantLibraryFile,validVariantArchive,type VariantArchive} from './variant-library.ts';
import {assertVariantEdit,assertStandaloneVariant,type CustomVariant} from './variant-edits.ts';

export interface VariantTransferContext {
 experiments:readonly {id:string;sourceId?:string;name:string}[];
 templates:Record<string,Record<string,unknown>>;
}
const sections=new Set(['实验原理','实验方法','误差分析','结论','实验结论']);
const bytes=(s:string)=>new TextEncoder().encode(s).length;
export interface VariantTransferFile {name:string;text:string;}

export function variantArchiveCandidate(entry:VariantArchive,base:Record<string,unknown>):Omit<CustomVariant,'baseCount'>{
 if(!validVariantArchive(entry))throw Error('自建变体归档无效');
 const builtin=base[entry.section];
 if(!Array.isArray(builtin)||!builtin.length)throw Error('当前报告没有对应的文字变体章节');
 if(entry.unbound){
  assertStandaloneVariant(entry.text);
  return {id:entry.id,baseIndex:0,original:entry.original,text:entry.text,standalone:true};
 }
 if(builtin[entry.index]!==entry.original)throw Error('内置变体已变化，不能自动选用');
 return {id:entry.id,baseIndex:entry.index,original:entry.original,text:entry.text};
}

export async function parseVariantTransferFiles(files:readonly VariantTransferFile[],context:VariantTransferContext):Promise<VariantArchive[]> {
 if(!files.length||files.length>100)throw Error('每次请选择 1～100 个自建变体文件');
 if(files.reduce((sum,f)=>sum+bytes(f.text),0)>8*1024*1024)throw Error('所选自建库文件合计超过 8 MB');
 const entries:VariantArchive[]=[],seen=new Set<string>();let total=0;
 for(const file of files){
  const text=file.text.replace(/^\uFEFF/,''),raw=JSON.parse(text);let parsed:VariantArchive[];
  if(raw?.type==='lab-maker-variant-library')parsed=await parseVariantLibraryFile(text,context.experiments.map(e=>e.id));
  else {
   if(!file.name.endsWith('.json')||/[\\/]/.test(file.name))throw Error('电脑版文件名无效');
   const source=file.name.slice(0,-5).replace(/^自建变体_/,''),matches=context.experiments.filter(e=>(e.sourceId??e.name)===source);
   if(matches.length!==1)throw Error('文件名未匹配唯一实验：'+file.name);
   const exp=matches[0],base=context.templates[exp.id];
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).length||!base)throw Error('电脑版自建变体文件结构无效');
   parsed=[];
   for(const [section,values] of Object.entries(raw)){
    if(!sections.has(section)||!Array.isArray(values)||values.length>500)throw Error('电脑版章节或变体列表无效：'+section.slice(0,100));
    for(const value of values){
     if(typeof value!=='string'||!value.trim()||value.length>20000)throw Error('电脑版变体为空或超过 20000 字');
     // Legacy exports lack provenance. Match a current compatible baseline explicitly;
     // unmatched content remains an intact, view/export-only archive.
     const target=Array.isArray(base[section])?section:section==='实验结论'&&Array.isArray(base.结论)?'结论':section==='结论'&&Array.isArray(base.实验结论)?'实验结论':section;
     const candidates=base[target];let index=-1;
     if(Array.isArray(candidates))index=candidates.findIndex((original,i)=>{if(i>99||typeof original!=='string')return false;try{assertVariantEdit(original,value);return true;}catch{return false;}});
     const original=index<0?value:(candidates as string[])[index];
     const entry:VariantArchive={version:1,experimentId:exp.id,section:target,index:Math.max(0,index),original,text:value,desktop:true,...(index<0?{unbound:true as const}:{}),createdAt:new Date().toISOString(),id:''};
     entry.id=await archiveId(entry);
     if(!validVariantArchive(entry))throw Error('电脑版变体无法归档');
     parsed.push(entry);
     if(parsed.length>500)throw Error('每次最多导入 500 条变体');
    }
   }
  }
  total+=parsed.length;if(total>500)throw Error('每次最多导入 500 条变体');
  for(const entry of parsed)if(!seen.has(entry.id)){seen.add(entry.id);entries.push(entry);}
 }
 if(!entries.length)throw Error('文件中没有自建变体');
 return entries;
}

export function desktopVariantExport(entries:readonly VariantArchive[],context:VariantTransferContext){
 if(!entries.length||entries.length>500)throw Error('请选择 1～500 条自建变体');
 const id=entries[0].experimentId,exp=context.experiments.find(e=>e.id===id);
 if(!exp)throw Error('实验不存在');
 const source=exp.sourceId??exp.name;
 if(!source||/[\\/]/.test(source))throw Error('实验名称无效');
 const data:Record<string,string[]>={};
 for(const entry of entries){
  if(!validVariantArchive(entry)||entry.experimentId!==id||!sections.has(entry.section))throw Error('电脑版导出包含不匹配的实验或章节');
  const rows=data[entry.section]??=[];if(!rows.includes(entry.text))rows.push(entry.text);data[entry.section]=rows;
 }
 if(bytes(JSON.stringify(data))>8*1024*1024)throw Error('导出文件超过 8 MB');
 return {name:'自建变体_'+source,data};
}
