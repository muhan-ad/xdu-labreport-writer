import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {recordBlank,validRecord,resizePoints,importMeasurements,exportMeasurements,inspect,restoreDraft} from '../src/domain/model.ts';
import {reviewOCR,applyOCR} from '../src/domain/ocr.ts';
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.sourceId==='声速的测量（水中）');
const sample=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id],profile={name:'',studentId:'',className:''};
test('water sound defaults to ten, retains twelve and resizes one reading at a time',()=>{
 let record=recordBlank(exp);assert.equal(record.draft.L1.length,10);assert.equal(record.draft.L2.length,10);
 let twelve=importMeasurements(exp,sample);assert.equal(twelve.L1.length,12);assert.equal(twelve.L2.length,12);assert.ok(validRecord(exp,{...record,draft:twelve}));
 assert.equal(resizePoints(exp.schema,twelve,'L1',-1).L1.length,11);assert.equal(resizePoints(exp.schema,record.draft,'L1',1).L1.length,11);
 const ten={...sample,L1:sample.L1.slice(0,10),L2:sample.L2.slice(0,10)};let draft=importMeasurements(exp,ten);assert.equal(inspect(exp.schema,draft).length,0);const file=exportMeasurements(exp,{...record,draft,soundPhase:'same'},profile);assert.deepEqual(importMeasurements(exp,file),draft);
 assert.equal(importMeasurements(exp,{...ten,L1:sample.L1.slice(0,11)}).L1.length,11);
 assert.throws(()=>importMeasurements(exp,{...ten,L1:sample.L1.slice(0,3)}),/测量点数|长度/);
});
test('existing polarization records remain readable when optional observations are added',()=>{
 const e=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.id==='80846705f12f');
 const r=recordBlank(e);
 const old={...r,draft:{cos2_values:r.draft.cos2_values,p_values:r.draft.p_values}};
 assert.ok(validRecord(e,old));
 assert.equal(restoreDraft(e.schema,old.draft).plate_45_state,'');
 assert.equal(validRecord(e,{...old,draft:{cos2_values:[]}}),false);
});
test('OCR accepts intermediate lengths without discarding an existing twelfth reading',()=>{
 const draft=importMeasurements(exp,sample), ten=sample.L1.slice(0,10),eleven=sample.L1.slice(0,11);
 const review=reviewOCR(exp.schema,JSON.stringify({data:{L1:ten}}));assert.deepEqual(applyOCR(exp.schema,draft,review,['L1'],true).L1,draft.L1);
 assert.equal(applyOCR(exp.schema,recordBlank(exp).draft,reviewOCR(exp.schema,JSON.stringify({data:{L1:eleven}})),['L1'],true).L1.length,11);
 assert.deepEqual(applyOCR(exp.schema,recordBlank(exp).draft,review,['L1'],true).L1,ten.map(String));
});
