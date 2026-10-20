const test=require('node:test'),assert=require('node:assert/strict'),R=require('./course-filters');
const reviews={recommendation:name=>({'学校A':{name:'A',category:'recommended'},'A':{name:'A',category:'recommended'},'B':{name:'B',category:'not_recommended'}}[name]||null),teacher:name=>({'甲':{category:'recommended'},'乙':{category:'not_recommended'}}[name]||null)};
test('recommendation and explicit selections combine by intersection; selected names form union with aliases',()=>{
 const config=R.normalize({recommendExperiment:true,recommendTeacher:true,specifyExperiments:true,experiments:['A','B'],specifyTeachers:true,teachers:['甲','丙']});
 assert(R.matches({name:'学校A',teacher:'甲'},config,reviews));
 for(const item of [{name:'B',teacher:'甲'},{name:'A',teacher:'乙'},{name:'A',teacher:''},{name:'未知',teacher:'甲'},{name:'A',teacher:'甲／乙'}])assert.equal(R.matches(item,config,reviews),false);
 assert(R.matches({name:'B',teacher:'乙'},R.defaults(),reviews));
});
test('malformed persisted values do not enable filters; selection values deduplicate and stay bounded',()=>{
 const config=R.normalize({hideLab:'true',recommendTeacher:true,experiments:['A','A',null,' ',1],teachers:Array(1500).fill('甲')},{hideAcademic:true});
 assert.equal(config.hideLab,false);assert.equal(config.hideAcademic,true);assert.deepEqual(config.experiments,['A']);assert.deepEqual(config.teachers,['甲']);
});
test('catalogue keeps exact teacher and experiment time pairings, aggregates duplicate weeks and excludes ambiguous teacher identities',()=>{
 const result=R.catalog([{name:'学校A',teacher:'甲',time:'星期三下午15:55-18:10'},{name:'学校A',teacher:'甲',time:'星期三下午15:55-18:10'},{name:'学校A',teacher:'乙',time:'星期四晚上18:30-20:45'},{name:'B',teacher:'甲',time:'星期五晚上18:30-20:45'},{name:'B',teacher:'甲／乙',time:'星期二下午15:55-18:10'}],reviews);
 assert.equal(result.experiments.length,2);assert.equal(result.teachers.length,2);assert.equal(result.unknown,1);
 assert.deepEqual(result.teachers.find(x=>x.name==='甲').pairs,[{name:'学校A',times:['周三下午']},{name:'B',times:['周五晚上']}]);
 assert.deepEqual(result.experiments.find(x=>x.id==='A').pairs,[{name:'甲',times:['周三下午']},{name:'乙',times:['周四晚上']}]);
});
test('client cancellation matches the inclusive 72 hour China time boundary',()=>{
 const interval={date:'2030-01-10',start:'15:55'},start=Date.parse('2030-01-10T15:55:00+08:00'),item={cancellable:true};
 assert(R.cancelState(item,interval,start-72*3600000-1).allowed);assert.equal(R.cancelState(item,interval,start-72*3600000).allowed,false);assert.equal(R.cancelState(item,interval,start).reason,'已开始');assert.equal(R.cancelState(item,null,start).reason,'实验时间待核实');assert.equal(R.cancelState({cancellable:false},interval,start-74*3600000).allowed,false);
});
