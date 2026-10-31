import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {Repository} from '../src/domain/repository.ts';import {defaultReportSettings} from '../src/domain/reports.ts';import {textHash} from '../src/domain/ai-library.ts';import {historyUseState} from '../src/domain/ai-history-management.ts';
const exp='abcdef123456',other='123456abcdef';
async function entry(id=exp,kind='polish',section='结论'){const source='current-source';return {id:crypto.randomUUID(),experimentId:id,kind,section,createdAt:new Date().toISOString(),source,sourceHash:await textHash(source),text:'AI 正文',original:'实验原文',questions:kind==='quiz'?['问题']:[]};}
const make=()=>{const data=new Map();let badWrite='',badRemove='';const store={read:async k=>data.get(k)??null,write:async(k,v)=>{if(badWrite&&k.startsWith(badWrite))throw Error('写入失败');data.set(k,v);},remove:async k=>{if(badRemove&&k.startsWith(badRemove))throw Error('清理失败');data.delete(k);}};return {repo:new Repository(store),data,failWrite:v=>badWrite=v,failRemove:v=>badRemove=v};};
test('history status separates unknown, changed data, linked import and merely matching data',async()=>{
 const row=await entry(),settings={...defaultReportSettings(),ai:{source:row.source,polish:{结论:row.text},historyRefs:{polish:{结论:row.id}}}},context={source:row.source,sourceHash:row.sourceHash,settings,warning:''};
 assert.equal(historyUseState(row,null),'数据待核实');assert.equal(historyUseState(row,{...context,warning:'恢复副本'}),'数据待核实');assert.equal(historyUseState(row,{...context,sourceHash:'a'.repeat(64)}),'数据已变化');assert.equal(historyUseState(row,context),'当前已导入');assert.equal(historyUseState(row,{...context,source:'new-source'}),'数据匹配');delete settings.ai.polish;assert.equal(historyUseState(row,context),'数据匹配');
});
test('managed deletion detaches selected current import while retaining other AI, measurements and reports',async()=>{
 const f=make(),a=await entry(),b=await entry(exp,'quiz','自定义思考题'),c=await entry(other);for(const row of [a,b,c])await f.repo.appendAIHistory(row);
 const settings={...defaultReportSettings(),customQuestions:['将来重新生成的题目'],variants:{实验原理:0},ai:{source:a.source,polish:{结论:a.text},customQuiz:{questions:['问题'],answers:{1:['回答']}},historyRefs:{polish:{结论:a.id},quiz:b.id},reviewWarnings:{结论:'待核对'}}};await f.repo.saveReportSettings(exp,settings);
 for(const key of [`record-${exp}-a`,`photo-${exp}-a`,`report-${exp}-a`])f.data.set(key,'preserved');
 const expected=(await f.repo.listAIHistory(exp)).filter(r=>r.id===a.id);assert.equal(await f.repo.removeManagedAIHistory(exp,expected),1);
 const next=await f.repo.loadReportSettings(exp);assert.equal(next.ai.polish.结论,undefined);assert.equal(next.ai.historyRefs.polish,undefined);assert.deepEqual(next.ai.customQuiz,settings.ai.customQuiz);assert.deepEqual(next.customQuestions,settings.customQuestions);assert.deepEqual(next.variants,settings.variants);assert.deepEqual((await f.repo.listAIHistory(exp)).map(r=>r.id),[b.id]);assert.equal((await f.repo.listAIHistory(other))[0].id,c.id);for(const key of [`record-${exp}-a`,`photo-${exp}-a`,`report-${exp}-a`])assert.equal(f.data.get(key),'preserved');
});
test('records added during confirmation are not deleted by the reviewed selection',async()=>{
 const f=make(),a=await entry(),b=await entry();await f.repo.appendAIHistory(a);const expected=await f.repo.listAIHistory(exp);await f.repo.appendAIHistory(b);await f.repo.removeManagedAIHistory(exp,expected);assert.equal((await f.repo.listAIHistory(exp))[0].id,b.id);assert.equal((await f.repo.readAIHistory(exp,b.id)).text,b.text);
});
test('changed selection, invalid identity and cross-experiment targets fail before file cleanup',async()=>{
 const f=make(),a=await entry();await f.repo.appendAIHistory(a);const expected=await f.repo.listAIHistory(exp),before=new Map(f.data);await assert.rejects(f.repo.removeManagedAIHistory(exp,[{...expected[0],sourceHash:'b'.repeat(64)}]),/变化/);await assert.rejects(f.repo.removeManagedAIHistory('../path',expected),/无效/);await assert.rejects(f.repo.removeManagedAIHistory(other,expected),/变化/);await assert.rejects(f.repo.removeManagedAIHistory(exp,[expected[0],expected[0]]),/无效/);assert.deepEqual(f.data,before);
});
test('configuration save failure keeps history index and both body copies',async()=>{
 const f=make(),a=await entry();await f.repo.appendAIHistory(a);await f.repo.saveReportSettings(exp,{...defaultReportSettings(),ai:{source:a.source,polish:{结论:a.text},historyRefs:{polish:{结论:a.id}}}});const expected=await f.repo.listAIHistory(exp);f.failWrite('options-');await assert.rejects(f.repo.removeManagedAIHistory(exp,expected),/写入/);assert.equal((await f.repo.listAIHistory(exp)).length,1);assert.equal((await f.repo.readAIHistory(exp,a.id)).text,a.text);f.failWrite('');await f.repo.removeManagedAIHistory(exp,expected);assert.equal((await f.repo.listAIHistory(exp)).length,0);
});
test('file cleanup failure leaves indexed records retryable and never removes newly applied unrelated sections',async()=>{
 const f=make(),a=await entry();await f.repo.appendAIHistory(a);const expected=await f.repo.listAIHistory(exp);f.failRemove(`history-item-${exp}-${a.id}-b`);await assert.rejects(f.repo.removeManagedAIHistory(exp,expected),/清理/);assert.equal((await f.repo.listAIHistory(exp)).length,1);f.failRemove('');await f.repo.saveReportSettings(exp,{...defaultReportSettings(),ai:{source:a.source,polish:{实验原理:'后来的导入'}}});await f.repo.removeManagedAIHistory(exp,expected);assert.equal((await f.repo.loadReportSettings(exp)).ai.polish.实验原理,'后来的导入');assert.equal((await f.repo.listAIHistory(exp)).length,0);
});
test('inspection surfaces recovered index and managed delete does not overwrite corrupt copies',async()=>{
 const f=make(),a=await entry();await f.repo.appendAIHistory(a);f.data.set(`history-${exp}-a`,'broken');const result=await f.repo.inspectAIHistory(exp);assert.equal(result.rows.length,1);assert.ok(result.warning);const before=new Map(f.data);await assert.rejects(f.repo.removeManagedAIHistory(exp,result.rows),/副本异常/);assert.deepEqual(f.data,before);f.data.set(`history-${exp}-b`,'broken');await assert.rejects(f.repo.inspectAIHistory(exp),/损坏/);
});
test('removing an unused record does not create report settings or modify independent adopted text',async()=>{
 const f=make(),a=await entry();await f.repo.appendAIHistory(a);await f.repo.removeManagedAIHistory(exp,await f.repo.listAIHistory(exp));assert.equal([...f.data.keys()].some(k=>k.startsWith('options-')),false);
 const b=await entry();await f.repo.appendAIHistory(b);const settings={...defaultReportSettings(),ai:{source:b.source,polish:{结论:'未关联记录的导入'}}};await f.repo.saveReportSettings(exp,settings);await f.repo.removeManagedAIHistory(exp,await f.repo.listAIHistory(exp));assert.deepEqual(await f.repo.loadReportSettings(exp),settings);
});
test('queued old history cannot reappear after managed delete and new requests still work',async()=>{
 const f=make(),a=await entry(),old=await entry();await f.repo.appendAIHistory(a);const expected=await f.repo.listAIHistory(exp),pending=f.repo.appendAIHistory(old),removal=f.repo.removeManagedAIHistory(exp,expected);await assert.rejects(pending,/失效/);await removal;assert.equal((await f.repo.listAIHistory(exp)).length,0);await f.repo.appendAIHistory(await entry());assert.equal((await f.repo.listAIHistory(exp)).length,1);
});
test('a newer settings save queued before deletion is reread and keeps its different history reference',async()=>{
 const f=make(),a=await entry(),b=await entry();await f.repo.appendAIHistory(a);await f.repo.appendAIHistory(b);const expected=(await f.repo.listAIHistory(exp)).filter(r=>r.id===a.id),settings={...defaultReportSettings(),ai:{source:b.source,polish:{结论:'新的正文'},historyRefs:{polish:{结论:b.id}}}};
 const save=f.repo.saveReportSettings(exp,settings),remove=f.repo.removeManagedAIHistory(exp,expected);await save;await remove;assert.deepEqual(await f.repo.loadReportSettings(exp),settings);assert.equal((await f.repo.readAIHistory(exp,b.id)).text,b.text);
});
test('history body must match its indexed source and section before it can be displayed',async()=>{
 for(const field of ['source','section']){const f=make(),a=await entry();await f.repo.appendAIHistory(a);for(const suffix of ['a','b']){const key=`history-item-${exp}-${a.id}-${suffix}`,saved=JSON.parse(f.data.get(key));saved.payload[field]='changed';saved.digest=crypto.createHash('sha256').update(JSON.stringify(saved.payload)).digest('hex');f.data.set(key,JSON.stringify(saved));}await assert.rejects(f.repo.readAIHistory(exp,a.id),/未能核实/);assert.equal((await f.repo.listAIHistory(exp)).length,1);}
});
