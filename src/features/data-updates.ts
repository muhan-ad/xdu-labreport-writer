import {dataUpdates} from '../platform/data-updates.ts';import type {DataEnvelope} from '../domain/data-update-store.ts';import {MAX_DATA_BYTES} from '../domain/data-package.ts';
import type {DataManifest} from '../domain/data-package.ts';
interface Port {
 status:()=>Promise<{version:string;sessionVersion:string;highestVersion:string;warning:string}>;
 inspect:(envelope:DataEnvelope)=>Promise<{version:string;bytes:number;notes:string}>;
 install:(envelope:DataEnvelope,signal:AbortSignal,progress:(s:string)=>void,commit:()=>void)=>Promise<{committed:boolean;version:string;degraded:boolean}>;
 restore:()=>Promise<{committed:boolean;version:string;degraded?:boolean}>;reload:()=>void;
 confirm:(title:string,body:string)=>Promise<boolean>;
 onlineAvailable?:()=>boolean;
 checkOnline?:(signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<{state:'unpublished'|'current'|'available';manifest?:DataManifest}>;
 download?:(manifest:DataManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<{envelope:DataEnvelope;summary:{version:string;bytes:number;notes:string}}>;
}
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class DataUpdatesView {
 private host:HTMLElement|null=null;private lifetime:AbortController|null=null;private token=0;private busy=false;private committing=false;private controller:AbortController|null=null;
 private envelope:DataEnvelope|null=null;private prepared:{version:string;bytes:number;notes:string}|null=null;
 private remote:DataManifest|null=null;
 constructor(private port:Port={...dataUpdates,confirm:async()=>false}){}
 get isSaving(){return this.busy;}
 leave(){this.token++;this.controller?.abort();this.controller=null;this.lifetime?.abort();this.host=null;this.busy=false;this.committing=false;}
 mount(host:HTMLElement){
  this.leave();this.host=host;this.envelope=null;this.prepared=null;this.remote=null;this.lifetime=new AbortController();const scope=this.token,online=!!this.port.checkOnline&&(this.port.onlineAvailable?.()??true);
  host.innerHTML=`<section class="panel"><h2>实验数据更新</h2><p data-update-version></p><div class="ai-inline"><button class="button" data-update="online" ${online?'':'hidden'}>检查在线更新</button><button class="button secondary" data-update="status">重新读取状态</button><button class="button secondary" data-update="restore">恢复内置资源</button></div><details ${online?'':'open'}><summary>从文件导入</summary><p>同时选择签名清单和对应数据包（两个 JSON 文件）。</p><button class="button secondary" data-update="pick">导入签名更新包</button></details><input data-update-files type="file" accept="application/json,.json" multiple hidden><div data-update-summary></div><p data-update-status role="status"></p><div class="ai-inline"><button class="button" data-update="download" hidden>下载并核对</button><button class="button" data-update="apply" hidden>检查并启用</button><button class="button secondary" data-update="stop" hidden>停止</button><button class="button" data-update="reload" hidden>重新载入生效</button></div></section>`;
  host.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-update]');if(b&&!b.disabled)void this.action(b.dataset.update!).catch(error=>{if(scope===this.token)this.message((error as Error).message);});},{signal:this.lifetime.signal});
  host.addEventListener('change',e=>{if((e.target as HTMLElement).hasAttribute('data-update-files')){const input=e.target as HTMLInputElement,files=Array.from(input.files??[]);input.value='';if(files.length)void this.prepare(files).catch(error=>{if(scope===this.token)this.message((error as Error).message);});}},{signal:this.lifetime.signal});void this.readStatus().catch(error=>{if(scope===this.token)this.message((error as Error).message);});
 }

 private message(text:string){const node=this.host?.querySelector('[data-update-status]');if(node)node.textContent=text;}
 private controls(){this.host?.querySelectorAll<HTMLButtonElement>('[data-update]').forEach(b=>{b.disabled=this.busy;if(b.dataset.update==='stop'){b.hidden=!this.controller;b.disabled=this.committing;}if(b.dataset.update==='apply')b.hidden=!this.prepared;if(b.dataset.update==='download')b.hidden=!this.remote||!this.port.download;});}
 private async readStatus(){if(!this.host||this.busy)return;const token=this.token;this.busy=true;this.controls();try{await this.refreshStatus(token);}finally{if(token===this.token){this.busy=false;this.controls();}}}
 private async refreshStatus(token:number){const s=await this.port.status();if(token!==this.token||!this.host)return;this.host.querySelector('[data-update-version]')!.textContent='本次运行：'+(s.sessionVersion==='0.0.0'?'内置资源':s.sessionVersion)+(s.version!==s.sessionVersion?' · 已准备 '+(s.version==='0.0.0'?'内置资源':s.version):'');this.host.querySelector<HTMLButtonElement>('[data-update=reload]')!.hidden=s.version===s.sessionVersion;if(s.warning)this.message(s.warning);return s;}
 private async prepare(files:File[]){
  if(this.busy||!this.host)return;if(files.length!==2||files.reduce((sum,f)=>sum+f.size,0)>MAX_DATA_BYTES+65536)throw Error('请选择签名清单及对应数据包，共两个 JSON 文件，合计不超过 8 MB');
  const token=this.token;this.busy=true;this.envelope=null;this.prepared=null;this.remote=null;this.controls();this.host.querySelector('[data-update-summary]')!.innerHTML='';this.message('正在核对签名、资源和版本…');
  try{let manifest:DataEnvelope['manifest']|undefined,body:string|undefined;
   for(const file of files){const text=await file.text();if(token!==this.token)return;const raw=JSON.parse(text);if(raw&&typeof raw==='object'&&('signature' in raw||'url' in raw||'minAppVersion' in raw)){if(manifest||file.size>65536)throw Error('签名清单不唯一或过大');manifest=raw;}else{if(body!==undefined)throw Error('未找到唯一数据包');body=text;}}
   if(!manifest||body===undefined)throw Error('请选择签名清单及对应数据包');const envelope={manifest,body},prepared=await this.port.inspect(envelope);if(token!==this.token||!this.host)return;this.envelope=envelope;this.prepared=prepared;this.host.querySelector('[data-update-summary]')!.innerHTML=`<h3>数据版本 ${esc(prepared.version)}</h3><p>${(prepared.bytes/1024/1024).toFixed(2)} MB</p>${prepared.notes?`<details open><summary>更新说明</summary><pre class="ai-history-original">${esc(prepared.notes)}</pre></details>`:''}`;this.message('签名和资源核对通过，启用前还会检查离线运行环境');
  }finally{if(token===this.token){this.busy=false;this.controls();}}
 }
 private summary(summary:{version:string;bytes:number;notes:string}){if(this.host)this.host.querySelector('[data-update-summary]')!.innerHTML=`<h3>数据版本 ${esc(summary.version)}</h3><p>${(summary.bytes/1024/1024).toFixed(2)} MB</p>${summary.notes?`<details open><summary>更新说明</summary><pre class="ai-history-original">${esc(summary.notes)}</pre></details>`:''}`;}
 private async online(action:'online'|'download'){
  if(this.busy||!this.host)return;if(!this.port.checkOnline||!this.port.download)throw Error('当前平台的在线更新尚未接入');
  const token=this.token,controller=new AbortController(),remote=this.remote;this.controller=controller;this.busy=true;
  if(action==='online'){this.remote=null;this.envelope=null;this.prepared=null;this.host.querySelector('[data-update-summary]')!.innerHTML='';}
  this.controls();this.message(action==='online'?'正在检查在线更新…':'正在下载已核实签名的数据包…');
  try{
   const progress=(bytes:number,total:number)=>{if(token===this.token&&this.controller===controller&&!controller.signal.aborted&&action==='download')this.message(`正在下载 ${(bytes/1024/1024).toFixed(2)}${total?' / '+(total/1024/1024).toFixed(2):''} MB`);};
   if(action==='online'){
    const result=await this.port.checkOnline(controller.signal,progress);if(token!==this.token)return;if(controller.signal.aborted){this.message('在线更新已停止，当前资源未更改');return;}
    if(result.state==='unpublished')this.message('暂未发布手机版实验数据包，当前资源继续使用');
    else {if(!result.manifest)throw Error('更新清单未能核实');this.summary({version:result.manifest.dataVersion,bytes:result.manifest.size,notes:result.manifest.notes});
     if(result.state==='available'){this.remote=result.manifest;this.message('发现可用数据版本，下载后还会核对完整资源');}
     else {const status=await this.refreshStatus(token);if(token===this.token)this.message(status&&status.version!==status.sessionVersion?'该版本已准备，重新载入后生效':'当前数据已是该版本');}
    }
   }else {
    if(!remote)throw Error('请先检查并核实在线更新');const result=await this.port.download(remote,controller.signal,progress);if(token!==this.token)return;if(controller.signal.aborted){this.message('在线更新已停止，当前资源未更改');return;}this.envelope=result.envelope;this.prepared=result.summary;this.remote=null;this.summary(result.summary);this.message('下载和资源核对通过，请检查并启用');
   }
  }catch(error){if(token===this.token)this.message(controller.signal.aborted?'在线更新已停止，当前资源未更改':(error as Error).message);}
  finally{if(token===this.token){this.controller=null;this.busy=false;this.controls();}}
 }
 private async action(action:string){
  if(action==='stop'){if(!this.committing){this.controller?.abort();this.message('正在停止更新检查…');}return;}if(this.busy)return;
  if(action==='online'||action==='download')return this.online(action);
  if(action==='pick'){this.host?.querySelector<HTMLInputElement>('[data-update-files]')?.click();return;}if(action==='reload'){this.port.reload();return;}if(action==='status')return this.readStatus();
  if(action!=='apply'&&action!=='restore')return;const token=this.token;this.busy=true;this.controls();
  try{
   if(action==='restore'){
    if(!await this.port.confirm('恢复内置实验资源？','恢复当前安装包内的实验资源。测量数据、照片、已生成报告及自建内容保留；重新载入后生效。')||token!==this.token)return;
    this.committing=true;this.controls();const restored=await this.port.restore();if(token!==this.token)return;this.envelope=null;this.prepared=null;this.remote=null;this.host?.querySelector('[data-update-summary]')?.replaceChildren();this.message('已恢复内置资源，重新载入后生效'+(restored.degraded?'；状态备份副本未完成，请重新读取核对':''));
   }else{
    if(!this.envelope||!this.prepared)throw Error('请先导入并核对签名更新包');
    if(!await this.port.confirm('检查并启用数据 '+this.prepared.version+'？','离线运行检查通过后切换实验资源；测量数据、照片、已生成报告及自建内容保留。重新载入后生效。')||token!==this.token)return;
    const controller=new AbortController();this.controller=controller;this.controls();
    const result=await this.port.install(this.envelope,controller.signal,text=>{if(token===this.token)this.message(text);},()=>{if(token===this.token){this.committing=true;this.controls();this.message('正在保存资源切换状态…');}});
    if(token!==this.token)return;if(!result.committed)throw Error('资源尚未启用');this.message('数据 '+result.version+' 已准备，重新载入后生效'+(result.degraded?'；状态备份副本未完成，重新读取后核对':''));
   }
   const status=await this.refreshStatus(token);if(status&&!status.warning&&status.version===status.sessionVersion)this.message(status.version==='0.0.0'?'当前已使用内置资源':'当前已使用该数据版本 '+status.version);
  }catch(error){if(token===this.token)this.message(this.controller?.signal.aborted?'已停止，重新读取状态可核对当前资源':(error as Error).message);}
  finally{if(token===this.token){this.controller=null;this.committing=false;this.busy=false;this.controls();}}
 }
}
