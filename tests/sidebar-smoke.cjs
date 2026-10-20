'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const work=process.env.LABREPORT_SMOKE_WORK,root=process.env.LABREPORT_TEST_APP_ASAR;
const profile=fs.mkdtempSync(path.join(work,'sidebar-profile-'));app.setPath('userData',profile);
const log=path.join(work,'sidebar-desktop.log');fs.writeFileSync(log,'START isolated sidebar test\n');
const record=s=>fs.appendFileSync(log,s+'\n');app.on('browser-window-created',(_,win)=>win.hide());
const watchdog=setTimeout(()=>{record('FAIL timeout');app.exit(1)},60000);
require(path.join(root,'main.js'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 let wc;
 for(let i=0;i<250;i++){
  wc=BrowserWindow.getAllWindows()[0]?.webContents;
  if(wc&&await wc.executeJavaScript('typeof experiments!=="undefined"&&experiments.length===28&&!!document.getElementById("btnToggleSidebar")').catch(()=>false))break;
  await delay(100);
 }
 const ev=code=>wc.executeJavaScript(code);
 await ev('selectExperiment(experiments.find(e=>e.id==="低电阻的测量"))');
 await ev('window.__sidebarTestInput=document.querySelector("#dataTableWrap input");__sidebarTestInput.value="123.456";__sidebarTestInput.dispatchEvent(new Event("input",{bubbles:true}));void 0');
 await delay(600);
 const initial=await ev('({width:document.querySelector(".main").getBoundingClientRect().width,id:currentExp.id})');
 fs.writeFileSync(path.join(work,'sidebar-expanded.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 await ev('document.getElementById("btnToggleSidebar").click()');
 await delay(70);
 const during=await ev('document.querySelector(".main").getBoundingClientRect().width');
 assert.ok(during>initial.width && during<initial.width+260,'sidebar must animate through an intermediate width');
 await delay(250);
 assert.ok(await ev('document.getElementById("experimentSidebar").getBoundingClientRect().right')<=1);
 assert.equal(await ev('getComputedStyle(document.getElementById("experimentSidebar")).visibility'),'hidden');
 assert.equal(await ev('document.getElementById("experimentSidebar").inert'),true);
 assert.ok(await ev('document.querySelector(".main").getBoundingClientRect().width')>initial.width+200);
 assert.equal(await ev('document.querySelector("#dataTableWrap input")===__sidebarTestInput'),true);
 assert.equal(await ev('__sidebarTestInput.value'),'123.456');assert.equal(await ev('isDataModified'),true);
 assert.equal(await ev('currentExp.id'),initial.id);
 fs.writeFileSync(path.join(work,'sidebar-collapsed.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 await ev('document.getElementById("btnToggleSidebar").focus()');
 assert.equal(await ev('document.activeElement.id'),'btnToggleSidebar');
 assert.equal(await ev('document.activeElement.tagName'),'BUTTON');
 await ev('document.getElementById("btnToggleSidebar").click()');
 assert.equal(await ev('document.getElementById("btnToggleSidebar").getAttribute("aria-expanded")'),'true');
 await ev('document.getElementById("btnToggleSidebar").click();isDataModified=false;notifyDataModified();void 0');
 wc.reload();await delay(800);
 for(let i=0;i<100;i++){
  if(await ev('!!document.getElementById("btnToggleSidebar")&&typeof experiments!=="undefined"&&experiments.length===28').catch(()=>false))break;
  await delay(100);
 }
 assert.equal(await ev('document.getElementById("btnToggleSidebar").getAttribute("aria-expanded")'),'false');
 await ev('document.getElementById("btnToggleSidebar").click()');await delay(300);
 await ev('document.getElementById("btnSettings").click()');
 assert.equal(await ev('document.getElementById("settingsModal").classList.contains("show")'),true);
 assert.equal(await ev('document.querySelector(".brand-title").textContent'),'实验搭子');
 assert.equal(await ev('document.querySelectorAll(".titlebar-logo,.titlebar-name,.brand-sub").length'),0);
 await ev('closeModal("settingsModal");void 0');
 let outerScrollCount=0;
 for(const id of await ev('experiments.map(e=>e.id)')){
  await ev(`selectExperiment(experiments.find(e=>e.id===${JSON.stringify(id)}))`);
  const layout=await ev(`(()=>{const wrap=document.getElementById('dataTableWrap'),outer=document.querySelector('.content');return {height:wrap.clientHeight,scrollHeight:wrap.scrollHeight,max:getComputedStyle(wrap).maxHeight,overflow:getComputedStyle(wrap).overflowY,outerScroll:outer.scrollHeight>outer.clientHeight}})()`);
  assert.equal(layout.max,'none',id);assert.equal(layout.overflow,'visible',id);
  assert.ok(layout.scrollHeight<=layout.height+2,id+' must not scroll vertically inside the form');
  if(layout.outerScroll)outerScrollCount++;
 }
 assert.ok(outerScrollCount>0,'long experiments must scroll in the outer content');
 await ev('selectExperiment(experiments.find(e=>e.id==="刚体转动惯量的测量"))');await delay(500);
 assert.equal(await ev('getComputedStyle(document.querySelector(".matrix-scroll")).overflowX'),'auto');
 fs.writeFileSync(path.join(work,'single-scroll.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 await ev('document.getElementById("btnSettings").click();loadDevelopPane();void 0');
 assert.equal(await ev('getComputedStyle(document.getElementById("btnFillAllTestData")).display'),'none');
 await ev('setDevMode(true);loadDevelopPane();void 0');
 assert.notEqual(await ev('getComputedStyle(document.getElementById("btnFillAllTestData")).display'),'none');
 await ev('void (appConfirm=async()=>false);fillAllTestData()');
 assert.equal(await ev('document.getElementById("allTestDataStatus").textContent'),'');
 await ev('void (appConfirm=async()=>true);fillAllTestData()');
 assert.match(await ev('document.getElementById("allTestDataStatus").textContent'),/已填入并保存 28 个实验/);
 assert.equal(await ev('isDataModified'),false);
 for(const exp of await ev('experiments.map(e=>({id:e.id,path:e.path}))')){
   const expected=JSON.parse(fs.readFileSync(path.join(exp.path,'test-data.json'),'utf8'));
   const actual=JSON.parse(fs.readFileSync(path.join(exp.path,'data.json'),'utf8'));
   const schema=JSON.parse(fs.readFileSync(path.join(exp.path,'schema.json'),'utf8'));
   for(const group of schema.groups)for(const field of group.fields)assert.deepEqual(actual[field.key],expected[field.key],exp.id+field.key);
 }
 record('PASS developer-only batch button, cancel changes nothing, all 28 experiments fill and persist with backups in isolated profile');
 record('PASS all 28 forms expand naturally; no inner vertical scrolling; outer page scroll retained; matrix horizontal scrolling retained');
 record('PASS animated collapse/expand; clean branding; wider editor; same form node, value and dirty state; native button keyboard focus; reload restores state; settings remains usable');
 clearTimeout(watchdog);app.exit(0);
}catch(e){record('FAIL '+e.stack);app.exit(1)}});
