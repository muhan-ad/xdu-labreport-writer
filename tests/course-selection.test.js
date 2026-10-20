'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const tempRoots=[];test.after(()=>{for(const dir of tempRoots)fs.rmSync(dir,{recursive:true,force:true});});
const {createCourseSelection,externalAllowed}=require('../src/main/course-selection');
function fixture(fail=false,getSavedLogin,schoolPortal,reportClient){
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'course-controller-'));tempRoots.push(userData);
 const windows=[],children=[],stops=[],external=[],handlers={},scripts=[];
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.executeJavaScriptInIsolatedWorld=async(id,code)=>{scripts.push({id,code});return true;};this.webContents.setWindowOpenHandler=fn=>this.popup=fn;windows.push(this);}
  isDestroyed(){return !!this.dead;}show(){this.visible=true;}focus(){this.focused=true;}destroy(){this.dead=true;this.emit('closed');}async loadURL(url){this.url=url;}
 }
 const ses={setPermissionRequestHandler(){},setPermissionCheckHandler(){}};
 const spawnProcess=(exe,args,options)=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.pid=43210;child.kill=()=>stops.push('kill');child.options=options;children.push(child);
  queueMicrotask(()=>fail?child.emit('error',Error('fixture')):child.stdout.emit('data','Course UI: http://127.0.0.1:54321/\n'));
  return child;
 };
 const controller=createCourseSelection({electron:{ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},app:{isPackaged:false},BrowserWindow:Window,session:{fromPartition:()=>ses},shell:{openExternal:async url=>{external.push(url);}}},root:path.join(__dirname,'..'),getParent:()=>null,resolvePython:()=>process.execPath,userData,getSavedLogin,schoolPortal,reportClient,spawnProcess,stopTree:(...args)=>stops.push(args)});
 return {controller,windows,children,stops,external,handlers,scripts,userData};
}

test('homepage preload is silent, shared with open, and warms reports only after course entry ready',async()=>{
 let reports=0;const f=fixture(false,async()=>({enabled:true,credentials:{username:'a',password:'b'}}),{getAutoFillEnabled:()=>true},{warm:async()=>{reports++},close(){}});
 try{fs.writeFileSync(path.join(f.userData,'course-onboarding.json'),JSON.stringify({acknowledged:true}));
 await Promise.all([f.controller.warm(),f.controller.warm()]);assert.equal(f.windows.length,1);assert.equal(f.children.length,1);assert.notEqual(f.windows[0].visible,true);assert.notEqual(f.windows[0].focused,true);assert.equal(reports,0);
 const w=f.windows[0],c=w.webContents,e={sender:c,senderFrame:c.mainFrame};
 assert.equal((await f.handlers['course-window']({...e,senderFrame:{}},{action:'ready'})).ok,false);assert.equal(reports,0);
 await f.handlers['course-window'](e,{action:'ready'});assert.equal(reports,1);
 await f.controller.open();assert.equal(f.windows.length,1);assert.equal(w.visible,true);assert.equal(w.focused,true);f.controller.discardPreload();assert.notEqual(w.dead,true);
 }finally{f.controller.shutdown();}
});

test('first use, disabled autofill and absent credentials never preload; closing main discards hidden work',async()=>{
 for(const mode of ['first','disabled','missing','allowed']){
 let reads=0;const f=fixture(false,async()=>{reads++;return {enabled:true,credentials:mode==='missing'?null:{username:'a',password:'b'}}},{getAutoFillEnabled:()=>mode!=='disabled'});
 try{if(mode!=='first')fs.writeFileSync(path.join(f.userData,'course-onboarding.json'),JSON.stringify({acknowledged:true}));await f.controller.warm();
 assert.equal(f.windows.length,mode==='allowed'?1:0);if(mode==='first'||mode==='disabled')assert.equal(reads,0);
 f.controller.discardPreload();if(mode==='allowed')assert.equal(f.windows[0].dead,true);
 }finally{f.controller.shutdown();}}
});

test('pending warm cannot resurrect a window after shutdown or main close',async()=>{
 for(const method of ['shutdown','discardPreload']){let release;const f=fixture(false,()=>new Promise(r=>release=r),{getAutoFillEnabled:()=>true});
 fs.writeFileSync(path.join(f.userData,'course-onboarding.json'),JSON.stringify({acknowledged:true}));const job=f.controller.warm();f.controller[method]();release({enabled:true,credentials:{username:'a',password:'b'}});await job;assert.equal(f.windows.length,0);f.controller.shutdown();}
});

test('opening an old preload requests refresh once, while a fresh preload reuses its data',async()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 let reports=0;const messages=[];const f=fixture(false,async()=>({enabled:true,credentials:{username:'a',password:'b'}}),{getAutoFillEnabled:()=>true},{action:async action=>{assert.equal(action,'refresh');reports++;return {ok:true}},close(){}});
 try{fs.writeFileSync(path.join(f.userData,'course-onboarding.json'),JSON.stringify({acknowledged:true}));await f.controller.warm();f.windows[0].webContents.send=channel=>messages.push(channel);now+=61000;await f.controller.open();assert.deepEqual(messages,['course-resume']);assert.equal(reports,1);await f.controller.open();assert.equal(reports,1);}finally{Date.now=realNow;f.controller.shutdown();}
});
test('concurrent open shares service and one sandboxed window',async()=>{
 const f=fixture();await Promise.all([f.controller.open(),f.controller.open()]);
 assert.equal(f.children.length,1);assert.equal(f.windows.length,1);assert.equal(f.windows[0].url,'http://127.0.0.1:54321/');
 assert.equal(f.windows[0].options.webPreferences.nodeIntegration,false);assert.equal(f.windows[0].options.webPreferences.sandbox,true);
 assert.ok(f.windows[0].options.webPreferences.preload.endsWith(path.join('src','course-selection','preload.cjs')));
 const event={preventDefault(){this.prevented=true;}};f.windows[0].webContents.emit('will-navigate',event,'https://evil.example/');assert.equal(event.prevented,true);
 f.controller.shutdown();assert.ok(f.stops.length);assert.equal(f.windows[0].dead,true);
});
test('closed course window reuses service until application exit',async()=>{
 const f=fixture();await f.controller.open();f.windows[0].destroy();await f.controller.open();assert.equal(f.children.length,1);assert.equal(f.windows.length,2);f.controller.shutdown();assert.equal((await f.controller.open()).ok,false);
});
test('startup failure keeps a visible loading shell with retry',async()=>{
 const f=fixture(true);assert.equal((await f.controller.open()).ok,false);assert.equal(f.windows.length,1);assert.match(f.windows[0].url,/startup.html$/);assert.equal(f.windows[0].visible,true);assert.ok(f.stops.length);f.controller.shutdown();
});
test('helper environment contains no password and uses application runtime',async()=>{
 const f=fixture();await f.controller.open();const env=f.children[0].options.env;
 assert.equal(env.LAB_COURSE_ELECTRON,process.execPath);assert.equal(env.LAB_COURSE_READER_MODE,'1');assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);
 assert.ok(env.LAB_COURSE_DATA_DIR.endsWith(path.join('course-selection','academic')));f.controller.shutdown();
});
test('external links are restricted to supported school destinations',()=>{
 assert.equal(externalAllowed('http://wlsy.xidian.edu.cn/PhyEws/'),true);
 for(const url of ['file:///C:/secret','javascript:alert(1)','https://evil.example/','http://wlsy.xidian.edu.cn.evil.example/','https://a:b@ids.xidian.edu.cn/','https://ehall.xidian.edu.cn:1234/'])assert.equal(externalAllowed(url),false);
});

test('dedicated reader has no extension packaging or installed extension directory',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
 assert.ok(!pkg.build.extraResources.some(r=>r.from==='browser-extension'));
 const main=fs.readFileSync(path.join(__dirname,'../src/main/course-selection.js'),'utf8');
 assert.doesNotMatch(main,/LAB_COURSE_EXTENSION_DIR|course-browser-extension/);
 assert.match(main,/timetable_reader.js/);
});

test('removed extension connection never opens in the default browser',async()=>{
 const f=fixture();await f.controller.open();const target='http://127.0.0.1:54321/academic-connect#'+'a'.repeat(43);
 assert.deepEqual(f.windows[0].popup({url:target}),{action:'deny'});assert.deepEqual(f.external,[]);
 f.windows[0].popup({url:'http://127.0.0.1:54322/academic-connect#'+'b'.repeat(43)});assert.equal(f.external.length,0);f.controller.shutdown();
});
test('saved school login is injected only into current course top frame and never returned over IPC',async()=>{
 let reads=0;const f=fixture(false,async()=>{reads++;return {enabled:true,credentials:{username:'TEST_ACCOUNT',password:'TEST_PASSWORD'}};});await f.controller.open();
 const contents=f.windows[0].webContents,fill=f.handlers['course-fill-saved-login'];
 assert.equal((await fill({sender:contents,senderFrame:{}})).ok,false);assert.equal(reads,0);
 const result=await fill({sender:contents,senderFrame:contents.mainFrame});assert.equal(result.filled,true);assert.doesNotMatch(JSON.stringify(result),/TEST_ACCOUNT|TEST_PASSWORD/);
 assert.equal(f.scripts[0].id,1003);assert.match(f.scripts[0].code[0].code,/location.origin/);
 f.windows[0].url='https://evil.example/';assert.equal((await fill({sender:contents,senderFrame:contents.mainFrame})).ok,false);assert.equal(reads,1);f.controller.shutdown();
});
test('navigation while decrypting and disabled autofill never inject passwords',async()=>{
 let resolve;const f=fixture(false,()=>new Promise(r=>{resolve=r;}));await f.controller.open();const contents=f.windows[0].webContents;
 const pending=f.handlers['course-fill-saved-login']({sender:contents,senderFrame:contents.mainFrame});f.windows[0].url='https://evil.example/';resolve({enabled:true,credentials:{username:'a',password:'b'}});assert.equal((await pending).ok,false);assert.equal(f.scripts.length,0);f.controller.shutdown();
 const disabled=fixture(false,async()=>({enabled:false}));await disabled.controller.open();const c=disabled.windows[0].webContents;assert.equal((await disabled.handlers['course-fill-saved-login']({sender:c,senderFrame:c.mainFrame})).ok,true);assert.equal(disabled.scripts.length,0);disabled.controller.shutdown();
});

test('custom report IPC accepts only the owning local top frame and never exposes its hidden browser',async()=>{
 const calls=[],client={action:async(...args)=>{calls.push(args);return {ok:true};},close(){}};
 const f=fixture(false,undefined,undefined,client);await f.controller.open();const host=f.windows[0],contents=host.webContents,handler=f.handlers['course-report-view'];
 const event={sender:contents,senderFrame:contents.mainFrame},payload={action:'state'};
 assert.equal((await handler({sender:{},senderFrame:{}},payload)).ok,false);
 assert.equal((await handler({...event,senderFrame:{}},payload)).ok,false);
 assert.equal((await handler(event,payload)).ok,true);assert.deepEqual(calls[0],['state',payload,host]);f.controller.shutdown();
});

test('shared account IPC rejects remote frames and returns only manager status',async()=>{
 const calls=[],portal={accountSettings:async(name,payload)=>{calls.push([name,payload.systemId]);return {ok:true,configured:true};}};const f=fixture(false,undefined,portal);await f.controller.open();const c=f.windows[0].webContents,handler=f.handlers['course-school-accounts'],payload={action:'status',systemId:'report'};
 assert.equal((await handler({sender:{},senderFrame:{}},payload)).ok,false);assert.equal((await handler({sender:c,senderFrame:{}},payload)).ok,false);assert.equal((await handler({sender:c,senderFrame:c.mainFrame},payload)).configured,true);assert.deepEqual(calls,[['status','report']]);f.controller.shutdown();
});

test('one-stop external system and caption IPC require the owning top frame and fixed action IDs',async()=>{
 const f=fixture();await f.controller.open();const w=f.windows[0],c=w.webContents,e={sender:c,senderFrame:c.mainFrame};
 const open=f.handlers['course-open-system'];assert.equal((await open({...e,senderFrame:{}},'exam')).ok,false);assert.equal((await open(e,'https://evil.example')).ok,false);
 assert.equal((await open(e,'simulation')).ok,true);assert.deepEqual(f.external,['https://wlxnfzsy.xidian.edu.cn/']);
 let minimized=false;w.minimize=()=>minimized=true;
 const control=f.handlers['course-window'];assert.equal((await control({...e,senderFrame:{}},{action:'minimize'})).ok,false);assert.equal(minimized,false);
 assert.equal((await control(e,{action:'minimize'})).ok,true);assert.equal(minimized,true);assert.equal(w.options.frame,false);f.controller.shutdown();
});

test('first entry acknowledgement and reset are persistent and trusted; upload rejection prevents clear',async()=>{
 let blocked=true;const calls=[];const f=fixture(false,null,{accountSettings:async name=>{calls.push(name);return {ok:true}}},{action:async(name,p)=>blocked?{ok:false,error:'报告正在上传'}:{ok:true},warm:async()=>{throw Error('must not prewarm')},close(){}});
 try{await f.controller.open();const c=f.windows[0].webContents,event={sender:c,senderFrame:c.mainFrame},action=p=>f.handlers['course-school-accounts'](event,p);assert.equal((await action({action:'entry-status'})).acknowledged,false);await action({action:'complete-entry'});assert.equal((await action({action:'entry-status'})).acknowledged,true);assert.equal((await action({action:'clear-sessions'})).ok,false);assert.equal(calls.length,0);assert.equal((await action({action:'entry-status'})).acknowledged,true);blocked=false;assert.equal((await action({action:'clear-sessions'})).ok,true);assert.equal((await action({action:'entry-status'})).acknowledged,false);assert.deepEqual(calls,['clear-sessions']);const rejected=await f.handlers['course-school-accounts']({sender:c,senderFrame:{}},{action:'complete-entry'});assert.equal(rejected.ok,false);}finally{f.controller.shutdown();}
});
test('filter preferences persist separately by account and reject foreign frames or invalid account identifiers',async()=>{
 const f=fixture();try{await f.controller.open();const c=f.windows[0].webContents,event={sender:c,senderFrame:c.mainFrame};const action=payload=>f.handlers['course-school-accounts'](event,payload);
 assert.equal((await action({action:'filter-load',account:'USER1'})).filters,null);
 const config={recommendExperiment:true,specifyTeachers:true,teachers:['张元元']};assert.equal((await action({action:'filter-save',account:'USER1',filters:config})).ok,true);
 assert.equal((await action({action:'filter-load',account:'USER2'})).filters,null);const loaded=await action({action:'filter-load',account:'USER1'});assert.equal(loaded.filters.recommendExperiment,true);assert.deepEqual(loaded.filters.teachers,['张元元']);
 assert.equal((await action({action:'filter-save',account:'../USER1',filters:config})).ok,false);
 assert.equal((await f.handlers['course-school-accounts']({sender:c,senderFrame:{}},{action:'filter-load',account:'USER1'})).ok,false);
 f.windows[0].destroy();await f.controller.open();const current=f.windows[1].webContents;assert.equal((await f.handlers['course-school-accounts']({sender:current,senderFrame:current.mainFrame},{action:'filter-load',account:'USER1'})).filters.specifyTeachers,true);
 }finally{f.controller.shutdown();}
});
