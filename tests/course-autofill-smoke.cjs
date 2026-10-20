'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_COURSE_SMOKE_WORK;if(!work)throw Error('Isolated work directory required');
fs.mkdirSync(work,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(work,'autofill-profile-')));
app.on('browser-window-created',(_,win)=>win.hide());
app.whenReady().then(async()=>{
 let controller;let enabled=false;
 const timer=setTimeout(()=>app.exit(1),20000);
 try{
  controller=require('../src/main/course-selection').createCourseSelection({electron:require('electron'),root,getParent:()=>null,resolvePython:()=>path.join(root,'python-runtime/python.exe'),userData:app.getPath('userData'),getSavedLogin:async()=>({enabled,credentials:{username:'TEST_ACCOUNT',password:'TEST_PASSWORD'}})});
  assert.equal((await controller.open()).ok,true);const win=BrowserWindow.getAllWindows()[0];win.hide();
  const call=code=>win.webContents.executeJavaScript(code);
  await call(`new Promise(resolve=>{const check=()=>busy||autoLoggingIn||!csrf?setTimeout(check,20):resolve();check();})`);enabled=true;
  const first=await call(`(async()=>{document.getElementById('loginDialog').showModal();const r=await window.courseLogin.fillSaved();return {filled:r.filled,account:document.getElementById('account').value,password:document.getElementById('password').value,keys:Object.keys(r),labAPI:typeof window.labAPI};})()`);
  assert.equal(first.filled,true);assert.equal(first.account,'TEST_ACCOUNT');assert.equal(first.password,'TEST_PASSWORD');assert.equal(first.labAPI,'undefined');assert.ok(!first.keys.includes('password'));
  const again=await call(`(async()=>{document.getElementById('password').value='';return (await window.courseLogin.fillSaved()).filled;})()`);assert.equal(again,true);
  const manual=await call(`(async()=>{document.getElementById('account').value='MANUAL_ACCOUNT';document.getElementById('password').value='MANUAL_PASSWORD';await window.courseLogin.fillSaved();return document.getElementById('password').value;})()`);assert.equal(manual,'MANUAL_PASSWORD');
  enabled=false;await call(`document.getElementById('account').value='';document.getElementById('password').value='';void 0;`);
  const off=await call(`(async()=>{await window.courseLogin.fillSaved();return document.getElementById('password').value;})()`);assert.equal(off,'');
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,verified:['actual isolated preload IPC and DOM fill','password refill with matching saved account','manual fields retained','disabled setting respected','manual fill checks made with automatic login disabled; no school request','no main application API exposed']},null,2));
  controller.shutdown();clearTimeout(timer);app.exit(0);
 }catch(error){fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.stack}));controller?.shutdown();clearTimeout(timer);app.exit(1);}
});
