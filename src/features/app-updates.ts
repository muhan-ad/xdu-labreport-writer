import {appUpdates} from '../platform/app-updates.ts';import type {AppManifest,InstalledApp} from '../domain/app-update.ts';
export interface AppUpdatePort{
 available:()=>boolean;info:()=>Promise<InstalledApp&{hasCache:boolean}>;clear:()=>Promise<void>;settings:()=>Promise<void>;
 check:(signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<{state:'unpublished'|'current'|'available'|'system-old';manifest?:AppManifest}>;
 download:(manifest:AppManifest,signal:AbortSignal,progress:(bytes:number,total:number)=>void)=>Promise<string>;
 install:(manifest:AppManifest,candidateId:string)=>Promise<{state:'permission-required'|'opened'}>;
 confirm:(title:string,body:string)=>Promise<boolean>;
}
export class AppUpdatesView{
 private port:AppUpdatePort;private host:HTMLElement|null=null;private life:AbortController|null=null;private controller:AbortController|null=null;private generation=0;private busy=false;private ready=false;private cached=false;private permission=false;private manifest:AppManifest|null=null;private candidate:string|null=null;private updateAvailable=false;
 constructor(port:AppUpdatePort={...appUpdates,confirm:async()=>false}){this.port=port;}
 get isSaving(){return this.busy;}
 leave(){this.generation++;this.controller?.abort();this.controller=null;this.life?.abort();this.host=null;this.busy=false;}
 mount(host:HTMLElement){
  this.leave();this.host=host;this.life=new AbortController();const generation=this.generation;this.busy=true;this.ready=false;
  host.innerHTML='<section class="panel"><h2>应用更新</h2><p data-app-version></p><div class="ai-inline"><button class="button" data-app-update="check">检查应用更新</button><button class="button secondary" data-app-update="clear" hidden>清理下载缓存</button><button class="button secondary" data-app-update="stop" hidden>停止</button></div><div data-app-summary></div><pre class="app-update-notes" data-app-notes></pre><div class="ai-inline"><button class="button" data-app-update="download" hidden>下载安装包</button><button class="button" data-app-update="install" hidden>安装更新</button><button class="button secondary" data-app-update="settings" hidden>打开系统安装授权</button></div><p data-app-status role="status"></p></section>';
  host.addEventListener('click',e=>{const action=(e.target as Element).closest<HTMLButtonElement>('[data-app-update]')?.dataset.appUpdate;if(action==='stop'){this.controller?.abort();return;}if(action)void this.action(action);},{signal:this.life.signal});
  this.controls();if(!this.port.available()){this.busy=false;this.message('当前平台暂不支持应用内更新');this.controls();return;}
  void this.port.info().then(info=>{if(generation!==this.generation)return;this.cached=info.hasCache;if(!info.hasCache)this.candidate=null;host.querySelector('[data-app-version]')!.textContent='当前版本：'+info.version;this.ready=true;this.summary();}).catch(()=>{if(generation===this.generation)this.message('当前应用信息读取失败，请重新打开重试');}).finally(()=>{if(generation===this.generation){this.busy=false;this.controls();}});
 }
 private message(text:string){if(this.host)this.host.querySelector('[data-app-status]')!.textContent=text;}
 private summary(){if(!this.host)return;this.host.querySelector('[data-app-summary]')!.textContent=this.manifest?'版本 '+this.manifest.version+' · '+(this.manifest.size/1024/1024).toFixed(1)+' MB':'';this.host.querySelector('[data-app-notes]')!.textContent=this.manifest?.notes??'';}
 private controls(){if(!this.host)return;this.host.querySelectorAll<HTMLButtonElement>('[data-app-update]').forEach(b=>{const action=b.dataset.appUpdate;b.disabled=this.busy||!this.ready;if(action==='stop'){b.hidden=!this.controller;b.disabled=false;}if(action==='clear')b.hidden=!this.cached;if(action==='download')b.hidden=!this.updateAvailable||!!this.candidate||this.cached;if(action==='install')b.hidden=!this.candidate;if(action==='settings')b.hidden=!this.permission;});}
 private async action(action:string){
  if(this.busy||!this.ready)return;this.busy=true;this.controls();const generation=this.generation,current=()=>generation===this.generation&&!!this.host;
  try{
   if(action==='check'){
    this.controller=new AbortController();this.controls();this.message('正在检查应用更新…');const result=await this.port.check(this.controller.signal,()=>{});if(!current())return;if(this.controller.signal.aborted)throw Error('应用更新已停止');if(this.manifest?.sha256!==result.manifest?.sha256){this.candidate=null;this.permission=false;}this.manifest=result.manifest??null;this.updateAvailable=result.state==='available';if(!this.updateAvailable)this.candidate=null;this.summary();this.message({unpublished:'尚未发布手机版应用更新',current:'当前已是最新发布版本',available:'发现新版本，请先下载安装包','system-old':'当前 Android 版本不支持此更新'}[result.state]);
   }else if(action==='download'&&this.manifest&&this.updateAvailable&&!this.cached){
    this.controller=new AbortController();this.controls();this.message('正在下载应用安装包…');const id=await this.port.download(this.manifest,this.controller.signal,(bytes,total)=>{if(current())this.message(`正在下载 ${(bytes/1024/1024).toFixed(1)} / ${(total/1024/1024).toFixed(1)} MB${bytes===total?'，正在核对安装包':''}`);});if(!current())return;if(this.controller.signal.aborted)throw Error('应用更新已停止');this.candidate=id;this.cached=true;this.message('安装包已核对，点击“安装更新”继续');
   }else if(action==='install'&&this.manifest&&this.candidate){
    if(!await this.port.confirm('安装应用更新？',`将安装 ${this.manifest.version}，随后由 Android 系统再次确认。请先保存当前工作。`))return;if(!current())return;const result=await this.port.install(this.manifest,this.candidate);if(!current())return;this.permission=result.state==='permission-required';this.message(this.permission?'需要在系统中允许此应用安装更新，返回后再次点击“安装更新”':'已打开系统安装页面，请在系统中确认');
   }else if(action==='settings'){await this.port.settings();}
   else if(action==='clear'){await this.port.clear();this.cached=false;this.candidate=null;this.permission=false;this.message('更新下载缓存已清理');}
  }catch(error){if(current()){this.message(error instanceof Error?error.message:'应用更新失败');try{const info=await this.port.info();if(current())this.cached=info.hasCache;}catch{}}}
  finally{if(current()){this.controller=null;this.busy=false;this.controls();}}
 }
}
