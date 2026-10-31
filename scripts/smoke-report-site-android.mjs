import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe',serial='emulator-5560';
const run=(...a)=>execFileSync(adb,['-s',serial,...a],{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let expired=false,slow=false,uploads=0,courseReads=0,courseCookie=false;const requests=[],checks=[];
const html=`<!doctype html><html><head><meta charset="utf-8"><style>input{width:200px;height:40px}span{display:inline-block;padding:10px}</style></head><body><div id="login"><form action="/wgyreport/wgyreport.dll/"><input id="account" name="account"><input id="password" type="password" name="password"></form></div><div id="icons"><span class="x-action-col-0">上传</span><span class="x-action-col-1">报告预览</span></div><script>
let logged=false,loading=false,page=1,rows=[],message='';
const store={get currentPage(){return page},getTotalCount:()=>4,getPageSize:()=>2,getRange:()=>rows.map(r=>({get:k=>r[k]})),isLoading:()=>loading,nextPage:()=>{page++;load()},previousPage:()=>{page--;load()},reload:()=>load()};
async function load(){loading=true;const r=await fetch('/wgyreport/list?page='+page);if(r.status===401){logged=false;message='登录已失效';document.querySelector('#login').style.display='block';rows=[];loading=false;return;}rows=await r.json();loading=false;}
const grid={getColumns:()=>['0','1','2','3'].map(dataIndex=>({dataIndex})).concat([{xtype:'actioncolumn',items:[{tooltip:'上传'},{tooltip:'报告预览'}]}]),getStore:()=>store,getView:()=>({getNode:()=>document.querySelector('#icons')})};
const button={text:'学生登录',isVisible:()=>!logged,fireEvent:async()=>{const r=await fetch('/wgyreport/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:document.querySelector('#account').value,password:document.querySelector('#password').value})});const data=await r.json();if(!data.ok){message='账号或密码错误';return;}logged=true;document.querySelector('#login').style.display='none';await load();}};
globalThis.Ext={ComponentQuery:{query:q=>q==='grid'?(logged?[grid]:[]):q==='textfield'?(!logged?[{inputType:'password',isVisible:()=>true}]:[]):q==='button'?(!logged?[button]:[]):q==='window'&&message?[{xtype:'messagebox',isVisible:()=>true,el:{dom:{innerText:message}}}]:[]}};
</script></body></html>`;
const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
 const url=new URL(req.url,'http://127.0.0.1:58442');requests.push({path:url.pathname,method:req.method});
 if(url.pathname==='/wgyreport/wgyreport.dll/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 if(url.pathname==='/wgyreport/login'){const data=JSON.parse(body);assert.match(data.account,/^250000000[01]$/);const ok=data.password==='mock-report-password';if(ok)res.setHeader('Set-Cookie','report='+data.account+'; Path=/wgyreport/; HttpOnly');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok}));return;}
 if(url.pathname==='/wgyreport/list'){assert.ok(req.headers.cookie?.includes('report=250000000'));const reply=()=>{if(expired){res.writeHead(401);res.end('expired');return;}const page=Number(url.searchParams.get('page'));const rows=page===1?[{id:'1','0':'2','1':'星期二晚上18:30-20:45','2':'低电阻的测量','3':'<img src="/wgyreport/cache/score.png">'},{id:'2','0':'5','1':'星期五晚上18:30-20:45','2':'电容与高电阻的测量','3':'<img src="/wgyreport/cache/uploaded.png">'}]:[{id:'3','0':'6','1':'星期三下午15:55-18:10','2':'霍尔效应实验','3':'未上传'},{id:'4','0':'7','1':'星期三晚上18:30-20:45','2':'直螺线管磁场分布的测量','3':'<img src="/wgyreport/cache/unknown.png">'}];res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rows));};if(slow)setTimeout(reply,500);else reply();return;}
 if(url.pathname.startsWith('/wgyreport/cache/')){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync('tests/fixtures/report-'+url.pathname.split('/').at(-1)));return;}
 if(url.pathname.includes('upload'))uploads++;res.writeHead(404);res.end();
 });});
const courseServer=http.createServer((req,res)=>{res.setHeader('Connection','close');courseReads++;if(req.headers.cookie?.includes('course=retained'))courseCookie=true;res.setHeader('Set-Cookie','course=retained; Path=/');res.end('<form><input name="login1$StuLoginID"><input name="login1$StuPassword" type="password"></form>');});
await new Promise(r=>server.listen(58442,'127.0.0.1',r));await new Promise(r=>courseServer.listen(58441,'127.0.0.1',r));
let ws,id=0;const jobs=new Map();const call=(method,params={})=>{const seq=++id;return new Promise((resolve,reject)=>{jobs.set(seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}));});};
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result.value;};
const native=(method,args={},plugin='LabReportPortal')=>evaluate(`Capacitor.nativePromise(${JSON.stringify(plugin)},${JSON.stringify(method)},${JSON.stringify(args)}).then(value=>({ok:true,value}),e=>({ok:false,code:e.code,message:e.message}))`);
async function wait(expression){for(let n=0;n<500;n++){if(await evaluate(expression))return;await pause(100);}throw Error('Timed out '+expression);}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function login(account='2500000000',password='mock-report-password'){await evaluate(`document.querySelector('#report-site-account').value=${JSON.stringify(account)};document.querySelector('#report-site-password').value=${JSON.stringify(password)}`);await click('[data-report-site=login]');}
try{
 run('reverse','tcp:58442','tcp:58442');run('reverse','tcp:58441','tcp:58441');run('shell','am','force-stop','com.labmaker.app');run('shell','am','start','-n','com.labmaker.app/.MainActivity');
 for(let n=0;n<60;n++){try{const pid=run('shell','pidof','com.labmaker.app').trim().split(/\s/)[0];run('forward','tcp:9227','localabstract:webview_devtools_remote_'+pid);const tabs=await(await fetch('http://127.0.0.1:9227/json')).json();ws=new WebSocket(tabs.find(t=>t.url.startsWith('https://localhost/')).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});break;}catch(e){if(n===59)throw e;await pause(500);}}
 ws.onmessage=e=>{const m=JSON.parse(e.data),j=jobs.get(m.id);if(j){jobs.delete(m.id);m.error?j.reject(Error(m.error.message)):j.resolve(m.result);}};
 await wait("typeof Capacitor!=='undefined'&&typeof Capacitor.nativePromise==='function'");assert.equal((await native('useMock',{enabled:true})).ok,true);
 await evaluate("location.hash='/school-reports'");await wait("!!document.querySelector('#report-site-account')");await login();
 await wait("document.querySelectorAll('[data-report-row]').length===2 && !document.querySelector('[data-report-site=refresh]').disabled");
 const text=await evaluate("document.querySelector('#report-site-list').innerText");assert.ok(text.includes('4.5'),text);assert.ok(text.includes('已上传'),text);assert.equal(await evaluate("document.querySelectorAll('[data-report-grade] img').length"),0);
 checks.push('Dedicated report WebView logs into mocked Ext grid, reads list and locally OCRs official uploaded sample and numeric score into clear text');
 for(const [width,height] of [[320,640],[360,800],[430,932],[768,1024],[1024,1366],[1280,800]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate("document.querySelector('#report-site-list').scrollIntoView({block:'start'})");await pause(150);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/report-site-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');
 checks.push('Report list fits six phone/tablet viewports with larger score and text status');
 await click('[data-report-site=next]');await wait("document.querySelector('#report-site-list')?.innerText.includes('霍尔效应') && !document.querySelector('[data-report-site=refresh]').disabled");assert.ok(await evaluate("document.querySelector('#report-site-list').innerText.includes('未上传')"));assert.ok(await evaluate("document.querySelector('#report-site-list').innerText.includes('待核实')"));
 checks.push('Official pagination and unuploaded text work; unreadable image remains explicitly unverified');
 await evaluate("window.__reportCard=document.querySelector('[data-report-row]')");await click('[data-report-site=refresh]');await wait("!document.querySelector('[data-report-site=refresh]').disabled");assert.equal(await evaluate("window.__reportCard===document.querySelector('[data-report-row]')"),true);assert.equal(uploads,0);
 assert.equal((await native('commitUpload',{ticket:'missing',confirmed:true})).ok,false);assert.equal(uploads,0);
 checks.push('Refreshing only reads; upload commit without a prepared final-confirmation ticket is rejected');
 assert.equal((await native('useMock',{enabled:true},'LabPortal')).ok,true);const courseFirst=await native('request',{operation:'loginPage'},'LabPortal');assert.equal(courseFirst.ok,true,JSON.stringify(courseFirst));
 expired=true;await click('[data-report-site=refresh]');await wait("!!document.querySelector('#report-site-account')");assert.ok(await evaluate("document.querySelector('#report-site-status').textContent.includes('失效')"));assert.equal(await evaluate("document.querySelectorAll('[data-report-row]').length"),0);expired=false;
 checks.push('Report authentication expiry removes previous account report rows and prompts manual login');
 await login('2500000001','wrong-password');await wait("!!document.querySelector('#report-site-account') && document.querySelector('#report-site-status').textContent.includes('密码错误')");assert.equal(await evaluate("document.querySelectorAll('[data-report-row]').length"),0);
 checks.push('Wrong report password does not resurrect prior report list');
 await login('2500000001');await wait("document.querySelectorAll('[data-report-row]').length===2 && !document.querySelector('[data-report-site=refresh]').disabled");
 slow=true;await click('[data-report-site=refresh]');await click('[data-report-site=clear]');await wait("!!document.querySelector('#report-site-account')");await pause(700);assert.equal(await evaluate("document.querySelectorAll('[data-report-row]').length"),0);
 const courseSecond=await native('request',{operation:'loginPage'},'LabPortal');assert.equal(courseSecond.ok,true,JSON.stringify(courseSecond));assert.equal(courseCookie,true,'Course reads='+courseReads);assert.equal(courseReads,2);
 checks.push('Clearing during report read discards late rows and leaves the independent course CookieJar intact');
 assert.equal(uploads,0);fs.writeFileSync('artifacts/verification/report-site-native.json',JSON.stringify({checks,mocked:true,realSchoolSubmissions:0,uploads,requests:requests.length},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(e){console.error(await evaluate('document.body.innerText').catch(()=>''));console.error(JSON.stringify(requests));throw e;}finally{await native('clear').catch(()=>{});await native('useMock',{enabled:false}).catch(()=>{});await native('clear',{},'LabPortal').catch(()=>{});await native('useMock',{enabled:false},'LabPortal').catch(()=>{});ws?.close();server.closeAllConnections();server.close();courseServer.closeAllConnections();courseServer.close();for(const port of [58441,58442])try{run('reverse','--remove','tcp:'+port);}catch{}}
