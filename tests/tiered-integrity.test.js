const test=require('node:test'),assert=require('node:assert/strict');
const {inspectText}=require('../src/shared/report-integrity');
const cases=require('./tiered-integrity-cases.json');
const data={r_mohm:94.0195875,r_0:150.25,c_x_bar:.0985972,focal_length:15.125};
test('shared tiered acceptance fixtures: constants, warnings, rounding, conversions and contradictions',()=>{
 for(const c of cases){
  if(c.status==='block')assert.throws(()=>inspectText(c.text,data),c.text);
  else assert.equal(inspectText(c.text,data).warnings.length>0,c.status==='warn',c.text);
 }
});
