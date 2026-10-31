import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewOCR,applyOCR,correctedOCR,ocrPrompt} from '../src/domain/ocr.ts';
import {fields,makeDraft,convert,inspect} from '../src/domain/model.ts';

const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments;
const cases=catalog.flatMap(exp=>fields(exp.schema).filter(f=>f.type==='matrix'&&f.variableRows).map(field=>({exp,field})));
const review=(schema,key,rows)=>reviewOCR(schema,JSON.stringify({data:{[key]:rows}}));

test('actual convex-lens and RLC partial observation rows remain usable without invented measurements',()=>{
  assert.equal(cases.length,3);
  for(const {exp,field} of cases){
    const rows=Array.from({length:field.minFilledRows},(_,r)=>Array.from({length:field.cols},(_,c)=>r*10+c));
    const result=review(exp.schema,field.key,rows);
    assert.deepEqual(result.errors,[],exp.name);
    assert.equal(result.values[field.key].length,field.rows);
    assert.deepEqual(result.values[field.key].slice(0,rows.length),rows);
    assert.ok(result.values[field.key].slice(rows.length).flat().every(n=>n===null));
    const draft=applyOCR(exp.schema,makeDraft(exp.schema),result,[field.key],true);
    assert.deepEqual(convert(exp.schema,draft).data[field.key],result.values[field.key]);
    assert.deepEqual(correctedOCR(exp.schema,result,{[field.key]:rows},[field.key]).values,result.values);
  }
});

test('partial subsequent recognition never erases existing optional rows and clear removes old measurements',()=>{
  const {exp,field}=cases[0],key=field.key;
  const initial=review(exp.schema,key,[[1,2,3],[4,5,6],[7,8,9],[10,11,12]]);
  const draft=applyOCR(exp.schema,makeDraft(exp.schema),initial,[key],false);
  const next=review(exp.schema,key,[[20,21,22],[23,null,25],[26,27,28]]);
  const onlyEmpty=convert(exp.schema,applyOCR(exp.schema,draft,next,[key],true)).data[key];
  assert.deepEqual(onlyEmpty.slice(0,4),initial.values[key].slice(0,4));
  const replaced=convert(exp.schema,applyOCR(exp.schema,draft,next,[key],false)).data[key];
  assert.deepEqual(replaced[0],[20,21,22]);
  assert.deepEqual(replaced[1],[23,5,25]);
  assert.deepEqual(replaced[3],[10,11,12]);
  const cleared=convert(exp.schema,applyOCR(exp.schema,makeDraft(exp.schema),next,[key],false)).data[key];
  assert.ok(cleared.slice(3).flat().every(n=>n===null));
  assert.deepEqual(draft[key][3],['10','11','12']);
});

test('optional row capacity never permits clipping, malformed rows or relaxing fixed instrument groups',()=>{
  const {exp,field}=cases[0],key=field.key;
  for(const rows of [[],Array.from({length:field.rows+1},()=>[1,2,3]),[[1,2]],[[1,2,3,4]],[null]])
    assert.throws(()=>review(exp.schema,key,rows),/未识别出/);
  const fixed={groups:[{name:'',fields:[{key:'fixed',label:'固定组',type:'matrix',rows:3,cols:2,required:true}]}]};
  assert.throws(()=>review(fixed,'fixed',[[1,2],[3,4]]),/未识别出/);
  const coupled={groups:[{name:'',fields:[{key:'y',label:'电压组',type:'matrix',rows:3,colsFrom:'x',variableRows:true,required:true}]}]};
  assert.throws(()=>review(coupled,'y',[[1,2],[3,4]]),/未识别出/);
});

test('partial valid observation remains reviewable below report minimum and prompt states actual lengths',()=>{
  const {exp,field}=cases[0];
  const result=review(exp.schema,field.key,[[0,null,2]]);
  assert.deepEqual(result.values[field.key][0],[0,null,2]);
  assert.ok(result.values[field.key].slice(1).flat().every(n=>n===null));
  const schema={groups:[{name:'',fields:[field]}]};
  const draft=applyOCR(schema,makeDraft(schema),result,[field.key],false);
  assert.ok(inspect(schema,draft).some(issue=>issue.message.includes('至少填写')));
  const prompt=ocrPrompt(exp.name,exp.schema);
  assert.match(prompt,/variableLength.*实际测点数/);
  assert.match(prompt,/variableRows.*实际测量行/);
  assert.match(prompt,/colsFrom.*一致/);
  assert.doesNotMatch(prompt,/数组保留指定长度，缺失/);
});
