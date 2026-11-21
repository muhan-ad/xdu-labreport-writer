'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reportNameMatches,uploadMatchingReport}=require('../src/main/report-upload');
function fixture({pages,initial=1,dialog=null,submitResult={ok:true},attachResult={ok:true},stateFailure=null}={}){
 pages=pages||[[{key:'one',name:'冲击法测量直螺线管磁场实验',canUpload:true}]];
 let current=initial,currentDialog=dialog;const calls=[],progress=[];
 const deps={experiment:'直螺线管磁场分布的测量',
  async state(){return stateFailure||{ok:true,phase:'ready',page:current,pages:pages.length,rows:pages[current-1],dialog:currentDialog};},
  async page(d){calls.push(['page',d]);current+=d;return {ok:true};},
  async openRow(k){calls.push(['row',k]);currentDialog={type:'upload',id:'dialog-1'};return {ok:true};},
  async attach(){calls.push(['attach']);return attachResult;},
  async submit(id){calls.push(['submit',id]);return submitResult;},
  progress:m=>progress.push(m),sleep:async()=>{},
 };
 return {deps,calls,progress};
}
test('explicit aliases include semesters, normalize parentheses and never fuzzy-match',()=>{
 assert.ok(reportNameMatches('薄透镜焦距的测量（凹透镜）','薄透镜焦距测量实验'));
 assert.ok(reportNameMatches('声速的测量（水中）','声速的测量(水中)'));
 assert.equal(reportNameMatches('声速的测量（水中）','声速的测量（空气）'),false);
 assert.equal(reportNameMatches('直螺线管磁场分布的测量','螺线管'),false);
 assert.equal(reportNameMatches('',''),false);
});
test('one click resolves the exact experiment, attaches first and submits exactly once',async()=>{
 const f=fixture();const r=await uploadMatchingReport(f.deps);assert.equal(r.submitted,true);
 assert.deepEqual(f.calls,[['row','one'],['attach'],['submit','dialog-1']]);
});
test('scan every page starting from a later page then return to uniquely matched row',async()=>{
 const f=fixture({initial:2,pages:[[{key:'first',name:'直螺线管磁场分布的测量'}],[{key:'other',name:'霍尔效应实验'}]]});
 assert.equal((await uploadMatchingReport(f.deps)).ok,true);
 assert.deepEqual(f.calls.filter(c=>c[0]==='page').map(c=>c[1]),[-1,1,-1]);
 assert.deepEqual(f.calls.filter(c=>c[0]==='row'),[['row','first']]);
});
test('duplicate rows including across pages never choose an arbitrary experiment',async()=>{
 const f=fixture({pages:[[{key:'a',name:'直螺线管磁场分布的测量'}],[{key:'b',name:'冲击法测量直螺线管磁场实验'}]]});
 await assert.rejects(uploadMatchingReport(f.deps),/多条/);assert.ok(!f.calls.some(c=>c[0]==='row'));
});
test('no match, grading and official restrictions stop before attachment',async()=>{
 for(const row of [{key:'x',name:'霍尔效应实验'},{key:'x',name:'直螺线管磁场分布的测量',graded:true},{key:'x',name:'直螺线管磁场分布的测量',canUpload:false}]){
  const f=fixture({pages:[[row]]});await assert.rejects(uploadMatchingReport(f.deps));assert.equal(f.calls.length,0);
 }
});
test('existing school dialog and manual login are left for user action',async()=>{
 for(const config of [{dialog:{type:'message',id:'old'}},{stateFailure:{phase:'needs_credentials',message:'请配置账号'}},{stateFailure:{phase:'manual_login',message:'请登录'}}]){
  const f=fixture(config);await assert.rejects(uploadMatchingReport(f.deps));assert.equal(f.calls.length,0);
 }
});
test('extra official confirmation is not automatically accepted',async()=>{
 const f=fixture();f.deps.openRow=async()=>({ok:true});
 await assert.rejects(uploadMatchingReport(f.deps),/额外确认/);assert.ok(!f.calls.some(c=>c[0]==='submit'));
});
test('file failure and changed dialog never cause submission',async()=>{
 const f=fixture({attachResult:{ok:false,error:'文件不存在'}});await assert.rejects(uploadMatchingReport(f.deps),/文件不存在/);assert.ok(!f.calls.some(c=>c[0]==='submit'));
 const g=fixture();const state=g.deps.state;let reads=0;
 g.deps.state=async()=>{const s=await state();if(++reads===3)s.dialog={type:'upload',id:'different'};return s;};
 await assert.rejects(uploadMatchingReport(g.deps),/已变化/);assert.ok(!g.calls.some(c=>c[0]==='submit'));
});
test('ambiguous submit result is returned without retry',async()=>{
 const f=fixture({submitResult:{ok:false,error:'结果不明确'}});
 await assert.rejects(uploadMatchingReport(f.deps),/结果不明确/);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
});
test('closed or changed account stops between asynchronous steps',async()=>{
 const f=fixture();let closed=false;f.deps.attach=async()=>{closed=true;return {ok:true};};
 f.deps.check=()=>{if(closed)throw Error('会话已变化');};
 await assert.rejects(uploadMatchingReport(f.deps),/会话已变化/);assert.ok(!f.calls.some(c=>c[0]==='submit'));
});
test('loading has a finite deadline and never submits',async()=>{
 const f=fixture({stateFailure:{phase:'loading'}});let clock=0;f.deps.now=()=>clock+=10000;
 await assert.rejects(uploadMatchingReport(f.deps),/超时/);assert.equal(f.calls.length,0);
});

test('prepared confirmation is returned without claiming submission',async()=>{
 const f=fixture({submitResult:{ok:true,confirmationRequired:true,message:'请确认'}});
 const r=await uploadMatchingReport(f.deps);assert.equal(r.confirmationRequired,true);assert.notEqual(r.submitted,true);assert.equal(r.message,'请确认');
});
