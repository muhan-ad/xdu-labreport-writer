'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {allowedUrl,allowedRequest}=require('./school-systems'),{autofillScript}=require('./school-autofill'),{adapterScript}=require('./report-adapter');
function reportPreviewAllowed(raw){try{const u=new globalThis.URL(raw);if(!allowedUrl(raw)||u.hostname!=='wlsy.xidian.edu.cn'||!/^\/uni-\d+(?:\.\d+){3}\/pdf\.js\/web\/viewer\.html$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>k!=='file'))return false;const f=new globalThis.URL(u.searchParams.get('file')||'',u);return allowedUrl(f.href)&&f.hostname==='wlsy.xidian.edu.cn'&&/^\/wgyreport\/wgyreport\.dll\/pdf\/[A-Za-z0-9-]+$/.test(f.pathname);}catch{return false;}}
const {numericScore,createReportStatusReader}=require('./report-status-reader');
const URL='http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu';
function createReportClient({electron,getParent,getCredentials,saveCredentials,isAutoLoginEnabled=()=>true,log=()=>{},statusReader=createReportStatusReader()}){
 const {BrowserWindow,session,dialog}=electron;let win=null,opening=null,phase='idle',message='',attempted=false,loginAt=0,generation=0,busy=false,selectedFile=null,rows=new Map(),imageCache=new Map(),reading=null,owner=null,uploadPending=false,uploadStarted=0,manualLogin=false;
 let dialogEpoch=0,lastDialogId=null,currentDialogId=null,dismissedDialog=null;
 let warming=null,pendingImages=0,startedAt=0,readyLogged=false,sessionPaused=false;
 const imageValues=new Map(),imageScores=new Map(),imageStatuses=new Map();let uploadRow=null;
 const popups=new Set(),owned=new Set();const valid=u=>{try{const x=new globalThis.URL(u);return allowedUrl(u)&&x.hostname==='wlsy.xidian.edu.cn'&&x.pathname.toLowerCase().startsWith('/wgyreport/');}catch{return false;}};
 const live=()=>win&&!win.isDestroyed();
 const execute=(command,payload)=>{if(!live()||!valid(win.webContents.getURL()))throw Error('报告连接已失效，请刷新重试');return win.webContents.executeJavaScript(adapterScript(command,payload),['row','button'].includes(command));};
 function guard(contents,preview=false){const navigation=u=>valid(u)||(preview&&reportPreviewAllowed(u));contents.on('will-frame-navigate',event=>{if(!navigation(event.url)&&!(event.url==='about:blank'&&!event.isMainFrame))event.preventDefault();});contents.on('will-redirect',event=>{if(!navigation(event.url))event.preventDefault();});contents.on('will-attach-webview',e=>e.preventDefault());contents.setWindowOpenHandler(({url})=>valid(url)||reportPreviewAllowed(url)||url==='about:blank'?{action:'allow',overrideBrowserWindowOptions:{show:true,parent:owner&&!owner.isDestroyed()?owner:getParent()||undefined,autoHideMenuBar:true,webPreferences:{session:contents.session,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}}}:{action:'deny'});contents.on('did-create-window',popup=>{const remote=popup.webContents;popups.add(popup);owned.add(remote);guard(remote,true);popup.show?.();popup.focus?.();log('report preview opened');popup.on('closed',()=>{popups.delete(popup);owned.delete(remote);});});}
 async function start(){
  if(live())return;if(opening)return opening;
  const revision=++generation;phase='connecting';message='正在连接报告提交系统';attempted=false;startedAt=Date.now();readyLogged=false;
  opening=(async()=>{const ses=session.fromPartition('report-client');ses.setPermissionRequestHandler((_c,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);ses.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!allowedRequest(d)}));ses.removeAllListeners('will-download');ses.on('will-download',(event,item,source)=>{if(!owned.has(source)||!valid(source.getURL())||!(valid(item.getURL())||item.getURL().startsWith('blob:'))){event.preventDefault();return;}item.setSaveDialogOptions({title:'保存实验报告'});});
   win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true,backgroundThrottling:false}});const current=win,contents=current.webContents;owned.add(contents);guard(contents);current.on('closed',()=>{owned.delete(contents);if(win===current){win=null;phase='idle';generation++;opening=null;}});current.webContents.on('did-fail-load',(_e,code,_desc,_u,main)=>{if(main&&code!==-3){phase='error';message='报告系统连接失败，请刷新重试';}});await current.loadURL(URL);if(generation===revision){phase='loading';log('report document loaded ms='+String(Date.now()-startedAt));}
  })().catch(()=>{if(generation===revision){phase='error';message='报告系统连接失败，请刷新重试';}}).finally(()=>{if(generation===revision)opening=null;});return opening;
 }
 async function image(src){
  if(!src)return '';let u;try{u=new globalThis.URL(src,URL);}catch{return '';}
  if(!valid(u.href)||!u.pathname.includes('/cache/')||!u.pathname.endsWith('.png')||u.search||u.hash)return '';
  if(imageCache.has(u.href))return imageCache.get(u.href);if(imageCache.size>=200){imageCache.clear();imageValues.clear();imageScores.clear();imageStatuses.clear();}
  const revision=generation;pendingImages++;
  const request=(async()=>{try{const r=await win.webContents.session.fetch(u.href,{signal:AbortSignal.timeout(8000)});if(!r.ok||!/^image\/(?:x-)?png\b/i.test(r.headers.get('content-type')||''))return '';const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>100000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return '';const value='data:image/png;base64,'+bytes.toString('base64');if(revision!==generation)return '';imageValues.set(u.href,value);const result=statusReader.read?await statusReader.read(bytes):{score:await statusReader.recognize(bytes)};if(revision===generation){imageScores.set(u.href,numericScore(result?.score));if(['已上传','未上传','已批改','未批改'].includes(result?.status))imageStatuses.set(u.href,result.status);}return value;}catch{return '';}
   finally{if(revision===generation){if(!imageScores.has(u.href))imageScores.set(u.href,null);pendingImages=Math.max(0,pendingImages-1);}}})();imageCache.set(u.href,request);return request;
 }
 async function read(){
  if(sessionPaused)return {ok:true,phase:'manual_login',message:'登录状态已清除，请登录',rows:[]};
  if(!live()){if(phase==='idle')void start();return {ok:true,phase,message,rows:[]};}if(opening)return {ok:true,phase:'connecting',message:'正在连接报告提交系统',rows:[]};
  const revision=generation,raw=await execute('state');
  const rawId=raw.dialog?.id||null;if(rawId!==lastDialogId){dialogEpoch++;lastDialogId=rawId;}
  currentDialogId=rawId?`${generation}:${dialogEpoch}:${rawId}`:null;
  if(raw.dialog){raw.dialog={...raw.dialog,id:currentDialogId};if(currentDialogId===dismissedDialog)raw.dialog=null;}
  if(raw.phase==='needs_login'&&!attempted){if(!manualLogin&&!isAutoLoginEnabled())return {ok:true,phase:'manual_login',message:'自动填充已关闭，请在登录设置中点击立即登录',rows:[]};const value=await getCredentials();if(!value)return {ok:true,phase:'needs_credentials',message:'请在登录设置中保存报告系统账号',rows:[],dialog:raw.dialog};
   const u=win.webContents.getURL(),fill=await win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:autofillScript(u,value,false,u,true)}]);
   if(fill?.filled){const result=await execute('login');if(result.ok){attempted=true;loginAt=Date.now();return {ok:true,phase:'logging_in',message:'正在自动登录报告系统',rows:[]};}}
  }
  const mapped=(raw.rows||[]).map(r=>{const key=crypto.createHash('sha256').update(r.fingerprint).digest('hex').slice(0,24);void image(r.gradeSrc);let gradeImage='',gradeText=r.gradeText,score=numericScore(r.gradeText),gradeChecking=false;try{const url=new globalThis.URL(r.gradeSrc,URL).href;gradeImage=imageValues.get(url)||'';gradeText=gradeText||imageStatuses.get(url)||'';if(score===null&&imageCache.has(url)){gradeChecking=!imageScores.has(url);score=imageScores.get(url)??null;}}catch{}const graded=score!==null;return {...r,key,gradeText,gradeImage,score,graded,gradeChecking,canUpload:graded?false:r.canUpload};});
  if(raw.phase==='ready'&&!readyLogged){readyLogged=true;log('report list ready ms='+String(Date.now()-startedAt)+' rows='+String(mapped.length));}
  if(revision!==generation)return {ok:true,phase:'idle',rows:[]};
  rows=new Map(mapped.map(r=>[r.key,{index:r.index,fingerprint:r.fingerprint}]));
  if(!raw.hasUpload&&(!raw.dialog||raw.dialog.type!=='upload'))selectedFile=null;
  if(uploadPending&&((raw.dialog&&raw.dialog.type==='message')||!raw.hasUpload&&raw.dialog?.type!=='upload'||Date.now()-uploadStarted>65000))uploadPending=false;
  return {ok:true,...raw,phase:raw.phase==='needs_login'&&attempted?(raw.dialog||Date.now()-loginAt>8000?'login_failed':'logging_in'):raw.phase,message:raw.phase==='needs_login'&&attempted?'自动登录未成功，请检查登录设置中的账号密码':raw.message||'',busy,uploadPending,imagesPending:pendingImages>0,rows:mapped.map(({key,week,time,name,gradeText,gradeImage,score,graded,gradeChecking,canPreview,canUpload})=>({key,week,time,name,gradeText,gradeImage,score,graded,gradeChecking,canPreview,canUpload})),selectedFile:selectedFile?path.basename(selectedFile):''};
 }
 async function state(){if(reading)return reading;reading=read().catch(()=>({ok:false,phase:'error',message:'报告数据读取失败，请刷新重试',rows:[]})).finally(()=>reading=null);return reading;}
 async function warm(parent){
  if(sessionPaused)return {ok:true,phase:'manual_login',rows:[]};
  if(parent)owner=parent;if(warming)return warming;
  const job=(async()=>{if(isAutoLoginEnabled())statusReader.warm?.();await start();const revision=generation,deadline=Date.now()+20000;
   while(live()&&revision===generation&&Date.now()<deadline){const result=await state();
    if(result.phase==='ready'&&!result.imagesPending||['manual_login','needs_credentials','login_failed','error'].includes(result.phase))return result;
    await new Promise(resolve=>setTimeout(resolve,250));
   }
  })();warming=job;try{return await job;}finally{if(warming===job)warming=null;}
 }
 async function checkUpload(row){
  const snapshot=await execute('state'),current=(snapshot.rows||[]).find(r=>r.index===row.index&&r.fingerprint===row.fingerprint);
  if(!current)return {ok:false,error:'报告列表已变化，请刷新后重试'};
  if(current.canUpload===false)return {ok:false,error:'学校系统不允许上传该报告'};
  let score=numericScore(current.gradeText);
  if(score===null&&current.gradeSrc){await image(current.gradeSrc);try{score=imageScores.get(new globalThis.URL(current.gradeSrc,URL).href)??null;}catch{}}
  return score!==null?{ok:false,error:'该实验已有明确成绩，无法上传报告'}:{ok:true};
 }
 async function action(name,payload={},parent){
  if(parent)owner=parent;
  if(name==='state')return state();if(busy)return {ok:false,error:'正在处理报告操作，请稍候'};
  if(uploadPending&&['row','choose-file','page','button','refresh','clear-login'].includes(name))return {ok:false,error:'报告正在上传，请等待学校返回结果'};
  busy=true;let stage=['refresh','save-login','login','clear-login','row','button','page','choose-file'].includes(name)?name:'unsupported';try{
   if(name==='refresh')sessionPaused=false;
   log('report action '+stage+(name==='row'?' '+(['upload','preview'].includes(payload.rowAction)?payload.rowAction:'invalid'):''));
   if(name==='login'){sessionPaused=false;attempted=false;manualLogin=true;return {ok:true};}
   if(name==='clear-login'){if(reading)await reading;const ses=session.fromPartition('report-client');close();sessionPaused=payload?.pause===true;await ses.clearStorageData();await ses.clearCache();await ses.closeAllConnections();if(!sessionPaused)void start();return {ok:true};}
   if(name==='refresh'){if(reading)await reading;close();phase='idle';void start();return {ok:true};}
   if(name==='save-login'){await saveCredentials({username:payload.username,password:payload.password});attempted=false;close();phase='idle';void start();return {ok:true};}
   if(name==='row'){
    if(reading)await reading;const r=rows.get(payload.key);if(!r||!['upload','preview'].includes(payload.rowAction))return {ok:false,error:'报告列表已变化，请刷新后重试'};
    if(payload.rowAction==='upload'){const check=await checkUpload(r);if(!check.ok)return check;uploadRow={...r};}
    dialogEpoch++;dismissedDialog=null;selectedFile=null;
    const result=await execute('row',{...r,action:payload.rowAction});
    if(!result.ok||payload.rowAction!=='upload')return result;
    // The school's row click starts an asynchronous request. Keep the first-click
    // feedback visible until a real dialog exists rather than relying on the next poll.
    const revision=generation;
    for(let i=0;i<80;i++){
     if(revision!==generation||!live())return {ok:false,error:'报告连接已关闭'};
     const snapshot=await execute('state');if(snapshot.dialog)return {ok:true};
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {ok:false,error:'学校上传窗口响应超时，请刷新后重试'};
   }
   if(name==='dismiss'){
    if(reading)await reading;
    if(payload.dialogId!==currentDialogId)return {ok:true,stale:true};
    dismissedDialog=currentDialogId;
    if(uploadPending)return {ok:true,pending:true};
    return await execute('dismiss',{dialogId:lastDialogId});
   }
   if(name==='button'){if(reading)await reading;if(payload.dialogId!==currentDialogId)return {ok:false,error:'窗口已变化，请重新操作'};if(!['cancel','ok','yes','no','submit'].includes(payload.key))return {ok:false,error:'不支持的操作'};if(payload.key==='submit'&&!selectedFile)return {ok:false,error:'请先选择 Word 报告'};if(payload.key==='submit'){if(!uploadRow)return {ok:false,error:'请重新打开上传窗口'};const check=await checkUpload(uploadRow);if(!check.ok)return check;}const result=await execute('button',{key:payload.key,dialogId:lastDialogId});if(result.ok&&payload.key==='submit'){uploadPending=true;uploadStarted=Date.now();}return result;}
   if(name==='page'){if(![1,-1].includes(payload.direction))return {ok:false,error:'无效的页码'};return await execute('page',{direction:payload.direction});}
   if(name==='choose-file'){
    stage='locate-upload';const target=await execute('file-input');if(!target.id)return {ok:false,error:target.message};const choice=await dialog.showOpenDialog(parent||getParent(),{title:'选择要提交的实验报告',properties:['openFile'],filters:[{name:'Word 实验报告',extensions:['doc','docx']}]});if(choice.canceled||choice.filePaths.length!==1)return {ok:true,cancelled:true};
    stage='validate-file';const file=choice.filePaths[0],stat=fs.statSync(file);if(!stat.isFile()||!['.doc','.docx'].includes(path.extname(file).toLowerCase())||stat.size>128*1024*1024)return {ok:false,error:'请选择有效的 Word 报告文件'};
    const current=await execute('file-input');if(current.id!==target.id)return {ok:false,error:'上传窗口已变化，请重试'};
    stage='attach-file';const debuggerClient=win.webContents.debugger;if(debuggerClient.isAttached())return {ok:false,error:'报告窗口正在调试，请关闭调试后重试'};debuggerClient.attach('1.3');
    try{const v=await debuggerClient.sendCommand('Runtime.evaluate',{expression:'document.getElementById('+JSON.stringify(target.id)+')',returnByValue:false});const n=await debuggerClient.sendCommand('DOM.describeNode',{objectId:v.result.objectId});await debuggerClient.sendCommand('DOM.setFileInputFiles',{files:[file],backendNodeId:n.node.backendNodeId});selectedFile=file;log('report file attached');}finally{debuggerClient.detach();}
    return {ok:true,fileName:path.basename(file)};
   }
   return {ok:false,error:'不支持的报告操作'};
  }catch{log('report action failed '+stage);return {ok:false,error:stage==='attach-file'?'文件未能加入上传窗口，请重新选择文件':stage==='validate-file'?'无法读取该报告文件，请检查文件是否存在或被占用':'报告操作未完成，请刷新或检查账号设置'};}finally{busy=false;}
 }
 function close(){generation++;opening=null;warming=null;phase='idle';attempted=false;for(const p of popups)if(!p.isDestroyed())p.close();if(live())win.destroy();win=null;rows.clear();imageCache.clear();imageValues.clear();imageScores.clear();imageStatuses.clear();statusReader.close();uploadRow=null;pendingImages=0;selectedFile=null;uploadPending=false;manualLogin=false;}
 function credentialsChanged(){attempted=false;}
 return {action,close,credentialsChanged,warm};
}
module.exports={createReportClient,reportPreviewAllowed};
