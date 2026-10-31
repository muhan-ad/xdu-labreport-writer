import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {recordBlank,validRecord,resizePoints,importMeasurements,exportMeasurements,inspect} from '../src/domain/model.ts';
import {reviewOCR,applyOCR} from '../src/domain/ocr.ts';
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.sourceId==='声速的测量（水中）');
const sample=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id],profile={name:'',studentId:'',className:''};
test('water sound defaults to ten, retains twelve and switches in pairs',()=>{
 let record=recordBlank(exp);assert.equal(record.draft.L1.length,10);assert.equal(record.draft.L2.length,10);
 let twelve=importMeasurements(exp,sample);assert.equal(twelve.L1.length,12);assert.equal(twelve.L2.length,12);assert.ok(validRecord(exp,{...record,draft:twelve}));
 assert.equal(resizePoints(exp.schema,twelve,'L1',-1).L1.length,10);assert.equal(resizePoints(exp.schema,record.draft,'L1',1).L1.length,12);
 const ten={...sample,L1:sample.L1.slice(0,10),L2:sample.L2.slice(0,10)};let draft=importMeasurements(exp,ten);assert.equal(inspect(exp.schema,draft).length,0);const file=exportMeasurements(exp,{...record,draft,soundPhase:'same'},profile);assert.deepEqual(importMeasurements(exp,file),draft);
 assert.throws(()=>importMeasurements(exp,{...ten,L1:sample.L1.slice(0,11)}),/10 或 12/);assert.equal(validRecord(exp,{...record,draft:{...draft,L1:[...draft.L1,'1']}}),false);
});
test('OCR checks allowed lengths without discarding an existing twelfth reading',()=>{
 const draft=importMeasurements(exp,sample), ten=sample.L1.slice(0,10),eleven=sample.L1.slice(0,11);
 const review=reviewOCR(exp.schema,JSON.stringify({data:{L1:ten}}));assert.deepEqual(applyOCR(exp.schema,draft,review,['L1'],true).L1,draft.L1);
 assert.throws(()=>reviewOCR(exp.schema,JSON.stringify({data:{L1:eleven}})),/未识别/);
 assert.deepEqual(applyOCR(exp.schema,recordBlank(exp).draft,review,['L1'],true).L1,ten.map(String));
});
