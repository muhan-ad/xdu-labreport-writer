'use strict';
document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>window.courseWindow.control(b.dataset.window));
document.querySelector('.window-bar').ondblclick=e=>{if(!e.target.closest('button'))void window.courseWindow.control('maximize');};
const message=document.getElementById('startupMessage'),retry=document.getElementById('startupRetry'),spinner=document.getElementById('startupSpinner');
function failed(result){message.textContent=result.message||result.error||'服务未能启动，请重试';retry.hidden=false;spinner.hidden=true;retry.disabled=false;}
window.courseWindow.onStartupError(failed);
retry.onclick=async()=>{retry.disabled=true;spinner.hidden=false;message.textContent='正在重新连接…';const result=await window.courseWindow.control('retry');if(!result.ok)failed(result);};
