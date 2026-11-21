'use strict';
// Isolated local profile. The entire portal controller is mocked: no real upload.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const appRoot=process.env.LAB_UPLOAD_SMOKE_ASAR||root;
if(process.env.LAB_UPLOAD_SMOKE_ASAR){Object.defineProperty(app,'isPackaged',{get:()=>true});Object.defineProperty(process,'resourcesPath',{value:path.join(root,'dist/win-unpacked/resources')});}
const output=process.env.LAB_UPLOAD_SMOKE_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'upload-ui-'));
fs.mkdirSync(output,{recursive:true});
const profile=path.join(output,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const id='直螺线管磁场分布的测量',reports=path.join(output,'reports'),dir=path.join(reports,id),file=path.join(dir,'report.docx');
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,'mock report used only by the mocked controller');
fs.writeFileSync(path.join(profile,'report-locations.json'),JSON.stringify({[id]:{root:reports,path:file}}));
let release,calls=[];
const controller=require(path.join(appRoot,'src/main/course-selection'));
controller.createCourseSelection=()=>({warm:async()=>({ok:true,skipped:true}),discardPreload(){},shutdown(){},open:async()=>({ok:true}),uploadReport:async p=>{calls.push(p);await new Promise(r=>release=r);return {ok:true,submitted:true,message:'模拟上传完成，未调用官网'};}});
const errors=[];app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
app.on('browser-window-created',(_,w)=>w.hide());require(path.join(appRoot,'main.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let n=0;n<150;n++){if(await check())return;await delay(100);}throw Error('UI timeout');}
app.whenReady().then(async()=>{
 try{
  await until(()=>BrowserWindow.getAllWindows().length);
  const win=BrowserWindow.getAllWindows()[0],c=win.webContents,run=s=>c.executeJavaScript(s);
  await until(()=>run('typeof experiments!=="undefined"&&experiments.length===28').catch(()=>false));
  await run(`document.querySelectorAll('.modal-overlay').forEach(n=>n.classList.remove('show'));selectExperiment(experiments.find(e=>e.id===${JSON.stringify(id)}||e.name===${JSON.stringify(id)}))`);
  await until(()=>run('!!currentExp?.reportFile'));
  assert.equal(await run("document.getElementById('btnUploadReport').textContent.trim()"),'上传报告');
  assert.equal(await run("document.getElementById('btnContribute').closest('#settingsModal')!==null"),true);
  for(const width of [1440,950]){
   win.setSize(width,950);await delay(100);
   fs.writeFileSync(path.join(output,'toolbar-'+width+'.png'),(await c.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  }
  await run("document.getElementById('btnSettings').click();document.getElementById('btnNavContribute').click()");
  assert.equal(await run("document.getElementById('btnNavDevelop').nextElementSibling.id"),'btnNavContribute');
  assert.equal(await run("document.getElementById('paneContribute').classList.contains('active')"),true);
  assert.ok((await run("document.getElementById('contributeSettingsExperiment').textContent")).includes(id));
  await delay(350);
  fs.writeFileSync(path.join(output,'contribution-settings.png'),(await c.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await run("document.getElementById('btnContribute').click()");
  assert.equal(await run("document.getElementById('contributeModal').classList.contains('show')"),true);
  await run("closeModal('contributeModal');closeModal('settingsModal');document.getElementById('btnUploadReport').click()");
  await until(()=>calls.length===1);
  await run("document.getElementById('btnUploadReport').click()");assert.equal(calls.length,1);
  assert.equal(await run("document.getElementById('btnUploadReport').disabled"),true);
  assert.deepEqual(calls[0],{experiment:id,file});release();
  await until(()=>run("!document.getElementById('btnUploadReport').disabled"));
  assert.equal(await run("(async()=>{const r=await window.labAPI.uploadExperimentReport('C:/invalid/outside-experiment');return r.ok})()"),false);
  assert.ok(!errors.some(s=>/Uncaught|SyntaxError|ReferenceError/.test(s)),errors.join('\n'));
  fs.writeFileSync(path.join(output,'result.txt'),'PASS: isolated toolbar, settings placement, existing contribution modal, canonical report binding, repeat click prevention, invalid path rejection; no school requests.');
  app.exit(0);
 }catch(error){fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));app.exit(1);}
});
setTimeout(()=>app.exit(2),60000).unref();
