import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe',serial='emulator-5560';
const run=(...a)=>execFileSync(adb,['-s',serial,...a],{encoding:'utf8',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];let requests=0,ws,seq=0,ownedConfig=false;const progressBackups=new Map();
const dummy='dummy-tutorial-key-not-a-real-credential';
const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{requests++;assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer '+dummy);const payload=JSON.parse(body);assert.equal(payload.model,'deepseek-flash');assert.equal(Array.isArray(payload.messages[0].content),requests===2);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));});});
await new Promise(r=>server.listen(58440,'127.0.0.1',r));
const jobs=new Map();
const call=(method,params={})=>{const id=++seq;return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});};
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result.value;}
const native=(method,args)=>evaluate(`Capacitor.nativePromise('LabAI',${JSON.stringify(method)},${JSON.stringify(args)})`);
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Timed out '+expression);}
const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait("document.querySelector('#ai-tutorial')?.getAttribute('aria-busy')!=='true'");};
const filesystem=(method,args)=>evaluate(`Capacitor.nativePromise('Filesystem',${JSON.stringify(method)},${JSON.stringify(args)})`);
async function readProgress(){const entries=[];for(const slot of ['a','b']){try{const r=await filesystem('readFile',{path:'lab-maker/v1/api-tutorial-'+slot+'.json',directory:'LIBRARY_NO_CLOUD'});entries.push(JSON.parse(Buffer.from(r.data,'base64').toString()));}catch{}}return entries.sort((a,b)=>b.revision-a.revision)[0]?.payload;}

async function connect(){for(let i=0;i<60;i++){try{const pid=run('shell','pidof','com.labmaker.app').trim().split(/\s/)[0];run('forward','tcp:9227','localabstract:webview_devtools_remote_'+pid);const tabs=await(await fetch('http://127.0.0.1:9227/json')).json();ws=new WebSocket(tabs.find(t=>t.url.startsWith('https://localhost/')).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const v=JSON.parse(e.data),job=jobs.get(v.id);if(job){jobs.delete(v.id);v.error?job.reject(Error(v.error.message)):job.resolve(v.result);}};return;}catch(e){if(i===59)throw e;await pause(500);}}}
async function config(){await wait("!!document.querySelector('.app-header')");await evaluate("location.hash='/settings'");await wait("!!document.querySelector('[data-action=ai-config]')");await click('[data-action=ai-config]');await wait("document.querySelector('#ai-config-fields')?.disabled===false");}
async function screenshots(step){for(const [width,height] of [[320,640],[360,800],[430,932],[768,1024],[1024,1366],[1280,800]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(100);assert.ok(await evaluate("document.querySelector('#ai-sheet').getBoundingClientRect().width<=innerWidth && document.querySelector('.ai-body').scrollWidth<=document.querySelector('.ai-body').clientWidth+1"));const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/tutorial-${step}-${width}.png`,Buffer.from(shot.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');}
try{
 run('reverse','tcp:58440','tcp:58440');run('shell','am','force-stop','com.labmaker.app');run('shell','am','start','-n','com.labmaker.app/.MainActivity');await connect();await wait("typeof Capacitor!=='undefined'");
 assert.equal((await native('status',{slot:'chat'})).hasKey,false,'Use a test emulator with no existing chat key');
 assert.equal((await native('status',{slot:'vision',inheritChat:false})).hasKey,false);
 assert.equal((await native('status',{slot:'vision'})).inheritsChat,false);
 for(const slot of ['a','b']){const path='lab-maker/v1/api-tutorial-'+slot+'.json';let data=null;try{data=(await filesystem('readFile',{path,directory:'LIBRARY_NO_CLOUD'})).data;}catch{}progressBackups.set(path,data);await filesystem('writeFile',{path,directory:'LIBRARY_NO_CLOUD',data:Buffer.from('{broken').toString('base64'),recursive:true});}
 await config();await evaluate(`window.__fields=document.querySelector('#ai-config-fields');document.querySelector('#ai-key').value=${JSON.stringify(dummy)};document.querySelector('#ai-model').value='unsaved-model';document.querySelector('#ai-endpoint').value='https://example.test/v1';window.__originalNative=Capacitor.nativePromise;window.__external=[];window.__apiAttempts=0;Capacitor.nativePromise=function(plugin,method,args){if(plugin==='Browser'&&method==='open'){window.__external.push(args.url);return Promise.resolve({});}if(plugin==='LabAI'&&method==='complete'){window.__apiAttempts++;if(!window.__allowApiRequest)throw Error('Unexpected API request');}return window.__originalNative.call(this,plugin,method,args);};`);
 await click('[data-ai=tutorial-open]');assert.equal(await evaluate("document.querySelector('.tutorial-progress').textContent"),'已阅读 0 / 4 步');await screenshots('intro');
 await click('[data-ai=tutorial-link-platform]');assert.deepEqual(await evaluate('window.__external'),['https://platform.deepseek.com/usage']);assert.equal(requests,0);
 checks.push('Corrupt progress safely resets; tutorial links open only the intended official browser URL and no model request');
 await click('[data-ai=tutorial-step-1]');
 assert.equal(await evaluate("document.querySelector('#tutorial-title').textContent"),'充值余额');
 await click('[data-ai=tutorial-step-3]');
 assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#ai-tutorial input,#ai-tutorial select'),n=>n.id)"),['ai-tutorial-key']);
 assert.equal(await evaluate("document.querySelector('#ai-tutorial-key').value"),'');
 assert.equal(await evaluate("window.__fields===document.querySelector('#ai-config-home #ai-config-fields')"),true);
 await screenshots('config');
 assert.equal(requests,0);
 checks.push('Tutorial only shows a separate password field and preserves the ordinary configuration draft');
 await evaluate("document.activeElement.blur()");run('shell','input','keyevent','4');
 await wait("document.querySelector('#ai-sheet').open && document.querySelector('#ai-tutorial').hidden");
 assert.equal(await evaluate("document.querySelector('#ai-key').value"),dummy);
 await click('[data-ai=tutorial-open]');await click('[data-ai=tutorial-reset]');
 for(let i=0;i<4;i++)await click('[data-ai=tutorial-next]');
 assert.deepEqual(await readProgress(),[0,1,2,3]);
 await click('[data-ai=tutorial-open]');
 await evaluate(`document.querySelector('#ai-tutorial-key').value=${JSON.stringify(dummy)};
  window.__allowApiRequest=true;const bridge=Capacitor.nativePromise;
  Capacitor.nativePromise=function(plugin,method,args){
   if(plugin==='LabAI'&&method==='complete'){
    if(args.draft.endpoint!=='https://api.deepseek.com'||args.draft.model!=='deepseek-flash')throw Error('Unexpected tutorial configuration');
    args={...args,draft:{...args.draft,endpoint:'http://127.0.0.1:58440/v1'}};
   }
   return bridge.call(this,plugin,method,args);
  };`);
 await click('[data-ai=tutorial-test]');
 await wait("document.querySelector('#ai-tutorial-message').textContent.includes('均成功')");
 assert.equal(requests,2);
 assert.equal((await native('status',{slot:'chat'})).hasKey,false);
 ownedConfig=true;await click('[data-ai=tutorial-save-key]');
 await wait("document.querySelector('#ai-message')?.textContent.includes('共用 DeepSeek')");
 const chat=await native('status',{slot:'chat'}),vision=await native('status',{slot:'vision'});
 assert.equal(chat.model,'deepseek-flash');assert.equal(vision.model,chat.model);assert.equal(vision.inheritsChat,true);
 assert.equal((await native('status',{slot:'vision',inheritChat:false})).hasKey,false);
 assert.equal(await evaluate("document.querySelector('#ai-key').value"),'');
 assert.equal(JSON.stringify(await readProgress()).includes(dummy),false);
 checks.push('Two explicit requests reach the local mock with text and image; encrypted save sets one key and inherited vision');
 await click('[data-ai=close]');await click('[data-action=ai-tutorial]');await wait("document.querySelector('#ai-config-fields')?.disabled===false");assert.equal(await evaluate("document.querySelector('#ai-tutorial').hidden"),false);await evaluate("document.querySelector('#ai-sheet').dispatchEvent(new Event('cancel',{cancelable:true}))");assert.equal(await evaluate("document.querySelector('#ai-tutorial').hidden && document.querySelector('#ai-sheet').open"),true);checks.push('Settings tutorial entry opens guidance directly; Escape returns to configuration');
 assert.equal(requests,2);fs.writeFileSync('artifacts/verification/tutorial-native.json',JSON.stringify({checks,mocked:true,modelRequests:requests,paidApiCalls:0,widths:[320,360,430,768,1024,1280]},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{
 if(ws?.readyState===1){if(ownedConfig){await native('clear',{slot:'vision'}).catch(()=>{});await native('clear',{slot:'chat'}).catch(()=>{});}for(const [path,data] of progressBackups){if(data===null)await filesystem('deleteFile',{path,directory:'LIBRARY_NO_CLOUD'}).catch(()=>{});else await filesystem('writeFile',{path,directory:'LIBRARY_NO_CLOUD',data,recursive:true}).catch(()=>{});}ws.close();}
 server.closeAllConnections();server.close();try{run('reverse','--remove','tcp:58440');}catch{}
}
