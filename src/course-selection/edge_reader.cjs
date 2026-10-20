'use strict';
// Own Edge process and private CDP pipes only; never attach to a user's normal profile.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const APP_URL='https://ehall.xidian.edu.cn/appShow?appId=4770397878132218';
function allowed(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['ehall.xidian.edu.cn','ids.xidian.edu.cn'].includes(u.hostname);}catch{return false;}}
function edgeExecutable(){
 for(const base of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA]){
  if(base){const file=path.join(base,'Microsoft','Edge','Application','msedge.exe');if(fs.existsSync(file))return file;}
 }
 throw Error('edge_missing');
}
class PipeCDP{
 constructor(child){this.child=child;this.next=0;this.pending=new Map();this.listeners=new Set();this.buffer='';
  child.stdio[4].setEncoding('utf8');child.stdio[4].on('data',chunk=>{this.buffer+=chunk;if(this.buffer.length>16000000){this.fail();return;}let cut;while((cut=this.buffer.indexOf('\0'))>=0){const line=this.buffer.slice(0,cut);this.buffer=this.buffer.slice(cut+1);if(!line)continue;let msg;try{msg=JSON.parse(line);}catch{this.fail();continue;}if(msg.id){const p=this.pending.get(msg.id);if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(Error('browser_protocol_failed')):p.resolve(msg.result||{});}}else for(const fn of this.listeners)fn(msg);}});
  child.on('exit',()=>this.fail());child.on('error',()=>this.fail());
  child.stdio[3].on('error',()=>this.fail());child.stdio[4].on('error',()=>this.fail());
 }
 fail(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('browser_closed'));}this.pending.clear();}
 send(method,params={},sessionId,timeoutMs=25000){return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('browser_timeout'));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('browser_closed'));}});});}
}
function acquireProfile(profile){
 fs.mkdirSync(profile,{recursive:true});const file=path.join(profile,'lab-connection.lock');
 try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,String(process.pid));return()=>{fs.closeSync(fd);try{fs.unlinkSync(file);}catch{}};}
 catch(error){if(error.code!=='EEXIST')throw error;let old;try{old=Number(fs.readFileSync(file,'utf8'));}catch{throw Error('profile_busy');}
  if(!Number.isSafeInteger(old)||old<=0)throw Error('profile_busy');
  try{process.kill(old,0);}catch(e){if(e.code==='ESRCH'){fs.unlinkSync(file);return acquireProfile(profile);}}
  throw Error('profile_busy');
 }
}
async function startEdge(config,onProgress=()=>{}){
 if(!/^\d{5,20}$/.test(config.account||'')||typeof config.profileDir!=='string'||!path.isAbsolute(config.profileDir)||typeof config.readerScript!=='string'||!path.isAbsolute(config.readerScript))return {ok:false,code:'bad_config'};
 let child,cdp,release,timer,debounce,sessionId,targetId,reading=false,reread=false,settled=false;
 return new Promise(async resolve=>{
  async function finish(value){if(settled)return;settled=true;clearTimeout(timer);clearTimeout(debounce);
   if(cdp){try{await Promise.race([cdp.send('Browser.close'),new Promise(r=>setTimeout(r,1500))]);}catch{}}
   if(child&&child.exitCode===null){try{child.kill();}catch{}}
   cdp?.fail();release?.();resolve(value);
  }
  async function maybeRead(){
   if(settled||reading||!sessionId)return;reading=true;
   try{
    const current=await cdp.send('Runtime.evaluate',{expression:'location.href',returnByValue:true},sessionId),url=current.result?.value;
    if(!allowed(url))return finish({ok:false,code:'unexpected_destination'});
    if(new URL(url).hostname!=='ehall.xidian.edu.cn'){onProgress({stage:'waiting_login',step:0});return;}
    const source=fs.readFileSync(config.readerScript,'utf8');
    const expression=source+'\n;TimetableReader.readTimetable('+JSON.stringify(config.account)+',fetch,p=>globalThis.labAcademicProgress(JSON.stringify(p))).catch(e=>({ok:false,code:e.message}))';
    const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:180000},sessionId,185000);
    if(result.exceptionDetails)throw Error('reader_failed');const raw=result.result?.value;
    if(raw?.ok===true)return finish(raw);
    if(raw?.code==='needs_login'){onProgress({stage:'waiting_login',step:0});return;}
    return finish({ok:false,code:['account_mismatch','identity_unverified','rate_limited','school_format_changed'].includes(raw?.code)?raw.code:'network_failed'});
   }catch(error){if(error.message==='browser_protocol_failed'){schedule();return;}return finish({ok:false,code:['browser_closed','browser_timeout'].includes(error.message)?error.message:'reader_failed'});}
   finally{reading=false;if(reread&&!settled){reread=false;schedule();}}
  }
  function schedule(){if(reading){reread=true;return;}clearTimeout(debounce);debounce=setTimeout(()=>void maybeRead(),600);}
  try{
   onProgress({stage:'launching',step:0});const executable=edgeExecutable();release=acquireProfile(config.profileDir);
   child=spawn(executable,['--user-data-dir='+config.profileDir,'--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--new-window','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:false});
   cdp=new PipeCDP(child);child.on('exit',()=>void finish({ok:false,code:'cancelled'}));child.on('error',()=>void finish({ok:false,code:'edge_launch_failed'}));
   timer=setTimeout(()=>void finish({ok:false,code:'login_timeout'}),240000);
   const targets=await cdp.send('Target.getTargets');targetId=targets.targetInfos.find(t=>t.type==='page'&&t.url==='about:blank')?.targetId;
   if(!targetId)targetId=(await cdp.send('Target.createTarget',{url:'about:blank'})).targetId;
   sessionId=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
   cdp.listeners.add(msg=>{
    if(msg.sessionId!==sessionId)return;
    if(msg.method==='Runtime.bindingCalled'&&msg.params.name==='labAcademicProgress'){try{const p=JSON.parse(msg.params.payload);if(['reading','authenticated','validating'].includes(p.stage)&&Number.isInteger(p.step)&&p.step>=1&&p.step<=5)onProgress({stage:p.stage,step:p.step,page:Number.isInteger(p.page)?Math.min(50,Math.max(1,p.page)):1});}catch{}}
    if(msg.method==='Fetch.requestPaused'){
     const p=msg.params;void cdp.send(allowed(p.request.url)?'Fetch.continueRequest':'Fetch.failRequest',{requestId:p.requestId,...(allowed(p.request.url)?{}:{errorReason:'BlockedByClient'})},sessionId).catch(()=>{});
     if(!allowed(p.request.url))void finish({ok:false,code:'unexpected_destination'});
    }
    if(['Page.loadEventFired','Page.navigatedWithinDocument'].includes(msg.method))schedule();
   });
   await cdp.send('Runtime.enable',{},sessionId);
   await cdp.send('Runtime.addBinding',{name:'labAcademicProgress'},sessionId);
   await cdp.send('Page.enable',{},sessionId);
   await cdp.send('Fetch.enable',{patterns:[{resourceType:'Document',requestStage:'Request'}]},sessionId);
   await cdp.send('Browser.setDownloadBehavior',{behavior:'deny'});
   await cdp.send('Page.navigate',{url:APP_URL},sessionId);schedule();
  }catch(error){void finish({ok:false,code:['edge_missing','profile_busy'].includes(error.message)?error.message:'edge_launch_failed'});}
 });
}
module.exports={allowed,edgeExecutable,PipeCDP,acquireProfile,startEdge};
