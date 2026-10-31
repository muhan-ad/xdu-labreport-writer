import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseVariantTransferFiles,desktopVariantExport} from '../src/domain/variant-transfer.ts';
import {parseVariantLibraryFile,archiveId} from '../src/domain/variant-library.ts';
import {Repository} from '../src/domain/repository.ts';
import {appendCustomVariant,variantChoices} from '../src/domain/variant-edits.ts';
import {defaultReportSettings} from '../src/domain/reports.ts';
const experiments=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments;
const templates=JSON.parse(fs.readFileSync(new URL('../src/data/report-variants.json',import.meta.url)));
const context={experiments,templates},exp=experiments[0],base=templates[exp.id];
const file=(data,name='自建变体_'+exp.sourceId+'.json')=>({name,text:JSON.stringify(data)});
const pack=entries=>JSON.stringify({type:'lab-maker-variant-library',version:1,entries});
const memory=()=>{const store=new Map();return new Repository({read:async k=>store.get(k)??null,write:async(k,v)=>{store.set(k,v);},remove:async k=>{store.delete(k);}});};

test('all 28 desktop export shapes map by exact source name and preserve original formula-bearing text',async()=>{
 for(const e of experiments){
  const data=Object.fromEntries(Object.entries(templates[e.id]).filter(([section,v])=>['实验原理','实验方法','误差分析','结论','实验结论'].includes(section)&&Array.isArray(v)).map(([section,v])=>[section,['电脑版自建\n'+v[0]]]));
  const entries=await parseVariantTransferFiles([file(data,'自建变体_'+e.sourceId+'.json')],context);
  assert.equal(entries.length,Object.keys(data).length,e.name);
  for(const entry of entries){assert.equal(entry.experimentId,e.id);assert.equal(entry.text,data[entry.section][0]);assert.equal(entry.desktop,true);assert.equal(entry.unbound,undefined);assert.equal(entry.original,templates[e.id][entry.section][entry.index]);assert.equal(await archiveId(entry),entry.id);}
 }
});

test('unknown provenance text remains an intact source archive across repository and mobile transfers',async()=>{
 const text='自建独立内容 $new=2$ %%DATA:unknown%%';
 const [entry]=await parseVariantTransferFiles([file({实验原理:[text]})],context);
 assert.equal(entry.unbound,true);assert.equal(entry.original,text);
 const repo=memory(),id=await repo.archiveVariant(entry),saved=await repo.readVariantArchive(exp.id,id);
 assert.deepEqual(saved,entry);
 const imported=await parseVariantLibraryFile(pack([saved]),experiments.map(e=>e.id));
 assert.deepEqual(imported,[saved]);
 const legacy=desktopVariantExport(imported,context);
 assert.equal(legacy.name,'自建变体_'+exp.sourceId);
 assert.deepEqual(legacy.data,{实验原理:[text]});
 const [again]=await parseVariantTransferFiles([file(legacy.data,legacy.name+'.json')],context);
 assert.equal(again.id,id);
});

test('compatible desktop entries append as independent candidates and leave current builtin unchanged',async()=>{
 const [entry]=await parseVariantTransferFiles([file({实验原理:['新正文\n'+base.实验原理[0]]})],context);
 const settings=appendCustomVariant(defaultReportSettings(),base,entry.section,{id:entry.id,baseIndex:entry.index,original:entry.original,text:entry.text});
 assert.equal(variantChoices(base,settings.customVariants).实验原理.at(-1),entry.text);
 assert.equal(settings.variants.实验原理,base.实验原理.length);
 assert.notEqual(base.实验原理.at(-1),entry.text);
});

test('multi-file preflight isolates ownership, merges duplicate content, ignores no malformed trailing file',async()=>{
 const f=file({实验原理:['导入\n'+base.实验原理[0]]}),other=experiments[1];
 const otherFile=file({实验原理:['另一实验\n'+templates[other.id].实验原理[0]]},other.sourceId+'.json');
 const entries=await parseVariantTransferFiles([f,f,otherFile],context);
 assert.equal(entries.length,2);assert.deepEqual(new Set(entries.map(e=>e.experimentId)),new Set([exp.id,other.id]));
 for(const bad of [file({实验原理:['有效',12]}),file({未知章节:['文本']}),file({实验原理:['']}),file({实验原理:['x'.repeat(20001)]}),{name:'unknown.json',text:f.text},{name:'../'+f.name,text:f.text},{name:f.name,text:'{' }])
  await assert.rejects(parseVariantTransferFiles([f,bad],context));
 await assert.rejects(parseVariantTransferFiles(Array(101).fill(f),context),/100/);
 await assert.rejects(parseVariantTransferFiles([file({实验原理:Array(501).fill('内容')})],context));
 await assert.rejects(parseVariantTransferFiles([{name:f.name,text:'x'.repeat(8*1024*1024+1)}],context),/8 MB/);
});

test('desktop conclusion alias is explicit, BOM supported and renamed experiment never falls back to current selection',async()=>{
 const entries=await parseVariantTransferFiles([{...file({实验结论:['变体\n'+base.结论[0]]}),text:'\uFEFF'+JSON.stringify({实验结论:['变体\n'+base.结论[0]]})}],context);
 assert.equal(entries[0].section,'结论');assert.equal(entries[0].unbound,undefined);
 await assert.rejects(parseVariantTransferFiles([file({实验原理:['文本']},exp.sourceId+'(1).json')],context),/唯一实验/);
 const ambiguous={experiments:[exp,{...exp,id:'abcdef123456'}],templates};
 await assert.rejects(parseVariantTransferFiles([file({实验原理:['文本']})],ambiguous),/唯一实验/);
});

test('desktop metadata participates in integrity and legacy mobile archives retain their old ids',async()=>{
 const [entry]=await parseVariantTransferFiles([file({实验原理:['独立 $a=9$']})],context);
 await assert.rejects(parseVariantLibraryFile(pack([{...entry,unbound:undefined}]),[exp.id]));
 await assert.rejects(parseVariantLibraryFile(pack([{...entry,desktop:false}]),[exp.id]));
 const old={...entry};delete old.desktop;delete old.unbound;old.id=await archiveId(old);
 assert.deepEqual(await parseVariantLibraryFile(pack([old]),[exp.id]),[old]);
 const mixed=[entry,{...entry,experimentId:experiments[1].id}];
 assert.throws(()=>desktopVariantExport(mixed,context),/不匹配/);
 const exported=desktopVariantExport([entry,entry],context);
 assert.equal(exported.data.实验原理.length,1);
});
