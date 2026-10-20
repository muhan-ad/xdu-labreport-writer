// Read-only school timetable bridge. Official authentication is completed by the user.
// Protocol reference: XDYou classtable_session.dart / semester_session.dart (MPL-2.0).
const edgeConfig=JSON.parse(process.env.LAB_COURSE_READER_CONFIG||'{}');
if(edgeConfig.transport==='edge'){
 const {app}=require('electron');
 if(typeof edgeConfig.profileDir==='string'&&require('node:path').isAbsolute(edgeConfig.profileDir)){const hostProfile=edgeConfig.profileDir+'-host';require('node:fs').mkdirSync(hostProfile,{recursive:true});app.setPath('userData',hostProfile);}
 app.whenReady().then(()=>require('./edge_reader.cjs').startEdge(edgeConfig,progress=>process.stdout.write('ACADEMIC_PROGRESS:'+JSON.stringify(progress)+'\n'))).catch(()=>({ok:false,code:'reader_failed'})).then(result=>process.stdout.write('ACADEMIC_RESULT:'+JSON.stringify(result)+'\n',()=>app.quit()));
}else{
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const APP_URL='https://ehall.xidian.edu.cn/appShow?appId=4770397878132218';
const ROOT='https://ehall.xidian.edu.cn/jwapp/sys/wdkb/modules/';
const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['ehall.xidian.edu.cn','ids.xidian.edu.cn'].includes(u.hostname);}catch{return false;}};
let window,done=false,reading=false,timer,config;
function finish(result){if(done)return;done=true;clearTimeout(timer);process.stdout.write('ACADEMIC_RESULT:'+JSON.stringify(result)+'\n',()=>app.quit());}
async function readJSON(url,data){
 if(!allowed(url))throw Error('unexpected_destination');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{const response=await window.webContents.session.fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:new URLSearchParams(data),redirect:'error',signal:controller.signal});
  if(response.status===401||response.status===403)throw Error('needs_login');
  if(response.status===429)throw Error('rate_limited');
  if(!response.ok)throw Error('school_error');
  const body=await response.text();if(body.length>8000000)throw Error('response_too_large');
  let value;try{value=JSON.parse(body);}catch{throw Error('needs_login');}return value;
 }finally{clearTimeout(timeout);}
}
function moduleData(value,key){const result=value?.datas?.[key];if(!result||!Array.isArray(result.rows))throw Error('school_format_changed');if(result.extParams?.code!==undefined&&String(result.extParams.code)!=='1')throw Error('school_data_unavailable');return result;}
async function rows(path,key,data){
 const collected=[];let total=null;
 for(let page=1;page<=50;page++){
  const result=moduleData(await readJSON(ROOT+path,{...data,pageNumber:String(page),pageSize:'500'}),key);
  if(total===null&&result.totalSize!==undefined){total=Number(result.totalSize);if(!Number.isFinite(total)||total<0||total>20000)throw Error('school_format_changed');}
  collected.push(...result.rows);
  if(total!==null&&collected.length>=total)return collected;
  if(result.rows.length<500){if(total!==null&&collected.length<total)throw Error('incomplete_page');return collected;}
 }
 throw Error('incomplete_page');
}
async function readTimetable(){
 const semesterRows=await rows('jshkcb/dqxnxq.do','dqxnxq',{}),semester=String(semesterRows[0]?.DM||'');
 if(!/^\d{4}-\d{4}-[12]$/.test(semester))throw Error('school_format_changed');
 const parts=semester.split('-');
 const calendarRows=await rows('jshkcb/cxjcs.do','cxjcs',{XN:parts[0]+'-'+parts[1],XQ:parts[2]});
 const calendar=calendarRows[0];if(!calendar?.XQKSRQ)throw Error('school_calendar_missing');
 const courses=await rows('xskcb/xskcb.do','xskcb',{XNXQDM:semester,XH:config.account});
 const changes=await rows('xskcb/xsdkkc.do','xsdkkc',{XNXQDM:semester,'*order':'-SQSJ'});
 const notArranged=await rows('xskcb/cxxsllsywpk.do','cxxsllsywpk',{XNXQDM:semester,XH:config.account});
 // Never return cookies, passwords, SSO tickets, complete user profiles or grades.
 const courseKeys=['KCM','KCH','KXH','SKZC','SKXQ','KSJC','JSJC','JASMC','XH'];
 const changeKeys=['KCM','KCH','KXH','TKLXDM','SKZC','XSKZC','SKXQ','XSKXQ','KSJC','JSJC','XKSJC','XJSJC','JASMC','XJASMC','SQSJ'];
 const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
 await window.webContents.session.cookies.flushStore();
 finish({ok:true,account:config.account,semester,calendar:{XQKSRQ:calendar.XQKSRQ,XQJSRQ:calendar.XQJSRQ},courses:courses.map(row=>pick(row,courseKeys)),changes:changes.map(row=>pick(row,changeKeys)),notArranged:notArranged.map(row=>({KCM:row.KCM,KCH:row.KCH}))});
}
async function maybeRead(){
 if(done||reading||!window||window.isDestroyed())return;
 const url=window.webContents.getURL();
 if(!allowed(url))return;
 if(new URL(url).hostname==='ids.xidian.edu.cn'){
  if(!config.interactive)finish({ok:false,code:'needs_login'});
  return;
 }
 if(new URL(url).hostname!=='ehall.xidian.edu.cn')return;
 reading=true;
 try{await readTimetable();}catch(error){
  const code=['needs_login','rate_limited','school_error','response_too_large','school_format_changed','school_data_unavailable','school_calendar_missing','incomplete_page'].includes(error.message)?error.message:'network_failed';
  if(code==='needs_login'&&config.interactive){reading=false;return;}
  finish({ok:false,code});
 }
}
app.on('window-all-closed',()=>{if(!done)finish({ok:false,code:'cancelled'});});
async function start(line){
 let stage='config';
 try{config=JSON.parse(line);if(!/^\d{5,20}$/.test(config.account)||typeof config.profileDir!=='string'||!config.profileDir)throw Error('bad_config');
  fs.mkdirSync(config.profileDir,{recursive:true});app.setPath('userData',config.profileDir);
  await app.whenReady();stage='window';
  window=new BrowserWindow({show:!!config.interactive,width:1080,height:800,title:'教务统一认证',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url)){event.preventDefault();finish({ok:false,code:'unexpected_destination'});}});
  window.webContents.on('will-redirect',(event,url)=>{if(!allowed(url)){event.preventDefault();finish({ok:false,code:'unexpected_destination'});}});
  window.webContents.on('did-finish-load',maybeRead);
  timer=setTimeout(()=>finish({ok:false,code:config.interactive?'login_timeout':'network_failed'}),config.interactive?240000:60000);
  stage='navigation';await window.loadURL(APP_URL);
 }catch(error){if(stage==='navigation'&&error.code==='ERR_ABORTED')return;finish({ok:false,code:stage==='navigation'?'network_failed':'reader_failed',stage,networkCode:String(error.code||'')});}
}
// Windows GUI-subsystem Electron does not reliably deliver redirected stdin events.
// Configuration contains only an account identifier, profile path and mode, never credentials.
start(process.env.LAB_COURSE_READER_CONFIG||'{}');

}
