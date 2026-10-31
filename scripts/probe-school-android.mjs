// Anonymous, read-only requests through the APK's actual Android network stack. No login POST.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe';
const run=(...args)=>execFileSync(adb,['-s','emulator-5560',...args],{encoding:'utf8',windowsHide:true});
const pid=run('shell','pidof','com.labmaker.app').trim().split(/\s/)[0];
run('forward','tcp:9227','localabstract:webview_devtools_remote_'+pid);
const tabs=await (await fetch('http://127.0.0.1:9227/json')).json();
const socket=new WebSocket(tabs.find(t=>t.url.startsWith('https://localhost/')).webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
const jobs=new Map();let seq=0;
socket.onmessage=e=>{const value=JSON.parse(e.data),job=jobs.get(value.id);if(job){jobs.delete(value.id);value.error?job.reject(Error(value.error.message)):job.resolve(value.result);}};
async function evaluate(expression){const id=++seq;const result=await new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.exceptionDetails)throw Error('WebView evaluation failed');return result.result.value;}
try {
  await evaluate("Capacitor.nativePromise('LabPortal','useMock',{enabled:false})");
  const login=await evaluate("Capacitor.nativePromise('LabPortal','request',{operation:'loginPage'}).then(r=>({ok:true,hasLoginForm:r.html.includes('login1$StuPassword'),hasChinese:r.html.includes('学生')}),e=>({ok:false,code:e.code,message:e.message}))");
  const protectedPage=await evaluate("Capacitor.nativePromise('LabPortal','request',{operation:'overview'}).then(()=>({ok:true}),e=>({ok:false,code:e.code,message:e.message}))");
  fs.writeFileSync('artifacts/verification/school-anonymous-probe.json',JSON.stringify({checkedAt:new Date().toISOString(),realReadOnlyOperations:2,credentialsSubmitted:false,login,protectedPage},null,2));
  console.log(JSON.stringify({login,protectedPage},null,2));
  assert.equal(login.ok,true);assert.equal(login.hasLoginForm,true);
  assert.equal(protectedPage.code,'AUTH');
} finally {await evaluate("Capacitor.nativePromise('LabPortal','clear',{})").catch(()=>{});socket.close();}
