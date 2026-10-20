const test = require('node:test');
const assert = require('node:assert/strict');
const integrity = require('../src/shared/report-integrity');
const validation = require('../src/shared/data-validation');
const schema = require('../物理实验/实验脚本/电容与高电阻的测量/schema.json');
const context = {r_0:150.25,r_mohm:94.0195875,delta_e:37.424,c_x_bar:.0985972};

test('formula constants and uncertain quantities are advisory, not hard failures',()=>{
 for(const text of [String.raw`$s^{-10}$`,String.raw`$K=-1/(RC)$`,'误差4.8%','最长16秒','参考值1500 m/s','结果150']) assert.doesNotThrow(()=>integrity.validateText(text,context),text);
 assert.equal(integrity.inspectText('仪器分辨力0.01 mV',context).warnings[0].code,'UNVERIFIED_QUANTITY');
 assert.equal(integrity.inspectText(String.raw`$Q(0)/Q_0=1$，$s^{-1}$，这是初始条件。`,context).warnings.length,0);
});
test('saved polish requires provenance and unchanged measurements without key-order dependence',()=>{
 const data={r_0:100,q:[3,2,1],nested:{b:2,a:1}};
 const legacy={结论:'旧结果'};
 assert.deepEqual(integrity.selectOverrides(legacy,data),{status:'missing-source',polish:{}});
 assert.deepEqual(legacy,{结论:'旧结果'});
 const fresh={__sourceData:{nested:{a:1,b:2},q:[3,2,1],r_0:100},结论:'当前结果'};
 assert.equal(integrity.selectOverrides(fresh,data).polish,fresh);
 for(const changed of [{...data,r_0:10},{...data,q:[1,2,3]},{...data,nested:{a:2,b:2}}]) {
  assert.equal(integrity.selectOverrides(fresh,changed).status,'stale');
  assert.deepEqual(integrity.selectOverrides(fresh,changed).polish,{});
 }
 assert.equal(integrity.selectOverrides({__sourceData:data},data).status,'none');
});
test('every experiment gets current-data policy',()=>{assert.ok(integrity.applies({name:'电容与高电阻的测量'}));assert.ok(integrity.applies({name:'低电阻的测量'}));assert.ok(!integrity.applies(null));});
test('proven contradictions and invalid references are hard failures; rounding and units pass',()=>{
 for(const text of ['R=10.48 MΩ','R_0=10','标称值为100','%%DATA:no:%.2f%%','%%DATA:r_0:%q%%','%%DATA:r_0:','%%DATA:bad%%']) assert.throws(()=>integrity.validateText(text,context),text);
 for(const text of ['R=94.02 MΩ','R=94020 kΩ','测得电容为0.099 μF','结果%%DATA:r_mohm:%.2f%% MΩ']) assert.doesNotThrow(()=>integrity.validateText(text,context),text);
 for(const value of [null,NaN,Infinity,{},[],true]) assert.throws(()=>integrity.validateText('%%DATA:x:%.2f%%',{_kind:'generic',x:value}));
});
test('rebind exact quantities without changing symbolic constants',()=>{
 const s=integrity.parameterizeText('标称150.25 MΩ，测得94.02 MΩ；$R=1/(|K|C_N)$',context);
 assert.match(s,/%%DATA:r_0:/);assert.match(s,/%%DATA:r_mohm:/);assert.match(s,/R=1\/\(\|K\|C_N\)/);
 assert.doesNotThrow(()=>integrity.validateText(s,context));
});
test('blank r_0 and nonpositive values rejected in form validation',()=>{
 const d={c_n:1,r_0:100,q_n:Array(8).fill(2),q_x:Array(8).fill(1),t_values:Array.from({length:16},(_,i)=>i),q_values:Array(16).fill(1)};
 for(const value of [null,0,-1,Infinity]) assert.ok(validation.validate(schema,{...d,r_0:value}).length);
 assert.equal(validation.validate(schema,{...d,r_0:150.25}).length,0);
});

test('generic experiments reject unbound example quantities and bind current results',()=>{
 const ctx={_kind:'generic',focal_length:15.125,lambda_nm:650};
 for(const text of ['测得15.12 cm','结果10 Ω',String.raw`$R=10\ \mathrm{MΩ}$`,'误差5%','时间16 s']) assert.doesNotThrow(()=>integrity.validateText(text,ctx),text);
 assert.doesNotThrow(()=>integrity.validateText('焦距%%DATA:focal_length:%.2f%% cm；$2d=N\\lambda$',ctx));
 assert.throws(()=>integrity.validateText('%%DATA:old:%.2f%%',ctx));
 const rebound=integrity.parameterizeText('焦距15.13 cm',ctx);
 assert.match(rebound,/%%DATA:focal_length:/);
});


test('numbered error paragraphs are structure, never measured data',()=>{
 assert.equal(integrity.validateText('（1）端点误差。\n\n（2）相对误差 %%DATA:delta_e:%.2f%%%。',context).startsWith('（1）'),true);
 assert.ok(integrity.inspectText('（1）误差。\n（2）电阻10.48 MΩ。',context).warnings.length);
});
