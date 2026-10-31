import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseVariantTransferFiles,variantArchiveCandidate} from '../src/domain/variant-transfer.ts';
import {appendCustomVariant,variantChoices,validCustomVariants,assertStandaloneVariant,updateVariantEdit,removeCustomVariants} from '../src/domain/variant-edits.ts';
import {defaultReportSettings,validReportSettings} from '../src/domain/reports.ts';
import {Repository} from '../src/domain/repository.ts';
const experiments=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments,templates=JSON.parse(fs.readFileSync(new URL('../src/data/report-variants.json',import.meta.url))),exp=experiments[0],base=templates[exp.id];
const entry=async(text='独立自建 $z=1$')=>(await parseVariantTransferFiles([{name:'自建变体_'+exp.sourceId+'.json',text:JSON.stringify({实验原理:[text]})}],{experiments,templates}))[0];

test('standalone desktop formula needs no forged builtin provenance and appends only after explicit use',async()=>{
 const archive=await entry();assert.equal(archive.unbound,true);
 const value=variantArchiveCandidate(archive,base);assert.equal(value.standalone,true);assert.equal(value.original,archive.text);
 const original=structuredClone(base),settings=appendCustomVariant(defaultReportSettings(),base,'实验原理',value);
 assert.deepEqual(base,original);assert.equal(validReportSettings(settings),true);
 assert.equal(variantChoices(base,settings.customVariants).实验原理.at(-1),archive.text);
 const repeated=appendCustomVariant(settings,base,'实验原理',value);assert.equal(repeated.customVariants.实验原理.length,1);
 const sameCount={...base,实验原理:base.实验原理.map(s=>'更新内置 '+s)};
 assert.equal(variantChoices(sameCount,settings.customVariants).实验原理.at(-1),archive.text);
 assert.throws(()=>variantChoices({...base,实验原理:[...base.实验原理,'新增']},settings.customVariants),/内置变体/);
});

test('standalone data substitution supports bounded formats but malformed or unbounded formats cannot be adopted',async()=>{
 for(const format of ['%.5g','%.2f','%g','%s','%03d','%+10.6e'])assert.doesNotThrow(()=>assertStandaloneVariant('结果 %%DATA:value:'+format+'%%'));
 for(const text of ['%%DATA:value%%','%%DATA:value:%*f%%','%%DATA:value:%999f%%','%%DATA:value:%.99f%%','%%DATA:../key:%g%%','%%DATA:value:%f']){
  assert.throws(()=>assertStandaloneVariant(text),/占位符/);
  const invalid=await entry(text);assert.throws(()=>variantArchiveCandidate(invalid,base),/占位符/);
 }
 const missing={...await entry(),section:'不存在'};assert.throws(()=>variantArchiveCandidate(missing,base),/章节/);
});

test('standalone further adjustments retain own formula and placeholder constraints, restore and removal preserve unrelated data',async()=>{
 const archive=await entry('独立 $z=1$，结果 %%DATA:value:%.5g%%'),value=variantArchiveCandidate(archive,base),initial=appendCustomVariant(defaultReportSettings(),base,'实验原理',value),index=initial.variants.实验原理;
 const edited=updateVariantEdit(initial,'实验原理',index,value.text,'调整 '+value.text);
 assert.equal(edited.variantEdits.实验原理[index].text,'调整 '+value.text);
 assert.throws(()=>updateVariantEdit(initial,'实验原理',index,value.text,'改公式 $z=2$ %%DATA:value:%.5g%%'),/公式/);
 assert.throws(()=>updateVariantEdit(initial,'实验原理',index,value.text,'独立 $z=1$ %%DATA:other:%.5g%%'),/占位符/);
 const restored=updateVariantEdit(edited,'实验原理',index,value.text,undefined);assert.equal(restored.variantEdits,undefined);
 const removed=removeCustomVariants(restored,base);assert.equal(removed.customVariants,undefined);assert.equal(initial.customVariants.实验原理[0].text,archive.text);
});

test('standalone flags and original archive persist independently while incompatible baselines still reject',async()=>{
 const archive=await entry(),settings=appendCustomVariant(defaultReportSettings(),base,'实验原理',variantArchiveCandidate(archive,base)),row=settings.customVariants.实验原理[0];
 for(const patch of [{standalone:false},{standalone:'true'},{baseIndex:1},{text:'改为 $z=2$'},{original:'%%DATA:broken%%',text:'%%DATA:broken%%'}])assert.equal(validCustomVariants({实验原理:[{...row,...patch}]}),false);
 const data=new Map(),repo=new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{data.set(k,v);},remove:async k=>{data.delete(k);}});
 await repo.archiveVariant(archive);await repo.saveReportSettings(exp.id,settings);
 assert.equal((await repo.loadReportSettings(exp.id)).customVariants.实验原理[0].standalone,true);
 assert.equal((await repo.readVariantArchive(exp.id,archive.id)).unbound,true);
 const adjustedText='已调整 '+archive.text,id=await repo.archiveVariant({...archive,original:adjustedText,text:adjustedText});assert.notEqual(id,archive.id);
 assert.equal(variantArchiveCandidate(await repo.readVariantArchive(exp.id,id),base).standalone,true);
});
