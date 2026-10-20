const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const {experimentInterval,personalConflict}=vm.runInNewContext(source.split('// UI')[0]+';({experimentInterval,personalConflict})',{setTimeout});
const {hideExperiment}=vm.runInNewContext(source.split('// UI')[0]+';({hideExperiment})',{setTimeout});
const enrolled=[{name:'原有实验',week:2,date:'2026/9/15',time:'星期二晚上18:30-20:45'}];
const item={name:'新实验',week:2,time:'星期四下午15:55-18:10'};
const event={name:'高数',date:'2026-09-17',start:'15:55',end:'17:30'};
test('uses actual lab date across week numbers',()=>assert.equal(experimentInterval(item,enrolled).date,'2026-09-17'));
test('official calendar works before any enrollment',()=>assert.equal(experimentInterval(item,[],{week:2,date:'2026/9/16',time:'星期三00:00-00:01'}).date,'2026-09-17'));
test('no date anchor returns unknown, no guess',()=>assert.equal(experimentInterval(item,[]),null));
test('overlap, adjacent boundaries, separate days',()=>{assert.equal(personalConflict({events:[event]},item,enrolled).name,'高数');assert.equal(personalConflict({events:[{...event,start:'18:10',end:'19:00'}]},item,enrolled),null);assert.equal(personalConflict({events:[{...event,date:'2026-09-18'}]},item,enrolled),null);});
test('does not exclude arbitrary lab courses',()=>{const same={name:'大学物理实验',date:'2026-09-15',start:'18:30',end:'20:45'},slot={...item,time:'星期二晚上18:30-20:45'};assert.equal(personalConflict({events:[same]},slot,enrolled),null);assert.ok(personalConflict({events:[{...same,name:'电子技术实验'}]},slot,enrolled));});
test('entry synchronization has no polling timer',()=>{assert.ok(source.includes('academicReady=syncAcademic()'));assert.ok(source.includes('await academicReady'));assert.ok(source.includes('academicStarted===account'));assert.ok(source.includes("if(!interactive){academicState={...academicState,status:academicState.snapshot?'cached':'not_connected'};render();return;}"));assert.ok(!source.includes('setInterval('));});
test('afternoon checks 15:55–17:30 and evening checks every evening period',()=>{
 for(const [time,cases]of [['星期四下午15:55-18:10',[['14:00','15:55',false],['15:55','16:40',true],['17:29','18:10',true],['17:30','18:10',false]]],['星期四晚上18:30-20:45',[['18:00','19:00',false],['19:00','19:45',true],['20:50','21:25',true],['21:25','22:00',false]]]])for(const [start,end,expected]of cases){
  const snapshot={events:[{name:'普通课程',date:'2026-09-17',start,end}]},slot={...item,time,date:'2026/9/17'};
  assert.equal(!!personalConflict(snapshot,slot,[]),expected,`${time} ${start}`);
  assert.equal(hideExperiment(slot,false,true,{enrolled:[]},snapshot),expected);
  assert.equal(hideExperiment(slot,false,false,{enrolled:[]},snapshot),false);
 }
});
test('lab and academic hiding are independent, and unknown timetable is not marked free',()=>{
 const overview={enrolled:[{...item}]};assert.equal(hideExperiment(item,true,false,overview,null),true);
 assert.equal(hideExperiment(item,false,true,overview,null),false);assert.equal(personalConflict(null,item,[]),null);
});
