'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_COURSE_SMOKE_WORK;if(!work)throw Error('Isolated directory required');fs.mkdirSync(work,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(work,'filter-profile-')));app.on('browser-window-created',(_,win)=>win.hide());
app.whenReady().then(async()=>{
 let controller;const timer=setTimeout(()=>app.exit(1),20000);
 try{
  controller=require('../src/main/course-selection').createCourseSelection({electron:require('electron'),root,getParent:()=>null,resolvePython:()=>path.join(root,'python-runtime/python.exe'),userData:app.getPath('userData')});assert.equal((await controller.open()).ok,true);const win=BrowserWindow.getAllWindows()[0];win.hide();
  const result=await win.webContents.executeJavaScript(`(()=>{
   const afternoon={name:'AFTERNOON_TEST',week:2,day:4,period:'B',remaining:5,time:'星期四下午15:55-18:10',date:'2026/9/17'},evening={...afternoon,name:'EVENING_TEST',period:'C',time:'星期四晚上18:30-20:45'};
   overview={enrolled:[],weeks:[2],calendarAnchor:{week:2,date:'2026/9/17',time:'星期四00:00-00:01'}};weekData={week:2,slots:[afternoon,evening]};
   academicState={status:'fresh',snapshot:{events:[{name:'AFTERNOON_CLASS',date:'2026-09-17',start:'15:55',end:'17:30'}]}};busy=false;document.getElementById('week').innerHTML='<option value="2">第2周</option>';render();
   const details={rooms:['测试教室201'],schedules:[{time:afternoon.time,firstWeek:1,lastWeek:8,teacher:'TEST_TEACHER'},{time:afternoon.time,firstWeek:9,lastWeek:19,teacher:'OTHER_WEEK_TEACHER'}],warnings:[]};metadataCache.set(afternoon.name,{version:weeksCache.version,data:details});render();
   const metadata={teacher:document.getElementById('calendar').textContent.includes('TEST_TEACHER'),room:document.getElementById('calendar').textContent.includes('测试教室201'),wrongWeek:document.getElementById('calendar').textContent.includes('OTHER_WEEK_TEACHER')};
   const before={cards:document.querySelectorAll('.course').length,blocked:document.querySelectorAll('.course.unavailable').length};
   document.getElementById('hideAcademicConflicts').checked=true;document.getElementById('hideAcademicConflicts').dispatchEvent(new Event('change'));
   const hidden={cards:document.querySelectorAll('.course').length,afternoon:document.getElementById('calendar').textContent.includes('AFTERNOON_TEST'),evening:document.getElementById('calendar').textContent.includes('EVENING_TEST')};
   searchWeeks=[2];weeksCache.values.set(2,weekData);document.getElementById('searchDialog').showModal();renderCourseSearch();const search={count:searchResults.length,name:searchResults[0]?.name};
   academicState.snapshot.events.push({name:'LATE_CLASS',date:'2026-09-17',start:'20:50',end:'21:25'});render();renderCourseSearch();const late={cards:document.querySelectorAll('.course').length,search:searchResults.length};
   document.getElementById('hideAcademicConflicts').checked=false;renderCourseSearch();const searchMetadata=document.getElementById('searchResults').textContent.includes('TEST_TEACHER');document.getElementById('searchDialog').close();view='enrolled';overview.enrolled=[{...afternoon,room:'官网已选教室',hours:3}];render();const enrolledMetadata={teacher:document.getElementById('calendar').textContent.includes('TEST_TEACHER'),room:document.getElementById('calendar').textContent.includes('官网已选教室')};
   academicState.snapshot=null;renderAcademicStatus();return {metadata,searchMetadata,enrolledMetadata,before,hidden,search,late,disabledWithoutTimetable:document.getElementById('hideAcademicConflicts').disabled};
  })()`);
  assert.deepEqual(result.before,{cards:2,blocked:1});assert.deepEqual(result.hidden,{cards:1,afternoon:false,evening:true});assert.deepEqual(result.search,{count:1,name:'EVENING_TEST'});assert.deepEqual(result.late,{cards:0,search:0});assert.equal(result.disabledWithoutTimetable,true);
  assert.deepEqual(result.metadata,{teacher:true,room:true,wrongWeek:false});assert.equal(result.searchMetadata,true);assert.deepEqual(result.enrolledMetadata,{teacher:true,room:true});
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,...result},null,2));controller.shutdown();clearTimeout(timer);app.exit(0);
 }catch(error){fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.stack}));controller?.shutdown();clearTimeout(timer);app.exit(1);}
});
