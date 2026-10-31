import type {ReportDirectoryPort,DirectoryState} from '../platform/report-directory.ts';
export class ReportDirectoryView {
 private host:HTMLElement|null=null;private token=0;private busy=false;private value:DirectoryState|null=null;
 constructor(private port:ReportDirectoryPort,private confirm:()=>Promise<boolean>){}
 get isSaving(){return this.busy;}
 leave(){this.token++;this.host=null;}
 mount(host:HTMLElement){this.leave();this.host=host;this.busy=false;host.innerHTML='<section class="panel"><p>保存 Word 报告时使用此文件夹。同名文件保留，另建新副本。</p><p data-directory-name></p><p data-directory-status role="status"></p><div class="ai-inline"><button class="button" data-directory="choose">选择文件夹</button><button class="button secondary" data-directory="clear">清除默认目录</button></div></section>';host.onclick=e=>{const action=(e.target as Element).closest<HTMLElement>('[data-directory]')?.dataset.directory;if(action)void this.run(action);};void this.run('status');}
 private message(text:string){const n=this.host?.querySelector('[data-directory-status]');if(n)n.textContent=text;}
 private render(){if(!this.host)return;this.host.querySelector('[data-directory-name]')!.textContent=this.value?.configured?this.value.name:'尚未选择默认目录';this.host.querySelectorAll<HTMLButtonElement>('[data-directory]').forEach(b=>b.disabled=this.busy);}
 private async run(action:string){if(this.busy||!this.host)return;const token=this.token;this.busy=true;this.render();try{
  if(action==='clear'){if(!await this.confirm()||token!==this.token)return;await this.port.clear();this.value={configured:false,writable:false,name:''};}
  else {const result=action==='choose'?await this.port.choose():await this.port.status();if(token!==this.token)return;if(result.cancelled){this.message('已取消选择，原目录保留');return;}this.value=result;}
  if(token!==this.token)return;this.message(this.value?.configured?this.value.writable?'默认目录已就绪':'目录权限已失效，请重新选择文件夹':'保存报告时可选择默认目录');
 }catch(e){if(token===this.token)this.message((e as Error).message);}finally{if(token===this.token){this.busy=false;this.render();}}}
}
