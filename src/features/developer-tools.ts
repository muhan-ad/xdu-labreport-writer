export interface DeveloperPort{
 loadMode:()=>Promise<boolean>;saveMode:(enabled:boolean)=>Promise<void>;
 interrupted:()=>Promise<boolean>;
 backupInfo:()=>Promise<string|null>;
 removeBackup:()=>Promise<void>;
 fill:(progress:(text:string)=>void)=>Promise<void>;
 restore:(progress:(text:string)=>void)=>Promise<void>;
 diagnostics:()=>Promise<void>;
 confirm:(title:string,body:string)=>Promise<boolean>;
 count:number;
}
export class DeveloperToolsView{
 private port:DeveloperPort;private host:HTMLElement|null=null;private life:AbortController|null=null;private generation=0;private busy=false;private enabled=false;private backup:string|null=null;
 private interrupted=false;
 constructor(port:DeveloperPort){this.port=port;}
 get isSaving(){return this.busy;}
 leave(){this.generation++;this.life?.abort();this.host=null;}
 mount(host:HTMLElement){
  this.leave();this.host=host;this.life=new AbortController();const generation=this.generation;this.busy=true;
  host.innerHTML='<section class="panel"><h2>开发者调试</h2><label class="debug-mode"><input type="checkbox" role="switch" data-debug-mode><span>开发者模式</span></label><div class="ai-inline debug-actions"><button class="button secondary" data-debug="fill" hidden>全部填入测试数据</button><button class="button secondary" data-debug="restore" hidden>恢复测试前数据</button><button class="button secondary" data-debug="remove" hidden>删除测试前备份</button><button class="button secondary" data-debug="diagnostics">导出诊断摘要</button><a class="button secondary" href="#/resource-check">资源与运行诊断</a></div><p data-debug-backup></p><p data-debug-status role="status">正在读取…</p></section>';
  host.addEventListener('change',e=>{if((e.target as HTMLElement).hasAttribute('data-debug-mode'))void this.mode((e.target as HTMLInputElement).checked);},{signal:this.life.signal});
  host.addEventListener('click',e=>{const action=(e.target as Element).closest<HTMLButtonElement>('[data-debug]')?.dataset.debug;if(action)void this.action(action);},{signal:this.life.signal});
  this.controls();void Promise.all([this.port.loadMode(),this.port.backupInfo(),this.port.interrupted()]).then(([enabled,backup,interrupted])=>{if(generation===this.generation){this.enabled=enabled;this.backup=backup;this.interrupted=interrupted;this.message(interrupted?'上次调试写入未完成，请先恢复测试前备份':'');}}).catch(()=>{if(generation===this.generation){this.enabled=false;this.interrupted=true;this.message('调试设置或备份读取失败，请重新打开重试');}}).finally(()=>{if(generation===this.generation){this.busy=false;this.controls();}});
 }
 private message(text:string){if(this.host)this.host.querySelector('[data-debug-status]')!.textContent=text;}
 private controls(){if(!this.host)return;const mode=this.host.querySelector<HTMLInputElement>('[data-debug-mode]')!;mode.checked=this.enabled;mode.disabled=this.busy;this.host.querySelectorAll<HTMLButtonElement>('[data-debug]').forEach(b=>{b.hidden=(b.dataset.debug==='fill'&&!this.enabled)||(['restore','remove'].includes(b.dataset.debug!)&&!this.backup);b.disabled=this.busy||(this.interrupted&&['fill','remove'].includes(b.dataset.debug!))||((b.dataset.debug==='restore'||b.dataset.debug==='remove')&&!this.backup);});this.host.querySelector('[data-debug-backup]')!.textContent=this.backup?'测试前备份：'+this.backup:'';}
 private async mode(enabled:boolean){
  if(this.busy)return;this.busy=true;this.controls();try{await this.port.saveMode(enabled);this.enabled=enabled;this.message(enabled?'已开启开发者模式':'已恢复普通模式');}catch{this.message('模式保存失败，请重试');}finally{this.busy=false;this.controls();}
 }
 private async action(action:string){
  if(this.busy||(action==='fill'&&!this.enabled)||(['restore','remove'].includes(action)&&!this.backup)||(this.interrupted&&['fill','remove'].includes(action)))return;
  this.busy=true;this.controls();
  try{
   if(action==='diagnostics'){await this.port.diagnostics();this.message('已导出诊断摘要');return;}
   if(action==='fill'){
    if(!await this.port.confirm('全部填入测试数据？',`将替换并保存 ${this.port.count} 个实验的测量数据。先备份并核对原记录，保留照片、报告及章节设置。测试数据不能作为实测数据提交；本次备份将替换上次测试前备份。`))return;
    await this.port.fill(text=>this.message(text));this.backup=await this.port.backupInfo();this.message(`已填入 ${this.port.count} 个实验，仅用于测试`);
   }else if(action==='remove'&&this.backup){
    if(!await this.port.confirm('删除测试前备份？','只删除调试工具保存的测试前测量数据副本，当前测量记录和报告保留。删除后无法再用这份备份恢复。'))return;
    await this.port.removeBackup();this.backup=null;this.message('已删除测试前备份');
   }else if(action==='restore'&&this.backup){
    if(!await this.port.confirm('恢复测试前数据？','将用 '+this.backup+' 的备份覆盖测量记录，包括测试后手动修改的数值。照片、报告及章节设置保留。'))return;
    await this.port.restore(text=>this.message(text));this.interrupted=await this.port.interrupted();this.message('已恢复测试前测量数据');
   }
  }catch(error){try{this.backup=await this.port.backupInfo();this.interrupted=await this.port.interrupted();}catch{}this.message(error instanceof Error?error.message:'操作失败，请重试');}
  finally{this.busy=false;this.controls();}
 }
}
