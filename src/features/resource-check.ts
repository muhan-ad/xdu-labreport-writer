import {resources,type ResourcePort,type ResourceProgress,type ResourceResult} from '../platform/resources.ts';
import type {RuntimeDiagnostic} from '../engine/client.ts';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Mode='check'|'diagnose'|'refresh';
export class ResourceCheck {
 private host:HTMLElement|null=null;private run=0;private id='';private listener:{remove:()=>Promise<void>}|null=null;private lifetime:AbortController|null=null;
 private result:ResourceResult|null=null;private runtime:RuntimeDiagnostic|null=null;private mode:Mode|null=null;private cancelled=false;private ready=false;
 constructor(private notice:(s:string)=>void,private port:ResourcePort=resources,private confirm:()=>Promise<boolean>=async()=>true){}
 get isSaving(){return this.mode==='refresh';}
 leave(){this.run++;const id=this.id;this.id='';this.mode=null;this.cancelled=true;this.ready=false;this.host=null;this.lifetime?.abort();this.lifetime=null;if(id)void this.port.cancel(id).catch(()=>{});this.port.stopDiagnostic();void this.listener?.remove().catch(()=>{});this.listener=null;}
 mount(host:HTMLElement){
  this.leave();this.host=host;this.result=null;this.runtime=null;this.cancelled=false;this.lifetime=new AbortController();const run=this.run;
  host.innerHTML='<section class="panel"><h2>实验资源维护</h2><div class="resource-actions"><button class="button" data-resource="check">检查资源完整性</button><button class="button secondary" data-resource="diagnose">检查报告运行环境</button><button class="button secondary" data-resource="refresh">刷新运行缓存</button><button class="button secondary" data-resource="cancel" hidden>停止</button><button class="button secondary" data-resource="export" hidden>导出结果</button></div><div id="resource-result" role="status" aria-live="polite">尚未检查</div></section>';
  host.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-resource]');if(!b||b.disabled)return;const action=b.dataset.resource;void (action==='cancel'?this.cancel():action==='export'?this.port.export({installed:this.result,runtime:this.runtime}):this.check(action as Mode)).catch(e=>this.notice((e as Error).message));},{signal:this.lifetime.signal});
  if(!['android','ios'].includes(this.port.platform())){this.message('当前平台的安装资源维护尚未接入');this.controls();return;}
  if(this.port.platform()==='ios'){host.querySelector<HTMLElement>('[data-resource=refresh]')!.hidden=true;host.querySelector('#resource-result')!.insertAdjacentHTML('beforebegin','<p class="muted">检查页面和报告资源；不包含系统与原生组件。</p>');}
  this.controls();
  void this.port.progress(p=>{if(run!==this.run||p.id!==this.id||!this.mode||this.cancelled||!this.host)return;this.progress(p);}).then(listener=>{if(run!==this.run){void listener.remove().catch(()=>{});return;}this.listener=listener;this.ready=true;this.controls();}).catch(()=>this.message('资源检查接口未能就绪，请重新打开此页面'));
 }
 private message(text:string){const node=this.host?.querySelector('#resource-result');if(node)node.textContent=text;}
 private progress(p:ResourceProgress){const node=this.host?.querySelector('#resource-result');if(!node||!Number.isFinite(p.total)||!Number.isFinite(p.checked))return;node.innerHTML=`<p>正在核对 ${p.checked} / ${p.total} 个${this.port.platform()==='ios'?'共享资源':'安装文件'}</p><progress max="${p.total||1}" value="${p.checked}" aria-label="资源检查进度"></progress><p class="resource-path">${esc(p.path)}</p>`;}
 private controls(){if(!this.host)return;this.host.querySelectorAll<HTMLButtonElement>('[data-resource]').forEach(b=>{const action=b.dataset.resource;b.disabled=action==='cancel'?false:!!this.mode||!this.ready;if(action==='cancel')b.hidden=!this.mode;if(action==='export')b.hidden=!this.result||!!this.mode;});}
 private async cancel(){if(!this.mode)return;this.cancelled=true;this.port.stopDiagnostic();this.message('正在停止…');await this.port.cancel(this.id);}
 private complete(r:ResourceResult){return r.complete&&!r.cancelled&&r.checked===r.total&&r.total>0&&r.problems.length===0;}
 private render(){
  if(!this.host||!this.result)return;const r=this.result,complete=this.complete(r),runtime=this.runtime;
  const shared=r.scope==='shared',okay=complete&&(!runtime||runtime.complete),title=this.cancelled||r.cancelled?'检查已停止':!complete?(shared?'共享资源不完整':'安装资源不完整'):runtime?runtime.complete?(r.cacheCleared?'缓存已刷新，报告运行环境可用':'报告运行环境可用'):'报告运行环境异常':shared?'共享资源完整':'资源完整';
  this.host.querySelector('#resource-result')!.innerHTML=`<p class="${okay&&!this.cancelled?'resource-ok':'ocr-warning'}"><strong>${esc(title)}</strong></p><p>已核对 ${r.checked} / ${r.total} 个${shared?'共享资源':'安装文件'} · ${(r.bytes/1024/1024).toFixed(1)} MB</p>${runtime?`<p>已检查 ${runtime.experiments} 个实验、${runtime.scripts} 个脚本、${runtime.templates} 份变体模板</p>`:''}${this.problems(r.problems,shared?'共享资源异常':'安装资源异常')}${this.problems(runtime?.problems??[],'运行环境异常')}${!complete&&!r.cancelled?'<p>资源无法在应用内替换。请先备份，再重新安装完整应用。</p>':''}`;
 }
 private problems(rows:{path:string;reason:string}[],title:string){return rows.length?`<details open><summary>${title} ${rows.length} 项</summary><ul class="resource-problems">${rows.map(p=>`<li><strong>${esc(p.reason)}</strong><br><span>${esc(p.path)}</span></li>`).join('')}</ul></details>`:'';}
 private async check(mode:Mode){
  if(this.mode||!this.ready||!this.host||!['check','diagnose','refresh'].includes(mode))return;
  const run=this.run,id=crypto.randomUUID();this.id=id;this.mode=mode;this.cancelled=false;this.result=null;this.runtime=null;this.controls();
  const current=()=>run===this.run&&this.id===id&&!!this.host;
  try{
   if(mode==='refresh'&&!await this.confirm())return;if(!current())return;if(this.cancelled){this.message('检查已停止');return;}
   this.message(mode==='refresh'?'正在核对安装资源，随后刷新临时运行缓存…':'正在读取安装资源清单…');
   const result=await this.port.check(id,mode==='refresh');if(!current())return;
   if(result.id!==id||!Array.isArray(result.problems)||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.checked)||result.checked<0||result.total<1||result.checked>result.total||!Number.isFinite(result.bytes)||result.bytes<0)throw Error('资源检查结果无效，请重试');
   this.result=result;if(this.cancelled){this.render();return;}
   if(mode!=='check'&&this.complete(result)){
    if(mode==='refresh'&&!result.cacheCleared)throw Error('安装资源完整，但运行缓存未确认刷新，请重试');
    this.message(result.cacheCleared?'缓存已刷新，正在重新启动报告运行环境…':'正在启动离线报告运行环境…');
    const runtime=await this.port.diagnose(text=>{if(current()&&!this.cancelled)this.message(text);});
    if(!current())return;if(!this.cancelled){if(!Array.isArray(runtime.problems)||!Number.isSafeInteger(runtime.experiments)||runtime.experiments<1||!Number.isSafeInteger(runtime.templates)||!Number.isSafeInteger(runtime.scripts)||runtime.templates<0||runtime.scripts<1||(runtime.complete&&(runtime.problems.length||runtime.templates!==runtime.experiments)))throw Error('运行环境检查结果无效，请重试');this.runtime=runtime;}
   }
   if(current())this.render();
  }catch(e){if(current())this.message(this.cancelled?'检查已停止':(this.result?.cacheCleared?'缓存已刷新；':'')+'未能完成检查：'+(e as Error).message);}
  finally{if(current()){this.mode=null;this.id='';this.controls();}}
 }
}
