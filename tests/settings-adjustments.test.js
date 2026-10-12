'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createHistory} = require('../src/main/polish-history');
const {testApi} = require('../src/main/api-test');
const {fetchModels} = require('../src/main/api-models');
function history(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'polish-history-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,store:createHistory(root)};
}
const input=(expId, polished='正文')=>({expId,expName:'实验'+expId,section:'结论',original:'原文',polished,sourceData:{measurements:[1,2]}});
test('history persists every version and independent experiment across restarts without secrets', t=>{
  const {root,store}=history(t);
  store.run('append',{...input('A'),key:'NEVER_STORE',apiKey:'NEVER_STORE'});
  store.run('append',input('A','第二版'));store.run('append',input('B'));
  const state=createHistory(root).run('list');
  assert.equal(state.records.length,3);assert.equal(state.applied.length,0);
  assert.equal(state.records[2].expId,'B');assert.equal(state.records[0].original,'原文');
  assert.ok(state.records[0].createdAt);assert.deepEqual(state.records[0].sourceData,{measurements:[1,2]});
  assert.doesNotMatch(fs.readFileSync(path.join(root,'polish-history.json'),'utf8'),/NEVER_STORE/);
  assert.throws(()=>store.run('append',{...input('A'),sourceData:null}),/来源/);
});
test('delete only detaches applied version and group deletion preserves other experiments',t=>{
  const {store}=history(t);
  const old=store.run('append',input('A')).record, active=store.run('append',input('A','新')).record;
  const other=store.run('append',input('B')).record;
  store.run('apply',{id:old.id});store.run('apply',{id:active.id});store.run('apply',{id:other.id});
  assert.deepEqual(store.run('delete',{id:old.id}).detached,[]);
  const result=store.run('delete',{expId:'A'});
  assert.equal(result.detached[0].id,active.id);assert.equal(result.detached[0].polished,'新');
  assert.equal(store.run('list').records[0].id,other.id);
  assert.equal(store.run('delete',{all:true}).removed.length,1);
  assert.equal(store.run('list').records.length,0);
});
test('legacy migration is idempotent, does not invent time/source, and cannot resurrect deleted history',t=>{
  const {store}=history(t);
  const payload={overrides:{A:{结论:'旧正文'},B:{__sourceData:{x:3},结论:'带来源旧正文'}}};
  store.run('migrate',payload);store.run('migrate',payload);
  const state=store.run('list');assert.equal(state.records.length,2);
  assert.equal(state.records[0].createdAt,null);assert.equal(state.records[0].sourceData,null);
  assert.deepEqual(state.records[1].sourceData,{x:3});
  store.run('delete',{all:true});store.run('migrate',payload);
  assert.equal(store.run('list').records.length,0);
});
test('quiz variant history association does not create a report override',t=>{
  const {store}=history(t);const r=store.run('append',input('A')).record;
  store.run('apply',{id:r.id,variant:true});
  assert.equal(store.run('list').records[0].imported,true);
  assert.equal(store.run('list').applied.length,0);
  assert.deepEqual(store.run('delete',{id:r.id}).detached,[]);
  const applied=store.run('append',input('A','当前覆盖')).record;
  store.run('apply',{id:applied.id});
  const variant=store.run('append',input('A','自建变体')).record;
  store.run('apply',{id:variant.id,variant:true});
  assert.equal(store.run('list').applied[0].id,applied.id);
});
function api(json) {
  return {endpoint:p=>p.apiUrl||'https://service.example/v1',defaultModel:()=> 'default-model',getKey:base=>{assert.equal(base,'https://service.example/v1');return 'stored-key';},network:{json}};
}
test('model connection test calls current draft model/key with a bounded text request',async()=>{
  const result=await testApi({model:'draft-model',key:'new-key'},api(async(url,opts)=>{
    assert.equal(url,'https://service.example/v1/chat/completions');
    assert.equal(opts.headers.Authorization,'Bearer new-key');assert.equal(opts.timeoutMs,30000);assert.equal(opts.idleTimeoutMs,0);
    const body=JSON.parse(opts.body);assert.equal(body.model,'draft-model');assert.equal(body.max_tokens,128);assert.equal(body.stream,false);
    return {choices:[{message:{content:'OK'}}]};
  }));assert.equal(result.ok,true);
});
for (const [message,kind] of [['HTTP 401','auth'],['HTTP 404','model'],['HTTP 429','rate'],['ECONNRESET secret','interrupted'],['网络连接超时','timeout'],['连接地址不是公网地址','config']]) {
  test('API test categorizes '+kind+' without exposing raw errors',async()=>{
    const result=await testApi({},api(async()=>{throw Error(message);}));
    assert.equal(result.kind,kind);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/secret/);
  });
}
test('timeout abort cause and empty HTTP success do not claim model success',async()=>{
  const error=Error('aborted',{cause:Object.assign(Error('deadline'),{name:'TimeoutError'})});
  assert.equal((await testApi({},api(async()=>{throw error;}))).kind,'timeout');
  for(const content of [null,'', '  ']) assert.equal((await testApi({},api(async()=>({choices:[{message:{content}}]})))).kind,'empty');
});
test('model discovery uses endpoint-bound saved key, normalizes model IDs and never saves settings',async()=>{
  const result=await fetchModels({},api(async(url,opts)=>{
    assert.equal(url,'https://service.example/v1/models');assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,'Bearer stored-key');
    assert.equal(opts.timeoutMs,30000);assert.equal(opts.maxBytes,1024*1024);
    return {data:[{id:'z'},{id:'a'},{id:'z'},{id:null},{id:''}]};
  }));assert.deepEqual(result.models,['a','z']);
});
test('model discovery respects newly typed key and provides manual fallback on unsupported/empty lists',async()=>{
  assert.equal((await fetchModels({key:'draft'},api(async(_url,opts)=>{assert.equal(opts.headers.Authorization,'Bearer draft');return {data:[{id:'m'}]};}))).ok,true);
  for(const data of [{}, {data:[]}, {data:[{id:null}]}]) assert.equal((await fetchModels({},api(async()=>data))).ok,false);
  for(const code of [401,404,429]) {
    const r=await fetchModels({},api(async()=>{throw Error('HTTP '+code+' private');}));
    assert.equal(r.ok,false);assert.doesNotMatch(r.error,/private/);
  }
});
test('missing or mismatched key blocks both model discovery and model calls',async()=>{
  const deps=api(()=>assert.fail('must not send'));
  deps.getKey=()=>{throw Error('密钥地址不匹配');};
  assert.equal((await testApi({},deps)).kind,'config');assert.equal((await fetchModels({},deps)).ok,false);
});
test('body stream reset caused by the deadline is reported as timeout, not network interruption',async()=>{
  const deps=api(async()=>{throw Error('ECONNRESET');});
  deps.makeDeadline=()=>AbortSignal.abort();
  assert.equal((await testApi({},deps)).kind,'timeout');
  assert.match((await fetchModels({},deps)).error,/超时/);
});
