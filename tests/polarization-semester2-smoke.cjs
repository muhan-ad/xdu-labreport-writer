'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const work='E:/workspace/codex/2026-10-09/jian/work';
const profile=fs.mkdtempSync(path.join(work,'polarization-profile-'));
const logfile=path.join(work,'polarization-desktop.log');
fs.writeFileSync(logfile,'START isolated Electron profile\n');
const record=s=>fs.appendFileSync(logfile,s+'\n');
setTimeout(()=>{record('FAIL overall fixture timeout');app.exit(1)},90000);
app.setPath('userData',profile);
app.on('browser-window-created',(_,w)=>w.hide());
require(path.join(process.env.LABREPORT_TEST_APP_ASAR,'main.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 let wc;
 for(let i=0;i<180;i++){
  wc=BrowserWindow.getAllWindows()[0]?.webContents;
  if(wc&&await wc.executeJavaScript('typeof experiments!=="undefined"&&experiments.length===28').catch(()=>false))break;
  await delay(200);
 }
 const ev=s=>wc.executeJavaScript(s);
 wc.setBackgroundThrottling(false);
 assert.equal(await ev('experiments.length'),28);
 await ev('appConfirm=async()=>true;void 0');
 const name='光的偏振特性测量（第二学期）';
 await ev(`selectExperiment(experiments.find(e=>e.id===${JSON.stringify(name)}))`);
 assert.equal(await ev('document.querySelectorAll(".matrix-input input[data-key=power_mw]").length'),75);
 assert.equal(await ev('currentData.power_mw.length'),25);
 assert.equal(await ev('currentData.power_mw.flat().filter(v=>v!==null).length'),0);
 assert.equal(await ev('chartMode'), 'preset');
 assert.equal(await ev('chartConfig.chartType'),'polar');
 await ev('openChartPresetModal()');
 assert.deepEqual(await ev('({x:$("chartXField").value,y:$("chartYField").value,type:$("chartType").value})'),
  {x:'theta_deg',y:'power_mw',type:'polar'});
 await ev('closeModal("chartPresetModal");fillTestData()');
 const before=await ev('window.labAPI.readData(currentExp.path)');
 assert.equal(await ev('dataValidation.validate(currentSchema,currentData).length'),0);
 assert.deepEqual(await ev('window.labAPI.readData(currentExp.path)'),before,'test data stays unsaved');
 const saved=await ev('window.labAPI.writeData(currentExp.path,currentData)');assert.equal(saved.ok,true,saved.error);
 await ev('isDataModified=false;notifyDataModified();generateChartPreview()');
 assert.equal(await ev('typeof chartPreviewUrl === "string" && chartPreviewUrl.startsWith("data:image/png;base64,")'),true,
  await ev('document.querySelector("#toastContainer").innerText'));
 const png=await ev('chartPreviewUrl');fs.writeFileSync(path.join(work,'polarization-desktop-chart.png'),Buffer.from(png.split(',')[1],'base64'));
 const result=await ev('window.labAPI.runGenerate(currentExp.path,{name:"隔离测试",id:"TEST",class:"测试",date:"2026-10-14"},{},{},false)');
 assert.equal(result.ok,true,result.error||JSON.stringify(result));
 fs.copyFileSync(result.reportFile,path.join(work,'polarization-second-semester-test.docx'));
 await ev('selectExperiment(experiments.find(e=>e.id==="光的偏振特性测量"))');
 assert.equal(await ev('getDisplayName(currentExp)'),'光的偏振特性测量（第一学期）');
 assert.equal(await ev('currentSchema.groups[0].fields[0].key'),'cos2_values');
 await ev('selectExperiment(experiments.find(e=>e.id==="RLC电路的稳态特性研究实验"))');
 await ev('openChartPresetModal()');
 assert.equal(await ev('Array.from($("chartXField").options).filter(o=>o.value).length'),6);
 assert.equal(await ev('$("chartType").querySelector("option[value=polar]")'),null);
 record('PASS 28 entries, distinct semesters, blank 25x3 form, explicit unsaved test data, polar preview, real IPC report, RLC field regression');
 record('PROFILE '+profile);app.exit(0);
}catch(e){record('FAIL '+e.stack);app.exit(1)}});
