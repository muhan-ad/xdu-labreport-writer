'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const validation=require('../src/shared/data-validation');
const base=path.join(__dirname,'../物理实验/实验脚本/电子偏转特性的测量');
const schema=JSON.parse(fs.readFileSync(path.join(base,'schema.json')));
function data(n){const d={};for(const g of schema.groups){const [a,m]=g.fields;d[a.key]=Array.from({length:n},(_,i)=>i-4);d[m.key]=Array.from({length:3},(_,r)=>d[a.key].map(x=>x*(r+1)));}return d;}
test('paired variable measurements accept actual counts while enforcing one-to-one alignment',()=>{
 for(const n of [3,7,9,11,100])assert.deepEqual(validation.validate(schema,data(n)),[],String(n));
 const d=data(9);d.Im[1].pop();assert.match(validation.validate(schema,d,false).join(';'),/逐点对应/);
 d.Im[1].push(2);d.Im.pop();assert.match(validation.validate(schema,d,false).join(';'),/3 组电压/);
 assert.match(validation.validate(schema,data(2)).join(';'),/测量点数/);
 assert.match(validation.validate(schema,data(101),false).join(';'),/测量点数/);
});
test('review dimensions retain all recognized positions and values, including mismatched longer rows',()=>{
 const [a,m]=schema.groups[2].fields,d=data(9);d.Im[0].push(10,11);
 assert.equal(validation.dimensions(a,d).length,11);assert.equal(validation.dimensions(m,d).cols,11);
 assert.equal(validation.dimensions(a,{}).length,7);assert.equal(validation.dimensions(m,{}).cols,7);
 assert.ok(validation.validate(schema,d,false).length);
});
test('fixed-count experiments retain strict shape validation',()=>{
 assert.ok(validation.validate({groups:[{fields:[{key:'x',type:'array',length:7}]}]},{x:Array(9).fill(1)},false).length);
});
