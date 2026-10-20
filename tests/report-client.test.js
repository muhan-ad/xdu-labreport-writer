'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createReportClient}=require('../src/main/report-client');
function fixture(options={}){const windows=[],calls=[],saves=[];let authenticated=false,dialog=null,logins=0;const data={index:0,fingerprint:'["id","2","time","experiment"]',week:'2',time:'星期二晚上18:30-20:45',name:'实验',gradeText:options.gradeText??'已上传',gradeSrc:options.imageSrc||''};const ses=new EventEmitter();ses.setPermissionRequestHandler=()=>{};ses.setPermissionCheckHandler=()=>{};ses.webRequest={onBeforeRequest(){}};ses.fetch=options.fetchImage;ses.clearStorageData=async()=>{authenticated=false;calls.push(['clear-storage'])};ses.clearCache=async()=>{};ses.closeAllConnections=async()=>{};
 class Window extends EventEmitter{constructor(o){super();this.options=o;windows.push(this);this.webContents=new EventEmitter();const c=this.webContents;c.url='';c.getURL=()=>c.url;c.session=ses;c.setWindowOpenHandler=f=>c.popup=f;c.loadURL=async u=>{c.url=u;};c.executeJavaScriptInIsolatedWorld=async()=>({filled:true});c.executeJavaScript=async code=>{const i=code.lastIndexOf(')('),[command,payload]=JSON.parse('['+code.slice(i+2,-1)+']');calls.push([command,payload]);if(command==='state')return authenticated?{phase:'ready',rows:[data],dialog,page:1,pages:1}:{phase:'needs_login'};if(command==='login'){authenticated=true;logins++;}if(command==='row')dialog={type:'upload',id:'upload-1'};if(command==='button'||command==='dismiss')dialog=null;if(command==='file-input')return {id:'file'};return {ok:true};};}loadURL(u){return this.webContents.loadURL(u);}isDestroyed(){return !!this.dead;}destroy(){this.dead=true;this.emit('closed');}}
 const client=createReportClient({electron:{BrowserWindow:Window,session:{fromPartition:()=>ses},dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]})}},statusReader:options.statusReader||{recognize:async()=>null,close(){}},getParent:()=>null,getCredentials:async()=>({username:'PRIVATE_NAME',password:'PRIVATE_PASSWORD'}),isAutoLoginEnabled:()=>options.auto!==false,saveCredentials:async v=>saves.push(v)});
 return {client,windows,calls,saves,get logins(){return logins;}};}
async function ready(f){await f.client.action('state');await new Promise(r=>setImmediate(r));await f.client.action('state');return f.client.action('state');}
test('report login executes automatically in a hidden isolated browser and returns no credentials or native page HTML',async()=>{const f=fixture();try{const s=await ready(f);assert.equal(s.phase,'ready');assert.equal(f.logins,1);assert.equal(f.windows[0].options.show,false);assert.equal(f.windows[0].options.webPreferences.preload,undefined);assert.equal(f.windows[0].options.webPreferences.nodeIntegration,false);assert.equal(f.windows[0].options.webPreferences.sandbox,true);assert.doesNotMatch(JSON.stringify(s),/PRIVATE_|fingerprint|gradeSrc|<html/);}finally{f.client.close();}});
test('row actions require current row key; choosing cancellation sends no file and submit needs an explicit selection',async()=>{const f=fixture();try{const s=await ready(f);assert.equal((await f.client.action('row',{key:'forged',rowAction:'upload'})).ok,false);assert.equal((await f.client.action('row',{key:s.rows[0].key,rowAction:'upload'})).ok,true);assert.equal((await f.client.action('choose-file')).cancelled,true);assert.equal((await f.client.action('button',{key:'submit'})).ok,false);assert.ok(!f.calls.some(([c,p])=>c==='button'&&p.key==='submit'));const current=await f.client.action('state');assert.equal((await f.client.action('button',{key:'cancel',dialogId:current.dialog.id})).ok,true);}finally{f.client.close();}});
test('report client can reconnect after host close and rejects unexpected origins',async()=>{const f=fixture();try{await ready(f);f.client.close();await f.client.action('state');await new Promise(r=>setImmediate(r));assert.equal(f.windows.length,2);f.windows[1].webContents.url='https://evil.example/';assert.equal((await f.client.action('state')).phase,'error');}finally{f.client.close();}});

test('preview permits only the observed school PDF viewer and nested school report stream',()=>{
 const {reportPreviewAllowed}=require('../src/main/report-client'),url='http://wlsy.xidian.edu.cn/uni-1.95.0.1594/pdf.js/web/viewer.html?file='+encodeURIComponent('/wgyreport/wgyreport.dll/pdf/ABC-123');
 assert.equal(reportPreviewAllowed(url),true);for(const file of ['file:///C:/private','http://127.0.0.1/a','https://evil.example/a','/unrelated/a'])assert.equal(reportPreviewAllowed(url.split('?')[0]+'?file='+encodeURIComponent(file)),false);
 const f=fixture();return ready(f).then(()=>{const decision=f.windows[0].webContents.popup({url});assert.equal(decision.action,'allow');assert.equal(decision.overrideBrowserWindowOptions.show,true);assert.equal(decision.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);f.client.close();});
});
test('shared auto-fill off pauses report auto-login while explicit login still works',async()=>{
 const f=fixture({auto:false});try{await f.client.action('state');await new Promise(r=>setImmediate(r));assert.equal((await f.client.action('state')).phase,'manual_login');assert.equal(f.logins,0);await f.client.action('login');assert.equal((await f.client.action('state')).phase,'logging_in');assert.equal(f.logins,1);}finally{f.client.close();}
});

test('dismiss binds to a dialog epoch, does not confirm, and reopening gets a fresh identity',async()=>{
 const f=fixture();try{
  const s=await ready(f);await f.client.action('row',{key:s.rows[0].key,rowAction:'upload'});const first=(await f.client.action('state')).dialog;
  assert.equal((await f.client.action('dismiss',{dialogId:'stale'})).stale,true);
  assert.equal((await f.client.action('dismiss',{dialogId:first.id})).ok,true);assert.equal((await f.client.action('state')).dialog,null);
  assert.ok(!f.calls.some(([c])=>c==='button'));
  await f.client.action('row',{key:s.rows[0].key,rowAction:'upload'});const second=(await f.client.action('state')).dialog;assert.notEqual(first.id,second.id);
  assert.equal((await f.client.action('button',{key:'ok',dialogId:first.id})).ok,false);
 }finally{f.client.close();}
});

test('a stalled official grade image does not block the list and fills in on a subsequent read',async()=>{
 let release;const image=new Promise(resolve=>release=resolve),f=fixture({imageSrc:'/wgyreport/wgyreport.dll/cache/test/status.png',fetchImage:()=>image});
 try{
  const s=await ready(f);assert.equal(s.phase,'ready');assert.equal(s.rows.length,1);assert.equal(s.rows[0].gradeImage,'');assert.equal(s.imagesPending,true);
  release({ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Buffer.from('89504e470d0a1a0a','hex')});await new Promise(r=>setImmediate(r));
  const completed=await f.client.action('state');assert.equal(completed.imagesPending,false);assert.match(completed.rows[0].gradeImage,/^data:image\/png;base64,/);
 }finally{f.client.close();}
});

test('prewarming shares a single hidden connection and login and respects disabled autofill',async()=>{
 const f=fixture();try{await Promise.all([f.client.warm(),f.client.warm()]);assert.equal(f.windows.length,1);assert.equal(f.logins,1);assert.equal((await f.client.action('state')).phase,'ready');}finally{f.client.close();}
 const disabled=fixture({auto:false});try{assert.equal((await disabled.client.warm()).phase,'manual_login');assert.equal(disabled.logins,0);}finally{disabled.client.close();}
});

test('numeric grades including zero block upload in main process, submitted status does not',async()=>{
 for(const gradeText of ['4.5','0','100 分']){const f=fixture({gradeText});try{const s=await ready(f);assert.equal(s.rows[0].graded,true);assert.equal(s.rows[0].canUpload,false);assert.equal((await f.client.action('row',{key:s.rows[0].key,rowAction:'upload'})).ok,false);assert.ok(!f.calls.some(([c])=>c==='row'));}finally{f.client.close();}}
});
test('recognized grade image blocks upload without exposing image source',async()=>{
 const f=fixture({imageSrc:'/wgyreport/wgyreport.dll/cache/test/status.png',fetchImage:async()=>({ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Buffer.from('89504e470d0a1a0a','hex')}),statusReader:{recognize:async()=>4.5,close(){}}});
 try{await ready(f);await new Promise(r=>setImmediate(r));const s=await f.client.action('state');assert.equal(s.rows[0].score,4.5);assert.equal(s.rows[0].graded,true);assert.equal((await f.client.action('row',{key:s.rows[0].key,rowAction:'upload'})).ok,false);}finally{f.client.close();}
});

test('local numeric image evidence requires repeated agreement and rejects submission text',()=>{
 const {numericScore,agreedScore}=require('../src/main/report-status-reader');
 assert.equal(numericScore('0'),0);assert.equal(numericScore('已上传'),null);
 assert.equal(agreedScore(['4.5 4.5 415 415']),4.5);assert.equal(agreedScore(['o ooo']),0);
 for(const texts of [[],['4.5'],['4.5 5.5'],['已上传 已上传'],['未上传 未上传'],['4.5 hello'],['101 101']])assert.equal(agreedScore(texts),null);
});

test('report status maps any recognized 已 to 已上传 and otherwise requires repeated exact status',()=>{
 const {agreedStatus}=require('../src/main/report-status-reader');
 assert.equal(agreedStatus(['已上传 已上传 已上传 已上传']),'已上传');
 assert.equal(agreedStatus(['未 上 传 未 上 传']),'未上传');
 for(const texts of [['已'],['已上传'],['已 上 1 专 彐 上 1 专'],['已上传 已上传','未上传 未上传'],['已上传 未上传']])assert.equal(agreedStatus(texts),'已上传');
 for(const texts of [[],['未上传'],['三 》 传 三 》 传'],['4.5 4.5']])assert.equal(agreedStatus(texts),'');
});

test('local status text is returned for rendering without fabricating a numeric grade',async()=>{
 const f=fixture({gradeText:'',imageSrc:'/wgyreport/wgyreport.dll/cache/test/status.png',fetchImage:async()=>({ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Buffer.from('89504e470d0a1a0a','hex')}),statusReader:{read:async()=>({score:null,status:'已上传'}),close(){}}});
 try{await ready(f);await new Promise(r=>setImmediate(r));const s=await f.client.action('state');assert.equal(s.rows[0].gradeText,'已上传');assert.equal(s.rows[0].score,null);assert.equal(s.rows[0].graded,false);}finally{f.client.close();}
});

test('report prewarm waits for OCR and shares completed statuses with foreground reads',async()=>{
 let release,warmed=0;const result=new Promise(r=>release=r);
 const f=fixture({gradeText:'',imageSrc:'/wgyreport/wgyreport.dll/cache/test/status.png',fetchImage:async()=>({ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Buffer.from('89504e470d0a1a0a','hex')}),statusReader:{warm(){warmed++},read:()=>result,close(){}}});
 try{let completed=false;const job=f.client.warm().then(s=>{completed=true;return s});await new Promise(r=>setTimeout(r,350));assert.equal(completed,false);assert.equal(warmed,1);release({score:null,status:'已上传'});const state=await job;assert.equal(state.imagesPending,false);assert.equal(state.rows[0].gradeText,'已上传');assert.equal((await f.client.action('state')).rows[0].gradeText,'已上传');assert.equal(f.windows.length,1);}finally{release({score:null,status:''});f.client.close();}
});

test('local reader retries garbled status in black and white, shares identical images and caches results',async()=>{
 const {createReportStatusReader}=require('../src/main/report-status-reader');let calls=0,starts=0;
 const reader=createReportStatusReader({platform:'win32',spawnProcess:()=>{starts++;const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.write=line=>{const q=JSON.parse(line);calls++;queueMicrotask(()=>c.stdout.emit('data',JSON.stringify({id:q.id,scoreTexts:[''],texts:[q.threshold===120?'已 上 1 专':'三 》 传 三 》 传']})+'\n'));};c.kill=()=>{};return c;}});
 try{const bytes=Buffer.from('same official picture');const results=await Promise.all([reader.read(bytes),reader.read(bytes)]);assert.equal(calls,2);assert.equal(results[0].status,'已上传');assert.equal(results[1].status,'已上传');await reader.read(bytes);assert.equal(calls,2);reader.close();await reader.read(bytes);assert.equal(starts,2);}finally{reader.close();}
});

test('threshold fallback may confirm a known status but never invent a new numeric score',async()=>{
 const {createReportStatusReader}=require('../src/main/report-status-reader');
 const reader=createReportStatusReader({platform:'win32',spawnProcess:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.write=line=>{const q=JSON.parse(line);queueMicrotask(()=>c.stdout.emit('data',JSON.stringify({id:q.id,texts:[],scoreTexts:q.threshold===120?['45 45']:[]})+'\n'));};c.kill=()=>{};return c;}});
 try{assert.equal((await reader.read(Buffer.from('uncertain score'))).score,null);}finally{reader.close();}
});

test('unified session clear does not auto reconnect or warm, explicit login resumes',async()=>{
 const f=fixture();try{await ready(f);assert.equal((await f.client.action('clear-login',{pause:true})).ok,true);const count=f.windows.length,logins=f.logins;assert.equal((await f.client.action('state')).phase,'manual_login');await f.client.warm();await new Promise(r=>setImmediate(r));assert.equal(f.windows.length,count);assert.equal(f.logins,logins);assert(f.calls.some(([name])=>name==='clear-storage'));await f.client.action('login');await ready(f);assert.equal(f.windows.length,count+1);assert.equal(f.logins,logins+1);}finally{f.client.close();}
});
