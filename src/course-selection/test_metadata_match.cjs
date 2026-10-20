const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8'),{resolveCourseMetadata}=vm.runInNewContext(source.split('// UI')[0]+';({resolveCourseMetadata})',{setTimeout});
test('teacher lookup respects experiment-scoped week, time, parity and does not overwrite enrolled room',()=>{
 const item={name:'A',week:7,time:'星期一下午15:55-18:10'},details={rooms:['楼201'],schedules:[{time:item.time,firstWeek:2,lastWeek:8,teacher:'教师甲'},{time:item.time,firstWeek:9,lastWeek:14,teacher:'教师乙'},{time:'星期二下午15:55-18:10',firstWeek:2,lastWeek:14,teacher:'另一场次'}]};
 assert.equal(resolveCourseMetadata(item,details).teacher,'教师甲');assert.equal(resolveCourseMetadata({...item,week:10},details).teacher,'教师乙');assert.equal(resolveCourseMetadata({...item,week:19},details).teacher,'');
 assert.equal(resolveCourseMetadata({...item,room:'官网已选教室'},details).room,'官网已选教室');
 const multiple=resolveCourseMetadata(item,{...details,rooms:['楼201','楼202']});assert.equal(multiple.room,'');assert.match(multiple.metadataWarning,/多个教室/);
 assert.equal(resolveCourseMetadata({...item,week:8},{...details,schedules:[{...details.schedules[0],parity:'单周'}]}).teacher,'');
});
