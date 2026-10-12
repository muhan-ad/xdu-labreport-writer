'use strict';
const electron=require('electron'),{app,BrowserWindow,session}=electron;
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root='E:/apps/xdu-labreport-writer-master',work='E:/workspace/codex/2026-10-09/jian/work';
const moduleRoot=process.env.LABREPORT_TEST_APP_ASAR || root;
const {createSchoolPortal,PARTITION}=require(path.join(moduleRoot,'src/main/school-portal'));
const {SYSTEMS}=require(path.join(moduleRoot,'src/main/school-systems'));
const {createSchoolCredentials}=require(path.join(moduleRoot,'src/main/school-credentials'));
const profile=fs.mkdtempSync(path.join(work,'school-systems-profile-')),log=path.join(work,'school-systems-smoke.log');
fs.writeFileSync(log,'START controlled fixtures only; no real school credentials or network login\n');const record=s=>fs.appendFileSync(log,s+'\n');
app.setPath('userData',profile);app.on('browser-window-created',(_,win)=>win.hide());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let n=0;n<150;n++){if(await check())return;await delay(100)}throw Error('Timed out waiting for fixture');}
function html(body){return `<!doctype html><html><body><h1>隔离验证登录页</h1>${body}<script>window.submitCount=0;document.querySelectorAll('form').forEach(f=>f.onsubmit=e=>{e.preventDefault();window.submitCount++})</script></body></html>`;}
app.whenReady().then(async()=>{try{
 const ses=session.fromPartition(PARTITION);
 const respond=req=>{
  const url=new URL(req.url);let body;
  if(url.hostname==='wlsyinfo.xidian.edu.cn'&&url.pathname==='/Login/RemoteUserLogin')return new Response(null,{status:302,headers:{location:'https://wlsyinfo.xidian.edu.cn/ReportStudent/SStartPage/'}});
  if(url.hostname==='wlsyinfo.xidian.edu.cn')return new Response(html('<h2 id="simulationReady">仿真实验栏目</h2><input id="simAccount"><input id="simPassword" type="password">'),{headers:{'content-type':'text/html;charset=utf-8'}});
  if(url.pathname==='/PhyEws/default.aspx')body='<iframe title="选课登录" src="/PhyEws/login-fixture" style="width:600px;height:280px"></iframe>';
  else if(url.pathname.startsWith('/PhyEws/'))body='<form><input type="hidden" id="__VIEWSTATE" value="UNCHANGED"><label>学号<input name="login1$StuLoginID" id="login1_StuLoginID"></label><label>密码<input type="password" id="login1_StuPassword"></label><button>登录</button></form>';
  else if(url.hostname==='wlsytest.xidian.edu.cn')body='<h2 id="previewReady">预习系统栏目</h2><link rel="stylesheet" href="/Content/fixture.css"><input id="previewAccount"><input id="previewPassword" type="password">';
  else if(url.hostname==='wlxnfzsy.xidian.edu.cn')body='<input id="uname" name="textfield" placeholder="请输入用户名"><input id="pwd" type="password"><input id="checkcode" value="LEAVE_ME" placeholder="验证码"><input id="cbSaveInfo" type="checkbox"><button onclick="window.submitCount++">登录</button><button id="preview" onclick="document.getElementById(\'previewFrame\').src=\'https://wlsytest.xidian.edu.cn/Student/SNotice/\'">预习系统</button><iframe id="previewFrame" style="width:600px;height:200px"></iframe>';
  else body='<label>用户名称<input id="O17_id-inputEl" name="O17"></label><label>用户密码<input id="O1B_id-inputEl" name="O1B" type="password"></label><button onclick="window.submitCount++">学生登录</button>';
  return new Response(html(body),{headers:{'content-type':'text/html;charset=utf-8'}});
 };
 ses.protocol.handle('http',respond);ses.protocol.handle('https',respond);
 const parent=new BrowserWindow({show:false}),vault=createSchoolCredentials(path.join(profile,'vault'),electron.safeStorage);
 const external=[];
 const portal=createSchoolPortal({electron:{...electron,shell:{openExternal:async url=>external.push(url)}},root:moduleRoot,getParent:()=>parent,credentials:vault});assert.equal((await portal.open()).ok,true);
 const win=BrowserWindow.getAllWindows().find(w=>w!==parent),toolbar=win.webContents;
 const remote=win.contentView.children.find(v=>v.webContents).webContents;toolbar.setBackgroundThrottling(false);remote.setBackgroundThrottling(false);
 const t=code=>toolbar.executeJavaScript(code,true);
 await until(()=>t('typeof window.schoolPortal !== "undefined" && document.getElementById("systemSelect").options.length===4'));
 for(const system of SYSTEMS){
  if(['simulation','exam'].includes(system.id)) {
   const previousUrl=remote.getURL();
   const priorCount=external.length;
   await t(`document.getElementById('systemSelect').value=${JSON.stringify(system.id)};document.getElementById('systemSelect').dispatchEvent(new Event('change'))`);
   await until(()=>external.length===priorCount+1);
   await until(()=>t(`document.getElementById('status').textContent.includes('默认浏览器') && document.getElementById('systemSelect').value!==${JSON.stringify(system.id)}`));
   assert.equal(external.at(-1),system.url);assert.equal(remote.getURL(),previousUrl);
   record('PASS '+system.id+' opens fixed URL in default browser; current embedded page and dropdown preserved');continue;
  }
  await t(`document.getElementById('systemSelect').value=${JSON.stringify(system.id)};document.getElementById('systemSelect').dispatchEvent(new Event('change'))`);
  await until(()=>remote.getURL()===system.url && !remote.isLoading());
  await until(()=>t(`document.getElementById('systemSelect').value===${JSON.stringify(system.id)} && !document.getElementById('manageCredentials').disabled`));
  assert.equal((await t("window.schoolPortal.action('credential-status')")).configured,false);
  const u='TEST_'+system.id,p='TEST_SECRET_'+system.id;
  await t("document.getElementById('manageCredentials').click()");await until(()=>t("document.getElementById('credentialsDialog').open"));
  await t(`document.getElementById('credentialAccount').value=${JSON.stringify(u)};document.getElementById('credentialPassword').value=${JSON.stringify(p)};document.getElementById('credentialForm').requestSubmit()`);
  await until(()=>t("document.getElementById('credentialMessage').textContent.includes('已加密保存') && !document.getElementById('closeCredentials').disabled"));
  await t("document.getElementById('closeCredentials').click()");await until(()=>t("!document.getElementById('credentialsDialog').open && !document.getElementById('autofill').disabled"));
  await t("document.getElementById('autofill').click()");await until(()=>t("document.getElementById('status').textContent.includes('已填充登录框')"));
  let matched=0;
  for(const frame of remote.mainFrame.framesInSubtree){
   const state=await frame.executeJavaScript(`({values:[...document.querySelectorAll('input')].filter(i=>!['hidden','checkbox'].includes(i.type)).map(i=>i.value),submitted:window.submitCount||0,viewstate:document.getElementById('__VIEWSTATE')?.value,remember:document.getElementById('cbSaveInfo')?.checked})`);
   if(state.values.includes(u)){matched++;assert.ok(state.values.includes(p));assert.equal(state.submitted,0);if(system.id==='simulation'){assert.ok(state.values.includes('LEAVE_ME'));assert.equal(state.remember,false)}if(system.id==='course')assert.equal(state.viewstate,'UNCHANGED');}
  }
  assert.equal(matched,1);assert.equal((await t("window.schoolPortal.action('autofill')")).ok,true,'Repeated fill '+system.id);
  record('PASS '+system.id+' dropdown, isolated credentials, login form, no submit, repeat fill');
  if(system.id==='simulation'){
   await remote.executeJavaScript("document.getElementById('preview').click()");
   await until(()=>remote.mainFrame.framesInSubtree.some(f=>f.url==='https://wlsytest.xidian.edu.cn/Student/SNotice/'));
   const preview=remote.mainFrame.framesInSubtree.find(f=>f.url==='https://wlsytest.xidian.edu.cn/Student/SNotice/');
   await until(()=>preview.executeJavaScript("!!document.getElementById('previewReady')"));
   assert.deepEqual(await preview.executeJavaScript("[document.getElementById('previewAccount').value,document.getElementById('previewPassword').value]"),['','']);
   assert.equal((await t("window.schoolPortal.action('autofill')")).ok,true);
   assert.deepEqual(await preview.executeJavaScript("[document.getElementById('previewAccount').value,document.getElementById('previewPassword').value]"),['','']);
   record('PASS virtual preview cross-origin iframe loads; saved simulation credentials never enter preview site');
   await remote.executeJavaScript("document.getElementById('previewFrame').src='https://wlsyinfo.xidian.edu.cn/Login/RemoteUserLogin'");
   await until(()=>remote.mainFrame.framesInSubtree.some(f=>f.url==='https://wlsyinfo.xidian.edu.cn/ReportStudent/SStartPage/'));
   const sim=remote.mainFrame.framesInSubtree.find(f=>f.url==='https://wlsyinfo.xidian.edu.cn/ReportStudent/SStartPage/');
   await until(()=>sim.executeJavaScript("!!document.getElementById('simulationReady')"));
   assert.equal((await t("window.schoolPortal.action('autofill')")).ok,true);
   assert.deepEqual(await sim.executeJavaScript("[document.getElementById('simAccount').value,document.getElementById('simPassword').value]"),['','']);
   record('PASS simulation remote login redirect and cross-origin iframe loads; no saved credential injection');
  }
 }
 const contents=fs.readFileSync(path.join(profile,'vault/credentials.json'),'utf8');assert.doesNotMatch(contents,/TEST_SECRET|username|password/);
 await t("window.schoolPortal.action('switch-system',{systemId:'report'})");await until(()=>remote.getURL()===SYSTEMS[0].url&&!remote.isLoading());
 assert.equal((await t("window.schoolPortal.action('autofill')")).ok,true);
 const roundtrip=createSchoolCredentials(path.join(profile,'vault'),electron.safeStorage);assert.equal((await roundtrip.get('course')).username,'TEST_course');
 win.setSize(820,650);await delay(100);
 const layout=await t(`({width:innerWidth,last:document.getElementById('clearLogin').getBoundingClientRect().right,options:[...document.getElementById('systemSelect').options].map(o=>o.textContent)})`);
 assert.ok(layout.last<=layout.width,'toolbar overflows at minimum width');assert.equal(layout.options.length,4);
 win.setSize(1100,800);await delay(100);fs.writeFileSync(path.join(work,'school-systems-toolbar.png'),(await toolbar.capturePage({x:0,y:0,width:win.getContentSize()[0],height:100},{stayHidden:true,stayAwake:true})).toPNG());
 record('PASS isolated-world same-origin iframe + CAPTCHA unchanged + encrypted restart recovery + 820px toolbar');
 portal.close();parent.destroy();app.exit(0);
}catch(e){record(e.stack);app.exit(1)}});setTimeout(()=>{record('TIMEOUT');app.exit(2)},60000).unref();
