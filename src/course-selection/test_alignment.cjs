const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8').split('// UI')[0];
const {getCategory,alignExperiments}=vm.runInNewContext(source+';({getCategory,alignExperiments})',{setTimeout,Promise,Map,Set});
const entry=(name,day,index=0)=>({name,day,index,kind:'available',item:{name,day}});
const rowOf=(rows,name)=>rows.findIndex(row=>row.some(cell=>cell.some(item=>item.name===name)));
test('school aliases follow the app categories including other',()=>{
 const groups={mechanics:['扭摆法测量切变模量实验','复摆实验','拉伸法测量杨氏弹性模量实验'],optics:['牛顿环实验','迈克尔逊干涉仪测激光波长实验','光栅衍射实验','三棱镜顶角的测量实验','薄透镜焦距测量实验','单缝衍射光强分布实验','偏振光的特性测量实验'],electromagnetism:['RLC电路的稳态特性研究实验','电子束的电磁偏转特性实验','冲击法测量直螺线管磁场实验','电容及高电阻测量实验','霍尔效应测量磁场实验','低电阻的测量实验','灵敏电流计特性测量实验'],other:['理想气体状态方程实验','声速的测量（空气）']};
 for(const [category,names]of Object.entries(groups))for(const name of names)assert.equal(getCategory(name),category,name);
});
test('same experiment on different weekdays occupies one shared row',()=>{
 const rows=alignExperiments([entry('光栅实验',1),entry('光栅实验',3),entry('光栅实验',5),entry('牛顿环实验',1),entry('牛顿环实验',4)]);
 for(const name of ['光栅实验','牛顿环实验']){const positions=[];rows.forEach((row,index)=>row.forEach(cell=>cell.forEach(item=>{if(item.name===name)positions.push(index);})));assert.equal(new Set(positions).size,1);}
 assert.equal(rowOf(rows,'光栅实验'),0);assert.notEqual(rowOf(rows,'牛顿环实验'),0);
});
test('different experiments use spare weekdays without overlapping',()=>{
 const rows=alignExperiments([entry('复摆实验',1),entry('光栅实验',2)]);assert.equal(rows.length,1);assert.equal(rows[0][0][0].name,'复摆实验');assert.equal(rows[0][1][0].name,'光栅实验');
});
test('hiding experiments independently recomputes rows without reserved gaps',()=>{
 const all=[entry('光栅实验',1),entry('光栅实验',2),entry('光栅实验',3),entry('牛顿环实验',1),entry('牛顿环实验',4)];
 assert.equal(rowOf(alignExperiments(all),'牛顿环实验'),1);
 assert.equal(rowOf(alignExperiments(all.filter(x=>x.name!=='光栅实验')),'牛顿环实验'),0);
});
test('sorting does not mutate entries or change their action indexes',()=>{
 const items=[entry('牛顿环实验',5,99),entry('光栅实验',2,3),entry('光栅实验',4,7)],before=JSON.stringify(items);
 const arranged=alignExperiments(items);assert.equal(JSON.stringify(items),before);
 assert.deepEqual(Array.from(arranged.flat(2),x=>x.index).sort((a,b)=>a-b),[3,7,99]);
 assert.equal(JSON.stringify(arranged),JSON.stringify(alignExperiments([...items].reverse())));
});
test('empty view remains a five-day row; duplicate same-day records stay intact',()=>{
 assert.equal(alignExperiments([])[0].length,5);
 const rows=alignExperiments([entry('光栅实验',1,1),entry('光栅实验',1,2)]);assert.equal(rows[0][0].length,2);
});
