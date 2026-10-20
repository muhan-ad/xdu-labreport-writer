'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {getSystem}=require('./school-systems');

function externalAllowed(value){
  try{const u=new URL(value);return !u.username&&!u.password&&(!u.port||['80','443'].includes(u.port))&&
    ((u.hostname==='wlsy.xidian.edu.cn'&&u.protocol==='http:')||
     (['wlsyzx.xidian.edu.cn','ehall.xidian.edu.cn','ids.xidian.edu.cn'].includes(u.hostname)&&u.protocol==='https:'));}catch{return false;}
}
function createCourseSelection({electron,root,getParent,resolvePython,userData,getSavedLogin,schoolPortal,reportClient,log=()=>{},spawnProcess=spawn,stopTree=execFile}){
  const {app,BrowserWindow,session,shell}=electron;
  let win=null,child=null,starting=null,origin=null,closed=false,connecting=null;
  let warming=null,preloaded=false,warmEpoch=0,entryStarted=0;
  function preloadAllowed(){try{return !closed&&schoolPortal?.getAutoFillEnabled?.()===true&&JSON.parse(fs.readFileSync(path.join(userData,'course-onboarding.json'),'utf8')).acknowledged===true;}catch{return false;}}
  const startupURL=pathToFileURL(path.join(root,'src/course-selection/startup.html')).href;
  const trusted=event=>{const c=win?.webContents;return !!(win&&!win.isDestroyed()&&event.sender===c&&event.senderFrame===c.mainFrame&&(c.getURL()===startupURL||origin&&c.getURL()===origin+'/'));};
  electron.ipcMain?.handle('course-window',async(event,payload)=>{
    if(!trusted(event))return {ok:false,error:'拒绝不可信的窗口操作'};
    const current=win;
    if(payload?.action==='ready'){
      log('course entry ready ms='+String(Date.now()-entryStarted)+' background='+preloaded);
      if(preloadAllowed())void reportClient?.warm(current)?.catch(()=>{});
      return {ok:true};
    }
    if(payload?.action==='minimize')current.minimize();
    else if(payload?.action==='maximize'){current.isMaximized()?current.unmaximize():current.maximize();}
    else if(payload?.action==='close')current.close();
    else if(payload?.action==='retry')return connect(current);
    else return {ok:false,error:'无效的窗口操作'};
    return {ok:true};
  });
  electron.ipcMain?.handle('course-open-system',async(event,id)=>{
    if(!trusted(event)||!['exam','simulation'].includes(id))return {ok:false,error:'不支持的网站入口'};
    try{await shell.openExternal(getSystem(id).url);return {ok:true};}catch{return {ok:false,error:'浏览器未能打开，请重试'};}
  });
  let filling=false;
  async function fillSavedLogin(event,options){
    const current=win,contents=current?.webContents;
    const trusted=()=>!!(current&&!current.isDestroyed()&&win===current&&contents===event.sender&&event.senderFrame===contents.mainFrame&&origin&&contents.getURL()===origin+'/');
    if(!trusted())return {ok:false,message:'拒绝不可信的账号填充请求'};
    if(filling)return {ok:true,skipped:true};
    filling=true;
    try{
      const saved=await getSavedLogin?.();
      if(!trusted())return {ok:false,message:'页面已变化，请重新打开登录框'};
      if(!saved?.enabled)return {ok:true,message:'学校账号的自动填充已关闭，请手动填写。'};
      if(!saved.credentials)return {ok:true,message:'尚未保存学校账号，请手动填写，或在一站通的登录设置中保存。'};
      const value=saved.credentials;
      if(typeof value.username!=='string'||typeof value.password!=='string'||!value.username||!value.password||value.username.length>40||value.password.length>200)return {ok:false,message:'保存的账号格式不适用于选课系统，请手动填写。'};
      const filled=await contents.executeJavaScriptInIsolatedWorld(1003,[{code:courseAutofillScript(origin,value,options?.silent===true)}]);
      return {ok:true,filled:!!filled,message:filled?'已填入本机加密保存的账号密码，可修改后点击登录。':'保留已填写内容；如需更换账号，请手动修改。'};
    }catch{return {ok:false,message:'无法读取已保存的学校账号，请在一站通的登录设置中检查，或手动填写。'};}
    finally{filling=false;}
  }
  electron.ipcMain?.handle('course-fill-saved-login',fillSavedLogin);
  electron.ipcMain?.handle('course-report-view',async(event,payload)=>{
    const current=win,contents=current?.webContents;
    if(!current||current.isDestroyed()||event.sender!==contents||event.senderFrame!==contents.mainFrame||!origin||contents.getURL()!==origin+'/')return {ok:false,error:'拒绝不可信的报告提交请求'};
    if(!reportClient)return {ok:false,error:'报告提交组件不可用'};
    return reportClient.action(payload?.action,payload,current);
  });
  electron.ipcMain?.handle('course-school-accounts',async(event,payload)=>{
    const contents=win?.webContents;
    if(!win||win.isDestroyed()||event.sender!==contents||event.senderFrame!==contents.mainFrame||!origin||contents.getURL()!==origin+'/')return {ok:false,error:'拒绝不可信的账号管理请求'};
    const onboarding=path.join(userData,'course-onboarding.json');
    if(['filter-load','filter-save'].includes(payload?.action)){
      if(typeof payload.account!=='string'||! /^[A-Za-z0-9_-]{1,40}$/.test(payload.account))return {ok:false,error:'学校账号无法用于保存筛选配置'};
      try{
        const atomic=require('./atomic-store'),rules=require('../course-selection/course-filters');
        const file=path.join(userData,'course-filters.json'),key=require('node:crypto').createHash('sha256').update(payload.account).digest('hex');
        const entries=atomic.readJson(file,{});
        if(payload.action==='filter-load')return {ok:true,filters:entries[key]?.filters||null};
        const filters=rules.normalize(payload.filters);entries[key]={filters,updated:Date.now()};
        const bounded=Object.fromEntries(Object.entries(entries).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0)).slice(0,100));
        atomic.writeFile(file,JSON.stringify(bounded),'utf8');return {ok:true,filters};
      }catch{return {ok:false,error:'筛选配置未能读取或保存，请重试'};}
    }
    if(payload?.action==='entry-status'){
      try{return {ok:true,acknowledged:JSON.parse(fs.readFileSync(onboarding,'utf8')).acknowledged===true};}catch{return {ok:true,acknowledged:false};}
    }
    if(payload?.action==='complete-entry'){
      require('./atomic-store').writeFile(onboarding,JSON.stringify({acknowledged:true}),'utf8');
      return {ok:true};
    }
    if(payload?.action==='clear-sessions'){
      const result=await reportClient?.action('clear-login',{pause:true},win);
      if(result&&result.ok!==true)return result;
      warmEpoch++;
      const school=await schoolPortal?.accountSettings('clear-sessions');
      if(school&&school.ok!==true)return school;
      require('./atomic-store').writeFile(onboarding,JSON.stringify({acknowledged:false}),'utf8');
      return {ok:true};
    }
    if(!schoolPortal?.accountSettings)return {ok:false,error:'账号管理组件不可用'};
    const result=await schoolPortal.accountSettings(payload?.action,payload);
    if(result.ok&&['save','delete'].includes(payload?.action))reportClient?.credentialsChanged();
    return result;
  });
  const source=app.isPackaged?path.join(process.resourcesPath,'course-selection'):path.join(root,'src','course-selection');
  function stop(){
    const processToStop=child;child=null;origin=null;
    if(processToStop&&processToStop.exitCode===null){
      if(process.platform==='win32'&&Number.isInteger(processToStop.pid)&&processToStop.pid>0)stopTree('taskkill',['/PID',String(processToStop.pid),'/T','/F'],{windowsHide:true},()=>{});
      else processToStop.kill();
    }
  }
  async function start(){
    if(origin&&child?.exitCode===null)return origin;
    if(starting)return starting;
    starting=new Promise((resolve,reject)=>{
      const python=resolvePython();
      if(!python||!fs.existsSync(path.join(source,'server.py'))){reject(Error('选课组件或 Python 运行时缺失'));return;}
      const env={...process.env,LAB_COURSE_DATA_DIR:path.join(userData,'course-selection','academic'),
        LAB_COURSE_ELECTRON:process.execPath,LAB_COURSE_READER_MODE:'1',
        LAB_COURSE_BROWSER_READER:path.join(source,'timetable_reader.js')};
      delete env.ELECTRON_RUN_AS_NODE;
      let proc;
      try{proc=spawnProcess(python,['-B','-X','utf8',path.join(source,'server.py'),'--port','0'],{cwd:source,env,windowsHide:true,stdio:['ignore','pipe','pipe']});}
      catch{reject(Error('选课服务未能启动'));return;}
      child=proc;let buffer='',settled=false;
      const finish=(error,url)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){stop();reject(error);}else{origin=url;resolve(url);}};
      const timer=setTimeout(()=>finish(Error('选课服务启动超时')),15000);
      proc.stdout.on('data',chunk=>{
        buffer=(buffer+String(chunk)).slice(-4096);const match=buffer.match(/Course UI: (http:\/\/127\.0\.0\.1:(\d{1,5}))\//);
        if(match&&+match[2]>0&&+match[2]<=65535)finish(null,match[1]);
      });
      // Do not persist child output: upstream errors can contain login/session information.
      proc.stderr.on('data',()=>{});
      proc.once('error',()=>finish(Error('选课服务未能启动，请检查 Python 运行时')));
      proc.once('exit',()=>{if(child===proc){child=null;origin=null;}finish(Error('选课服务已退出，请重新打开；需包含 requests 与 beautifulsoup4 依赖'));});
    });
    try{return await starting;}finally{starting=null;}
  }
  async function connect(current){
    if(connecting){await connecting;if(current.isDestroyed()||win!==current)return {ok:false,error:'窗口已关闭'};if(current.webContents.getURL()!==startupURL)return {ok:true};}
    connecting=(async()=>{try{
      const url=await start();if(closed||current.isDestroyed()||win!==current)return {ok:false,error:'窗口已关闭'};
      await current.loadURL(url+'/');return {ok:true};
    }catch(error){
      if(!current.isDestroyed()){
        if(current.webContents.getURL()!==startupURL)await current.loadURL(startupURL).catch(()=>{});
        current.webContents.send?.('course-startup-error',{message:error.message});
      }
      return {ok:false,error:error.message};
    }})();
    try{return await connecting;}finally{connecting=null;}
  }
  async function openWindow(background=false){
      if(closed)return {ok:false,error:'应用正在退出'};
      if(win&&!win.isDestroyed()){if(!background){const stale=preloaded&&Date.now()-entryStarted>60000;preloaded=false;win.show();win.focus();if(stale){win.webContents.send?.('course-resume');void reportClient?.action('refresh')?.catch(()=>{});}}return connecting||{ok:true};}
      try{
        preloaded=background;entryStarted=Date.now();
        const ses=session.fromPartition('course-selection');
        ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
        const current=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,parent:getParent()||undefined,
          title:'一站通 · 实验搭子',frame:false,titleBarStyle:'hidden',autoHideMenuBar:true,show:false,
          webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,preload:path.join(root,'src/course-selection/preload.cjs')}});
        win=current;
        current.webContents.setWindowOpenHandler(({url:target})=>{if(externalAllowed(target))shell.openExternal(target).catch(()=>{});return {action:'deny'};});
        const guard=(event,target)=>{if(target!==startupURL&&target!==origin+'/')event.preventDefault();};
        current.webContents.on('will-navigate',guard);current.webContents.on('will-redirect',guard);
        current.on('closed',()=>{reportClient?.close();if(win===current)win=null;});
        await current.loadURL(startupURL);if(!current.isDestroyed()&&!preloaded)current.show();return await connect(current);
      }catch(error){if(win&&!win.isDestroyed())win.destroy();win=null;return {ok:false,error:error.message};}
  }
  return {
    open:()=>openWindow(false),
    async warm(){
      if(warming)return warming;
      if(win&&!win.isDestroyed()||!preloadAllowed())return {ok:true,skipped:true};
      const revision=warmEpoch;
      const job=(async()=>{try{const saved=await getSavedLogin?.();if(revision!==warmEpoch||!preloadAllowed()||!saved?.enabled||!saved.credentials)return {ok:true,skipped:true};return await openWindow(true);}catch{log('course background preload unavailable');return {ok:false};}})();
      warming=job;try{return await job;}finally{if(warming===job)warming=null;}
    },
    discardPreload(){warmEpoch++;if(preloaded&&win&&!win.isDestroyed())win.destroy();},
    shutdown(){closed=true;warmEpoch++;if(win&&!win.isDestroyed())win.destroy();win=null;stop();},
  };
}
function courseAutofillScript(origin,value,silent=false){
  return `(()=>{if(location.origin!==${JSON.stringify(origin)}||location.pathname!=='/')return false;const dialog=document.getElementById('loginDialog'),a=document.getElementById('account'),p=document.getElementById('password');const value=${JSON.stringify(value)};if((!dialog?.open&&!${JSON.stringify(silent)})||!a||!p||p.type!=='password'||p.value||(a.value&&a.value!==value.username))return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(a,value.username);set.call(p,value.password);a.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`;
}
module.exports={createCourseSelection,externalAllowed,courseAutofillScript};
