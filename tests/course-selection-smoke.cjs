'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_COURSE_SMOKE_WORK;
app.disableHardwareAcceleration();
if(!work)throw Error('Set LAB_COURSE_SMOKE_WORK to an isolated test directory');
fs.mkdirSync(work,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(work,'course-profile-')));
app.on('browser-window-created',(_event,win)=>win.hide());
const timer=setTimeout(()=>{fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:'timeout'}));app.exit(1);},30000);
app.whenReady().then(async()=>{
 let controller;
 try{
  controller=require('../src/main/course-selection').createCourseSelection({electron:require('electron'),root,getParent:()=>null,resolvePython:()=>path.join(root,'python-runtime','python.exe'),userData:app.getPath('userData'),spawnProcess:(...args)=>{const child=require('node:child_process').spawn(...args);child.stderr.on('data',data=>fs.appendFileSync(path.join(work,'startup.stderr.log'),data));return child;}});
  const result=await controller.open();assert.equal(result.ok,true,result.error);
  const win=BrowserWindow.getAllWindows()[0];win.hide();
  const state=await win.webContents.executeJavaScript(`({search:document.getElementById('openSearch').textContent,academic:document.getElementById('academicStatus').textContent,bridge:typeof window.labAPI,login:document.getElementById('accountButton').textContent})`);
  assert.equal(state.search,'搜索实验');assert.equal(state.bridge,'undefined');assert.equal(state.login,'登录选课网站');
  let screenshotError=null;
  try{fs.writeFileSync(path.join(work,'course-app.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}
  catch(error){screenshotError=error.message;}
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,state,screenshotError},null,2));
  controller.shutdown();clearTimeout(timer);app.exit(0);
 }catch(error){if(controller)controller.shutdown();fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.message}));clearTimeout(timer);app.exit(1);}
});
