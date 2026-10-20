'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_COURSE_SMOKE_WORK;if(!work)throw Error('Isolated directory required');
fs.mkdirSync(work,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(work,'weekly-profile-')));app.on('browser-window-created',(_,win)=>win.hide());
app.whenReady().then(async()=>{
 let controller;const timer=setTimeout(()=>app.exit(1),20000);
 try{
  controller=require('../src/main/course-selection').createCourseSelection({electron:require('electron'),root,getParent:()=>null,resolvePython:()=>path.join(root,'python-runtime/python.exe'),userData:app.getPath('userData')});
  assert.equal((await controller.open()).ok,true);const win=BrowserWindow.getAllWindows()[0];win.hide();
  const snapshot={semester:'2026-2027-1',termStart:'2026-09-07',termEnd:'2026-09-27',fetchedAt:'2026-10-16T09:00:00+08:00',events:[{date:'2026-09-07',start:'08:30',end:'10:05',name:'TEST_COURSE',room:'A101'}],scheduledComplete:true,complete:false,unscheduled:[{name:'TEST_UNSCHEDULED'}],warnings:['存在未排课课程']};
  const downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_,item)=>{item.setSavePath(path.join(work,'weekly.csv'));item.once('done',(_,state)=>state==='completed'?resolve():reject(Error(state)));}));
  const state=await win.webContents.executeJavaScript(`(()=>{academicState={status:'partial',snapshot:${JSON.stringify(snapshot)}};busy=false;renderAcademicStatus();document.getElementById('openAcademicWeeks').click();document.getElementById('academicWeekSelect').value='1';renderAcademicWeek();exportAcademic(true);return {open:document.getElementById('academicWeeksDialog').open,weekCount:document.getElementById('academicWeekSelect').options.length,rows:document.getElementById('academicWeekRows').textContent,status:document.getElementById('academicStatus').textContent};})()`);
  assert.equal(state.open,true);assert.equal(state.weekCount,3);assert.match(state.rows,/TEST_COURSE/);assert.match(state.status,/已排课程已同步/);await downloaded;
  const csv=fs.readFileSync(path.join(work,'weekly.csv'),'utf8');assert.match(csv,/TEST_COURSE/);assert.match(csv,/TEST_UNSCHEDULED/);assert.match(csv,/本周无已排课程/);assert.match(csv,/读取时间/);
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,verified:['weekly dialog and week selector','partial synchronized status','actual CSV download through sandboxed Electron','unscheduled and empty weeks included','no school requests']}));controller.shutdown();clearTimeout(timer);app.exit(0);
 }catch(error){fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.stack}));controller?.shutdown();clearTimeout(timer);app.exit(1);}
});
