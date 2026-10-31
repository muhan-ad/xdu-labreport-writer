import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const out='artifacts/verification/emulator-native-069-1793061441496';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe';
const run=(...args)=>execFileSync(adb,['-s','emulator-5560',...args],{windowsHide:true,maxBuffer:32*1024*1024});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const receipt=JSON.parse(fs.readFileSync(out+'/results.json','utf8'));
let ws;const jobs=new Map();let seq=0;
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{jobs.delete(id);reject(Error('CDP timeout: '+method));},45000);jobs.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params}));});
async function ev(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result?.value;}
async function wait(expression){for(let i=0;i<150;i++){if(await ev(expression))return;await pause(200);}throw Error('UI timeout: '+expression);}
try{
 const info=run('shell','dumpsys','package','com.labmaker.app').toString();assert.ok(info.includes('versionName=0.69.0'));assert.ok(info.includes('versionCode=72'));
 const uid=run('shell','run-as','com.labmaker.app','id').toString().match(/uid=(\d+)/)?.[1];assert.equal(uid,'10216');receipt.beforeUid='10216';receipt.afterUid=uid;receipt.updated=true;
 const pid=run('shell','pidof','com.labmaker.app').toString().trim();run('forward','tcp:9238','localabstract:webview_devtools_remote_'+pid);
 const tabs=await(await fetch('http://127.0.0.1:9238/json')).json();const tab=tabs.find(t=>t.url.startsWith('https://localhost/'));assert.ok(tab);
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const m=JSON.parse(e.data),job=jobs.get(m.id);if(job){jobs.delete(m.id);m.error?job.reject(Error(m.error.message)):job.resolve(m.result);}};
 await wait("!!document.querySelector('.app-header')");
 receipt.nativePlatform=await ev('Capacitor.getPlatform()');assert.equal(receipt.nativePlatform,'android');
 receipt.resourceChecks=[];
 for(let i=0;i<2;i++){const r=await ev(`Capacitor.nativePromise('LabResources','check',{id:crypto.randomUUID()})`);assert.equal(r.complete,true);assert.equal(r.checked,r.total);assert.equal(r.problems.length,0);receipt.resourceChecks.push({checked:r.checked,total:r.total,bytes:r.bytes,complete:r.complete});}
 await ev("location.hash='/ai-skills'");await wait("!!document.querySelector('[data-skill=export]:not([disabled])')");
 await ev("document.querySelector('.skill-card details').open=true;document.querySelector('[data-skill=export]').click()");
 await pause(1200);const activity=run('shell','dumpsys','activity','activities').toString();assert.match(activity,/ChooserActivity/);receipt.skillShareChooserOpened=true;
 fs.writeFileSync(out+'/native-share-chooser.png',run('exec-out','screencap','-p'));
 run('shell','input','keyevent','4');await wait("!!document.querySelector('[data-skill=export]:not([disabled])')");receipt.shareCancelledWithoutSending=true;
 await ev("location.hash='/home'");await pause(700);
 fs.writeFileSync(out+'/native-home.png',run('exec-out','screencap','-p'));
 await ev("location.hash='/settings'");await wait("document.body.textContent.includes('0.69.0')");
 fs.writeFileSync(out+'/native-settings.png',run('exec-out','screencap','-p'));
 run('shell','input','keyevent','4');await pause(500);receipt.nativeBackRoute=await ev('location.hash');
 receipt.completedAt=new Date().toISOString();receipt.acceptance='update, native resource scan twice, native skill share chooser and cancellation, settings and back';
 console.log(JSON.stringify({updated:true,version:'0.69.0',uidRetained:true,resourceChecks:receipt.resourceChecks,shareChooser:true,shareCancelled:true,nativeBackRoute:receipt.nativeBackRoute}));
}catch(error){receipt.error=error.message;throw error;}finally{fs.writeFileSync(out+'/results.json',JSON.stringify(receipt,null,2));ws?.close();run('forward','--remove','tcp:9238');}
