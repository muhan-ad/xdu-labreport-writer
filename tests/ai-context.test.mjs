import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectExperimentKnowledge,reportSystemPrompt,measurementContext,validCalculationContext} from '../src/domain/ai-context.ts';
import {createKnowledgeLoader} from '../src/domain/ai-knowledge.ts';
import {textHash} from '../src/domain/ai-library.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments;
const sources=JSON.parse(fs.readFileSync('public/report-runtime/report-sources.json'));

test('all 28 AI knowledge entries exactly match the bundled and original experiment Markdown, with no alias substitution',()=>{
 const selected=selectExperimentKnowledge(sources,catalog.map(e=>e.sourceId));
 assert.equal(selected.size,28);
 for(const exp of catalog){
  const original=fs.readFileSync(`E:/apps/xdu-labreport-writer-master/物理实验/实验脚本/${exp.sourceId}/rag/原理.md`,'utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  assert.equal(selected.get(exp.sourceId).text,original);
  assert.deepEqual(Object.keys(selected.get(exp.sourceId)).sort(),['sourceId','text']);
 }
 const first=catalog[0].sourceId,missing={...sources};delete missing[first+'/rag/原理.md'];
 assert.throws(()=>selectExperimentKnowledge(missing,[first]),/知识缺失/);
 for(const id of ['../别的实验','a/b','a\\b','.','..',''])assert.throws(()=>selectExperimentKnowledge(sources,[id]),/路径无效/);
 assert.throws(()=>selectExperimentKnowledge([],[]),/格式无效/);
});

test('AI prompts preserve complete knowledge and current values, exclude unrelated skills and keep output/data constraints after skills',()=>{
 const text='知识起始\n'+('知识正文。'.repeat(1800))+'\n知识末尾';
 const skill={id:'a'.repeat(64),name:'报告技能',description:'',content:'REPORT_ONLY',scope:'report',enabled:true};
 const data={zero:0,missing:null,precise:0.1234567890123,unit:'mA'};
 for(const kind of ['quiz','polish']){
  const prompt=reportSystemPrompt({name:'实验一',sourceId:'一',knowledge:{sourceId:'一',text},skills:[skill,{...skill,content:'PLOT_ONLY',scope:'plot'},{...skill,content:'DISABLED',enabled:false}],measurements:data,kind});
  assert.ok(prompt.includes(text));assert.ok(prompt.includes(JSON.stringify(data)));
  assert.ok(!prompt.includes('PLOT_ONLY'));assert.ok(!prompt.includes('DISABLED'));
  assert.ok(prompt.indexOf('当前任务格式与数据硬约束')>prompt.indexOf('REPORT_ONLY'));
  assert.ok(prompt.includes('不得以教材或示例数值补齐'));assert.ok(prompt.includes('不得把缺失值当作零'));
  if(kind==='quiz')assert.ok(prompt.includes('仅返回 JSON {"answers"'));
  else assert.ok(prompt.includes('原文每个 $...$ 或 $$...$$ 公式必须逐字保留'));
 }
 assert.deepEqual(data,{zero:0,missing:null,precise:0.1234567890123,unit:'mA'});
 assert.throws(()=>reportSystemPrompt({name:'实验一',sourceId:'一',knowledge:{sourceId:'二',text},skills:[],measurements:data,kind:'quiz'}),/不一致/);
});

test('knowledge loader verifies exact bundled bytes, coalesces reads, retries failures and never returns a foreign experiment',async()=>{
 const archive=JSON.stringify({'一/rag/原理.md':'第一份完整知识','二/rag/原理.md':'第二份完整知识','private.py':'unrelated'});
 const record={bytes:new TextEncoder().encode(archive).length,sha256:await textHash(archive)};
 let fail='network',calls=[];
 const load=createKnowledgeLoader(['一','二'],async name=>{
  calls.push(name);
  if(fail==='network')throw Error('读取失败');
  if(name==='manifest.json')return Response.json({files:{'report-sources.json':fail==='manifest'?{...record,bytes:9000000}:record}});
  if(fail==='missing')return new Response('',{status:404});
  return new Response(fail==='hash'?archive+' ':archive);
 });
 await assert.rejects(load('未知'),/未找到/);assert.deepEqual(calls,[]);
 for(const [mode,message] of [['network',/读取失败/],['manifest',/清单无效/],['missing',/未能读取/],['hash',/校验失败/]]){fail=mode;await assert.rejects(load('一'),message);}
 fail='';calls=[];
 const [a,b]=await Promise.all([load('一'),load('二')]);
 assert.deepEqual(calls,['manifest.json','report-sources.json']);
 assert.deepEqual(a,{sourceId:'一',text:'第一份完整知识'});assert.deepEqual(b,{sourceId:'二',text:'第二份完整知识'});
 a.text='modified';assert.equal((await load('一')).text,'第一份完整知识');
 assert.deepEqual(calls,['manifest.json','report-sources.json']);
});

test('measurement context pairs actual units and matrix labels with values for every experiment without inventing missing data',()=>{
 const samples=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'));
 for(const exp of catalog){
  const data=structuredClone(samples[exp.id]),before=structuredClone(data),groups=measurementContext(exp.schema,data);
  for(let g=0;g<groups.length;g++)for(let i=0;i<groups[g].fields.length;i++){
   const actual=groups[g].fields[i],field=exp.schema.groups[g].fields[i];
   assert.equal(actual.key,field.key);assert.equal(actual.label,field.label);assert.equal(actual.unit,field.unit||undefined);
   assert.deepEqual(actual.rowLabels,field.rowLabels);assert.deepEqual(actual.colLabels,field.colLabels);assert.deepEqual(actual.value,data[field.key]??null);
  }
  assert.deepEqual(data,before);
 }
 const schema={groups:[{name:'实际单位',fields:[{key:'current',label:'电流',type:'number',unit:'mA'},{key:'radius',label:'半径',type:'number',unit:'cm'},{key:'missing',label:'缺失',type:'number'}]}]};
 assert.deepEqual(measurementContext(schema,{current:0,radius:1.4})[0].fields.map(f=>[f.unit,f.value]),[['mA',0],['cm',1.4],[undefined,null]]);
});

test('one missing experiment knowledge does not disable another, and a repaired archive can be retried',async()=>{
 let sources={'一/rag/原理.md':'完整的一'};
 const load=createKnowledgeLoader(['一','二'],async name=>{
  const archive=JSON.stringify(sources);
  return name==='manifest.json'?Response.json({files:{'report-sources.json':{bytes:new TextEncoder().encode(archive).length,sha256:await textHash(archive)}}}):new Response(archive);
 });
 assert.equal((await load('一')).text,'完整的一');
 await assert.rejects(load('二'),/知识缺失/);
 sources['二/rag/原理.md']='修复的二';
 assert.equal((await load('二')).text,'修复的二');assert.equal((await load('一')).text,'完整的一');
});

test('calculated context keeps exact values, binds the experiment and rejects nonfinite/oversized/foreign results',()=>{
 const value={experimentId:'abcdef123456',sourceId:'一',values:{zero:0,optional:null,precise:0.013999999999999999,points:[1,2,null],nested:{unit:'mA'}}};
 assert.equal(validCalculationContext(value,value.experimentId,'一'),true);
 for(const wrong of [{...value,sourceId:'二'},{...value,experimentId:'123456abcdef'},{...value,values:{n:NaN}},{...value,values:{n:Infinity}},{...value,values:{n:()=>0}},{...value,values:{text:'x'.repeat(400001)}}])assert.equal(validCalculationContext(wrong,value.experimentId,'一'),false);
 const input={name:'实验一',sourceId:'一',experimentId:value.experimentId,knowledge:{sourceId:'一',text:'原理依据'},skills:[],measurements:{x:0},kind:'quiz',calculation:value};
 const prompt=reportSystemPrompt(input);assert.ok(prompt.includes(JSON.stringify(value.values)));assert.ok(prompt.includes('null 或未提供的结果表示当前未能求出'));assert.ok(prompt.includes('内部精度'));
 assert.throws(()=>reportSystemPrompt({...input,experimentId:'123456abcdef'}),/计算结果/);
 const noResult=reportSystemPrompt({...input,calculation:undefined});assert.ok(noResult.includes('不宣称得到了本次派生结果'));
});
