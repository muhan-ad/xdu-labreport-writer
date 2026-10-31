import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {recordBlank,importMeasurements,convert} from '../src/domain/model.ts';import {reviewOCR,applyOCR,ocrRetainsTail} from '../src/domain/ocr.ts';
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(x=>x.sourceId==='声速的测量（水中）');const sample=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id];
test('shorter OCR results retain existing water measurements including zero',()=>{
 const old=structuredClone(sample);old.L1[10]=0;old.L1[11]=99;const draft=importMeasurements(exp,old),review=reviewOCR(exp.schema,JSON.stringify({data:{L1:Array(10).fill(7)}}));
 assert.equal(ocrRetainsTail(exp.schema,draft,review,['L1']),true);const next=applyOCR(exp.schema,draft,review,['L1'],false);assert.deepEqual(next.L1.slice(0,10),Array(10).fill('7'));assert.deepEqual(next.L1.slice(10),['0','99']);assert.deepEqual(draft.L1.slice(10),['0','99']);assert.equal(ocrRetainsTail(exp.schema,draft,review,['L2']),false);
});
test('shorter OCR may shrink a blank tail and never changes unselected fields',()=>{
 const blank=recordBlank(exp),expanded={...blank.draft,L1:Array(12).fill('')},review=reviewOCR(exp.schema,JSON.stringify({data:{L1:Array(10).fill(7)}}));assert.equal(ocrRetainsTail(exp.schema,expanded,review,['L1']),false);const next=applyOCR(exp.schema,expanded,review,['L1'],false);assert.equal(next.L1.length,10);assert.deepEqual(next.L2,expanded.L2);
});
test('water ten-point recognition can fill blanks in an existing twelve-point record without shrinking',()=>{
 const old=structuredClone(sample);old.L1[0]=0;old.L1[1]=null;old.L1[10]=null;old.L1[11]=99;
 const draft=importMeasurements(exp,old),review=reviewOCR(exp.schema,JSON.stringify({data:{L1:Array(10).fill(7)}}));
 const next=applyOCR(exp.schema,draft,review,['L1'],true);
 assert.equal(next.L1.length,12);assert.equal(next.L1[0],'0');assert.equal(next.L1[1],'7');assert.deepEqual(next.L1.slice(10),['','99']);assert.deepEqual(next.L2,draft.L2);
});
test('coupled position and matrix tails remain aligned and preserve all old cells',()=>{
 const schema={groups:[{name:'',fields:[{key:'x',label:'位置',type:'array',length:3,variableLength:true,minLength:3,maxLength:12,required:true},{key:'y',label:'测量值',type:'matrix',rows:2,colsFrom:'x',required:true}]}]};
 const draft={x:['1','2','3','4','5'],y:[['1','2','3','4','0'],['6','7','8','9','10']]};const review=reviewOCR(schema,JSON.stringify({data:{x:[11,12,13],y:[[21,22,23],[31,32,33]]}}));
 const next=applyOCR(schema,draft,review,['x','y'],false);assert.deepEqual(next.x,['11','12','13','4','5']);assert.deepEqual(next.y,[['21','22','23','4','0'],['31','32','33','9','10']]);assert.equal(ocrRetainsTail(schema,draft,review,['x','y']),true);assert.equal(convert(schema,next).issues.length,0);
});
test('unequal retained tails refuse mismatched coupled data without mutation',()=>{
 const schema={groups:[{name:'',fields:[{key:'x',label:'位置',type:'array',length:3,variableLength:true,minLength:3,maxLength:12,required:true},{key:'y',label:'测量值',type:'matrix',rows:1,colsFrom:'x',required:true}]}]};const draft={x:['1','2','3','',''],y:[['1','2','3','4','5']]},review=reviewOCR(schema,JSON.stringify({data:{x:[11,12,13],y:[[21,22,23]]}}));assert.throws(()=>applyOCR(schema,draft,review,['x','y'],false),/长度不同/);assert.deepEqual(draft.y[0],['1','2','3','4','5']);
});
