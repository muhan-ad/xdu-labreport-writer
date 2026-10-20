'use strict';
(async()=>{
 if(window!==window.top)return;
 if(location.protocol==='https:'&&location.hostname==='ehall.xidian.edu.cn'){
  chrome.runtime.sendMessage({type:'academic-login-ready'}).catch(()=>{});return;
 }
 if(location.protocol!=='http:'||location.hostname!=='127.0.0.1'||location.pathname!=='/academic-connect')return;
 const hello=await chrome.runtime.sendMessage({type:'bridge-hello',token:location.hash.slice(1)}).catch(()=>null);
 if(!hello?.ok)return;
 history.replaceState(null,'',location.pathname);document.documentElement.dataset.bridgeAttached='true';
 const token=hello.token,client=crypto.randomUUID();let active=null,reading=false,closed=false,retryRequested=false;
 const show=text=>{const node=document.getElementById('bridgeStatus');if(node)node.textContent=text;};
 async function post(path,data){const response=await fetch('/api/browser-bridge/'+path,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Lab-Bridge':token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok){const error=Error(result.error||'连接已失效，请回到应用重新连接');error.code=result.code;throw error;}return result;}
 async function read(){
  if(!active)return;if(reading){retryRequested=true;return;}reading=true;const job=active;
  try{show('正在读取浏览器中的教务课表…');const result=await chrome.runtime.sendMessage({type:'read-timetable',account:job.account,interactive:job.interactive});
   const saved=await post('result',{jobId:job.id,result});
   if(saved.done){active=null;show(saved.message||'读取已结束，请返回应用查看课表状态。');}
   else show('请在教务网页完成登录；登录完成后自动同步，无需复制账号或密码。');
  }catch(error){if(error.code==='JOB_EXPIRED'||error.code==='TIMETABLE_INVALID')active=null;show(error.message);}finally{reading=false;if(retryRequested){retryRequested=false;void read();}}
 }
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==='academic-login-ready')void read();});
 document.getElementById('retryBridge')?.addEventListener('click',()=>void read());
 show('浏览器扩展已连接，等待课表同步任务…');
 while(!closed){try{const response=await post('poll',{client});if(response.job){active=response.job;void read();}}catch(error){show(error.message);closed=true;}}
})();
