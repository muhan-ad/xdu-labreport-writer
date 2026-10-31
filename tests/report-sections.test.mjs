import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Repository} from '../src/domain/repository.ts';import {defaultReportSettings} from '../src/domain/reports.ts';import {reportSectionNames,knownDisabledSections,mergeSectionSwitches} from '../src/domain/report-sections.ts';
const templates=JSON.parse(fs.readFileSync(new URL('../src/data/report-variants.json',import.meta.url))),catalog=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments,id=catalog[0].id,other=catalog[1].id,names=reportSectionNames(templates[id]);
const make=()=>{const data=new Map();let failAt=0,calls=0;const repo=new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{if(++calls===failAt)throw Error('模拟失败');data.set(k,v);},remove:async k=>{data.delete(k)}});return {repo,data,failNext:(n=1)=>failAt=calls+n};};
test('all 28 experiments use exact keys of their active chapter templates',()=>{assert.equal(catalog.length,28);for(const exp of catalog){const keys=reportSectionNames(templates[exp.id]);assert.deepEqual(keys,Object.keys(templates[exp.id]));assert.ok(keys.length>0&&keys.length<=32);assert.deepEqual(knownDisabledSections(keys,[keys[0],keys[0],'unknown']),[keys[0]]);}});
test('merge changes known switches only and preserves unknown sections and unrelated settings',()=>{
 const settings={...defaultReportSettings(),disabledSections:['以前的章节',names[0]],variants:{[names[0]]:-1},customQuestions:['保留问题'],embedPhoto:false,ai:{source:'source',polish:{结论:'保留正文'}}},before=structuredClone(settings),next=mergeSectionSwitches(settings,names,[names[1]],[names[0]]);
 assert.deepEqual(next.disabledSections,['以前的章节',names[1]]);assert.deepEqual({...next,disabledSections:settings.disabledSections},settings);assert.deepEqual(settings,before);
});
test('unknown, duplicate, oversized or malformed chapter selections are rejected',()=>{
 for(const value of [null,[],{'':[]},{['x'.repeat(101)]:[]},Object.fromEntries(Array.from({length:33},(_,i)=>['x'+i,[]]))])assert.throws(()=>reportSectionNames(value));
 for(const disabled of [['unknown'],[names[0],names[0]],['bad\nname']])assert.throws(()=>mergeSectionSwitches(defaultReportSettings(),names,disabled,[]));
 assert.throws(()=>mergeSectionSwitches(defaultReportSettings(),names,[],['unknown']));assert.deepEqual(reportSectionNames({}),[]);
});
test('two concurrent saves cannot overwrite newer switch choices using the same old baseline',async()=>{
 const {repo}=make(),first=repo.saveSectionSwitches(id,names,[names[0]],[]),second=repo.saveSectionSwitches(id,names,[names[1]],[]);await first;await assert.rejects(second,/已变化/);assert.deepEqual((await repo.loadReportSettings(id)).disabledSections,[names[0]]);
});
test('queued newer unrelated options are read at save time and preserved',async()=>{
 const {repo}=make(),settings={...defaultReportSettings(),variants:{[names[0]]:1},customQuestions:['新的问题'],embedPhoto:false,ai:{source:'s',polish:{结论:'新的润色'}}};const otherSave=repo.saveReportSettings(id,settings),switches=repo.saveSectionSwitches(id,names,[names[0]],[]);await otherSave;await switches;assert.deepEqual(await repo.loadReportSettings(id),{...settings,disabledSections:[names[0]]});
});
test('switches persist after repository restart and are isolated from other experiments and files',async()=>{
 const f=make();for(const key of ['record-'+id+'-a','photo-'+id+'-a','report-'+id+'-a'])f.data.set(key,'preserved');await f.repo.saveSectionSwitches(id,names,[names[0]],[]);await f.repo.saveReportSettings(other,{...defaultReportSettings(),embedPhoto:false});const restarted=new Repository({read:async k=>f.data.get(k)??null,write:async(k,v)=>f.data.set(k,v),remove:async k=>f.data.delete(k)});assert.deepEqual((await restarted.loadReportSettings(id)).disabledSections,[names[0]]);assert.equal((await restarted.loadReportSettings(other)).embedPhoto,false);for(const key of ['record-'+id+'-a','photo-'+id+'-a','report-'+id+'-a'])assert.equal(f.data.get(key),'preserved');
});
test('failed first write leaves settings unchanged and retry can succeed',async()=>{
 const f=make();await f.repo.saveReportSettings(id,defaultReportSettings());f.failNext();await assert.rejects(f.repo.saveSectionSwitches(id,names,[names[0]],[]),/未能确认/);assert.deepEqual((await f.repo.loadReportSettings(id)).disabledSections,[]);await f.repo.saveSectionSwitches(id,names,[names[0]],[]);assert.deepEqual((await f.repo.loadReportSettings(id)).disabledSections,[names[0]]);
});
test('ambiguous second-copy failure requires rereading rather than overwriting',async()=>{
 const f=make();await f.repo.saveReportSettings(id,defaultReportSettings());f.failNext(2);await assert.rejects(f.repo.saveSectionSwitches(id,names,[names[0]],[]),/未能确认/);assert.deepEqual((await f.repo.loadReportSettings(id)).disabledSections,[names[0]]);await assert.rejects(f.repo.saveSectionSwitches(id,names,[],[]),/已变化/);await f.repo.saveSectionSwitches(id,names,[],[names[0]]);assert.deepEqual((await f.repo.loadReportSettings(id)).disabledSections,[]);
});
test('corrupt settings copy is surfaced and never replaced with default settings by switch save',async()=>{
 const f=make();await f.repo.saveSectionSwitches(id,names,[names[0]],[]);f.data.set(`options-${id}-a`,'broken');const before=new Map(f.data);assert.ok((await f.repo.inspectReportSettings(id)).warning);await assert.rejects(f.repo.saveSectionSwitches(id,names,[],[names[0]]),/副本异常/);assert.deepEqual(f.data,before);
});
test('all enabled retains disabled entries outside the current template and invalid identity writes nothing',async()=>{
 const f=make();await f.repo.saveReportSettings(id,{...defaultReportSettings(),disabledSections:['旧版章节',names[0]]});await f.repo.saveSectionSwitches(id,names,[],[names[0]]);assert.deepEqual((await f.repo.loadReportSettings(id)).disabledSections,['旧版章节']);const before=new Map(f.data);await assert.rejects(f.repo.saveSectionSwitches('../path',names,[],[]),/标识/);await assert.rejects(f.repo.saveSectionSwitches(id,names,['unknown'],[]),/匹配/);assert.deepEqual(f.data,before);
});
