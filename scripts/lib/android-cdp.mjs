import {execFileSync} from 'node:child_process';
export const android=(...a)=>execFileSync('E:/tools/app-maker/android-sdk/platform-tools/adb.exe',['-s','emulator-5560',...a],{windowsHide:true,maxBuffer:32*1024*1024});
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function connectAndroid(port=9241,userId=Number(android('shell','am','get-current-user').toString().trim()),packageName='com.labmaker.app'){
 if(!/^com\.labmaker\.app(?:\.acceptance)?$/.test(packageName))throw Error('Unsupported acceptance package');
 const rows=android('shell','ps','-A','-o','PID,UID,NAME').toString().trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/));const pid=rows.find(row=>row[2]===packageName&&Math.floor(Number(row[1])/100000)===userId)?.[0];if(!pid||!/^\d+$/.test(pid))throw Error('Target app not running for requested Android user');android('forward','tcp:'+port,'localabstract:webview_devtools_remote_'+pid);
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(10000)})).json(),target=tabs.find(t=>t.url.startsWith('https://localhost/'));if(!target)throw Error('Target WebView missing');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const jobs=new Map(),listeners=new Set();
 ws.onmessage=e=>{const m=JSON.parse(e.data),job=jobs.get(m.id);if(job){jobs.delete(m.id);m.error?job.reject(Error(m.error.message)):job.resolve(m.result)}else if(m.method)for(const fn of listeners)fn(m)};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{jobs.delete(id);reject(Error('CDP timeout '+method))},45000);jobs.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result?.value};
 const wait=async(expression,limit=200)=>{for(let i=0;i<limit;i++){if(await ev(expression))return;await pause(150)}throw Error('UI timeout: '+expression)};
 return {pid,userId,call,ev,wait,onEvent:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},click:s=>ev(`document.querySelector(${JSON.stringify(s)}).click()`),close:()=>{ws.close();android('forward','--remove','tcp:'+port)}};
}
