const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8').split('// UI')[0];
const {collectSearchResults}=vm.runInNewContext(source+';({collectSearchResults})',{setTimeout,Promise,Map,Set});
const slot=(week,name,day=1,period='B',remaining=2)=>({week,name,day,period,remaining,time:`星期${day}${period}`});
test('search spans all snapshots rather than a currently selected week',()=>{
 const found=collectSearchResults([{week:7,slots:[slot(7,'光栅实验')]},{week:14,slots:[slot(14,'光栅实验')]}],'光栅');
 assert.deepEqual(Array.from(found,x=>x.week),[7,14]);
});
test('only matching experiments with finite positive remaining seats appear',()=>{
 const rows=[slot(7,'光栅',1,'B',0),slot(7,'光栅',2,'B',-1),slot(7,'光栅',3,'B',null),slot(7,'光栅',4,'B',Infinity),slot(7,'牛顿环'),slot(7,'光栅',5,'B',1)];
 const found=collectSearchResults([{week:7,slots:rows}],'光栅');assert.equal(found.length,1);assert.equal(found[0].day,5);
});
test('empty query lists all available experiments; matching trims and ignores Latin case',()=>{
 const data=[{week:7,slots:[slot(7,'RLC实验'),slot(7,'牛顿环实验')]}];
 assert.equal(collectSearchResults(data,'').length,2);assert.equal(collectSearchResults(data,'  rlc ').length,1);
});
test('deduplication preserves distinct times and weeks with correct selection identity',()=>{
 const row=slot(7,'光栅',2),data=[{week:7,slots:[row,{...row},slot(7,'光栅',4,'C')]},{week:8,slots:[slot(8,'光栅',2)]}];
 const before=JSON.stringify(data),found=collectSearchResults(data,'光栅');assert.equal(found.length,3);assert.equal(found[2].week,8);assert.equal(found[1].day,4);assert.equal(found[1].period,'C');assert.equal(JSON.stringify(data),before);
});
test('mismatched week data is not accidentally offered as another week',()=>{
 assert.equal(collectSearchResults([undefined,{week:7,slots:[slot(8,'光栅')]}],'光栅').length,0);
});
