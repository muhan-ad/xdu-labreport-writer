'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const cache=require('../src/main/ocr-cache');
const image='data:image/png;base64,iVBORw0KGgo=';
const schema={groups:[{fields:[{key:'x',type:'number'}]}]};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ocr-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const state=expId=>({expId,fields:[{key:'x',value:2,status:'ok'}],dataUrl:image,originalDataUrl:image,
 aiRaw:{fields:{x:{value:2},apiKey:'DO_NOT_PERSIST'}},apiKey:'DO_NOT_PERSIST',includeStudent:false,
 reviewControls:[{key:'x',kind:'value',value:'3.5'}]});
test('last result survives restart, stays per experiment and excludes unrelated secret fields',t=>{
 const root=fixture(t),a=path.join(root,'A'),b=path.join(root,'B');
 cache.save(a,state('A'),schema);cache.save(b,state('B'),schema);
 assert.equal(cache.read(a,schema).record.state.reviewControls[0].value,'3.5');
 assert.equal(cache.read(b,schema).record.state.expId,'B');
 assert.doesNotMatch(fs.readFileSync(path.join(a,'.ocr-last-result.json'),'utf8'),/DO_NOT_PERSIST/);
 assert.throws(()=>cache.save(a,state('B'),schema),/当前实验/);
 assert.equal(cache.read(a,{groups:[]}).schemaChanged,true);
 assert.ok(fs.existsSync(path.join(a,'.ocr-last-result.json')));
});
test('cache rejects invalid images and failed replacement preserves prior result',t=>{
 const dir=path.join(fixture(t),'A');cache.save(dir,state('A'),schema);
 assert.throws(()=>cache.save(dir,{...state('A'),dataUrl:'https://outside.example/a.png'},schema),/图片/);
 assert.equal(cache.read(dir,schema).record.state.fields[0].value,2);
});
