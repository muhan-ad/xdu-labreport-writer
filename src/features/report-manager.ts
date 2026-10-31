import {saveReportToDirectory} from '../platform/report-directory.ts';
import type { Experiment } from "../domain/types.ts";
import type { SavedReport } from "../domain/reports.ts";
import type { Repository } from "../domain/repository.ts";
import { removeSavedReportFiles, openReport, reportBytes, reportFileSize, shareReport } from "../platform/reports.ts";
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
interface Entry { exp: Experiment; report: SavedReport|null; size: number|null; problem: string; }
interface Hooks { notice(s:string):void; edit(id:string):void; confirm(title:string,body:string):Promise<boolean>; }
export class ReportManager {
 private host:HTMLElement|null=null;
 private items:Entry[]=[];
 private token=0;
 private loading=false;
 private busy=false;
 private query="";
 private preview=document.createElement('dialog');
 private current:SavedReport|null=null;
 private frame:HTMLIFrameElement|null=null;
 private previewToken="";
 constructor(private repo:Repository,private experiments:Experiment[],private hooks:Hooks){
  this.preview.id='managed-report-preview';this.preview.className='report-sheet';document.body.append(this.preview);
  this.preview.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  this.preview.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-managed-preview]');if(!b||b.disabled)return;const action=b.dataset.managedPreview;if(action==='close')this.close();else if(this.current)void this.fileAction(action!,this.current).catch(e=>this.message(e.message));});
  window.addEventListener('message',e=>{if(e.source!==this.frame?.contentWindow)return;if(e.data?.type==='report-preview-ready')void this.sendPreview();else if(e.data?.type==='report-preview-result'&&e.data.token===this.previewToken)this.message(e.data.ok?'预览已完成':'预览未完成，可保存或外部打开核对');});
 }
 get isSaving(){return this.busy;}
 get isOpen(){return this.preview.open;}
 close(){if(this.busy){this.hooks.notice('报告正在处理，请稍候');return;}this.current=null;this.frame=null;this.previewToken='';if(this.preview.open)this.preview.close();this.preview.innerHTML='';}
 leave(){this.close();this.token++;this.host=null;}
 mount(host:HTMLElement){this.leave();this.host=host;this.query='';this.items=[];this.render();const token=this.token;
  host.addEventListener('input',e=>{if((e.target as HTMLElement).id==='report-manager-search'){this.query=(e.target as HTMLInputElement).value;this.renderList();}});
  host.addEventListener('click',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-managed]');if(!b||b.disabled||token!==this.token)return;void this.action(b.dataset.managed!,b.dataset.id).catch(e=>this.hooks.notice(e.message));});
  void this.load();
 }
 private async load(){const token=this.token;this.loading=true;this.renderList();const items:Entry[]=[];
  for(const exp of this.experiments){if(token!==this.token)return;try{const result=await this.repo.loadReport(exp);if(!result.value)continue;let size:number|null=null,problem=result.warning;try{size=await reportFileSize(result.value);}catch{problem='报告文件缺失或不可用，请重新生成';}items.push({exp,report:result.value,size,problem});}catch{items.push({exp,report:null,size:null,problem:'报告索引无法读取，应用未删除报告文件；请重试或检查本机存储'});}}
  if(token!==this.token)return;this.items=items.sort((a,b)=>(b.report?.createdAt??'').localeCompare(a.report?.createdAt??''));this.loading=false;this.renderList();
 }
 private render(){if(!this.host)return;this.host.innerHTML='<section class="panel"><a class="button secondary" href="#/report-queue">批量生成报告</a><div class="manager-toolbar"><input id="report-manager-search" type="search" placeholder="搜索实验或姓名" aria-label="搜索已生成报告"><button class="button secondary" data-managed="refresh">刷新</button><button class="button secondary" data-managed="delete-all">删除全部报告</button></div><p id="report-manager-status" role="status"></p><div id="report-manager-list"></div></section>';this.renderList();}
 private renderList(){if(!this.host)return;const q=this.query.trim().toLocaleLowerCase(),visible=this.items.filter(e=>(e.exp.name+' '+(e.report?.snapshot.profile.name??'')).toLocaleLowerCase().includes(q));
  const unknown=this.items.filter(e=>!e.report&&!!e.problem).length;this.host.querySelector('#report-manager-status')!.textContent=this.loading?'正在读取报告…':`${this.items.filter(e=>e.report).length} 份${unknown?'可读取报告':'本机报告'}${unknown?' · '+unknown+' 项未核实':''}${q?' · 找到 '+visible.length+' 项':''}`;
  this.host.querySelector('#report-manager-list')!.innerHTML=visible.length?visible.map(e=>`<article class="managed-report" data-managed-row="${e.exp.id}"><h3>${esc(e.exp.name)}</h3>${e.report?`<p>${esc(e.report.snapshot.profile.name)} · ${esc(e.report.snapshot.record.date)}${e.size===null?'':' · '+(e.size/1024).toFixed(0)+' KB'}</p><p>生成于 ${esc(new Date(e.report.createdAt).toLocaleString('zh-CN',{hour12:false}))}</p>`:''}${(e.report?.notices??[]).map(n=>`<p class="report-warning">${esc(n)}</p>`).join('')}${e.problem?`<p class="ocr-warning">${esc(e.problem)}</p>`:''}<div class="managed-actions">${e.report?`<button class="button secondary" data-managed="preview" data-id="${e.exp.id}" ${e.size===null?'disabled':''}>预览</button><button class="button secondary" data-managed="open" data-id="${e.exp.id}" ${e.size===null?'disabled':''}>外部打开</button><button class="button secondary" data-managed="save" data-id="${e.exp.id}" ${e.size===null?'disabled':''}>保存报告</button><button class="button secondary" data-managed="share" data-id="${e.exp.id}" ${e.size===null?'disabled':''}>分享</button><button class="button secondary" data-managed="delete" data-id="${e.exp.id}">删除报告</button>`:''}<button class="button secondary" data-managed="edit" data-id="${e.exp.id}">进入实验</button></div></article>`).join(''):(this.loading?'':'<div class="empty-state">'+(q?'没有匹配的报告':'还没有生成报告')+'</div>');
  this.host.querySelectorAll<HTMLButtonElement>('[data-managed]').forEach(b=>b.disabled=b.disabled||this.busy||this.loading||(b.dataset.managed==='delete-all'&&!this.items.some(e=>e.report)));
  const refresh=this.host.querySelector<HTMLButtonElement>('[data-managed=refresh]')!;refresh.disabled=this.loading||this.busy;
  const all=this.host.querySelector<HTMLButtonElement>('[data-managed=delete-all]')!;all.disabled=this.loading||this.busy||!this.items.some(e=>e.report);
 }
 private async fresh(report:SavedReport){const exp=this.experiments.find(e=>e.id===report.experimentId)!;const current=await this.repo.loadReport(exp);if(current.value?.generation!==report.generation)throw Error('报告已变化，请刷新列表后重新选择');return current.value;}
 private async action(action:string,id?:string){if(this.busy||this.loading)return;if(action==='refresh')return this.load();const entry=this.items.find(e=>e.exp.id===id);
  if(action==='edit'&&entry)return this.hooks.edit(entry.exp.id);
  if(action==='delete-all'||(action==='delete'&&entry))return this.remove(action==='delete-all'?this.items.filter(e=>e.report):[entry!]);
  if(entry?.report){if(action==='preview')return this.showPreview(await this.fresh(entry.report));return this.fileAction(action,entry.report);}
 }
 private async remove(entries:Entry[]){const targets=entries.filter((e):e is Entry & {report:SavedReport}=>!!e.report);if(!targets.length)return;this.busy=true;this.renderList();
  try{if(!await this.hooks.confirm(targets.length===1?'删除这份报告？':`删除全部 ${targets.length} 份报告？`,`<p>${targets.length===1?esc(targets[0].exp.name):'删除列表中的全部报告，包含当前搜索结果以外的报告。'}</p><p>测量数据、照片、章节选择和 AI 导入内容保留。外部另存副本不受影响。</p>`))return;let done=0;const failures:string[]=[];
   for(const e of targets){try{await this.repo.deleteReport(e.exp,e.report.generation,()=>removeSavedReportFiles(e.report));done++;}catch(error){failures.push(e.exp.name+'：'+(error as Error).message);}}
   await this.load();this.hooks.notice(failures.length?`已删除 ${done} 份，${failures.length} 份未完成，请重试：${failures.join('；')}`:`已删除 ${done} 份报告`);
  }finally{this.busy=false;this.renderList();}
 }
 private async fileAction(action:string,report:SavedReport){if(this.busy)return;this.busy=true;this.renderList();this.preview.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{const current=await this.fresh(report);if(action==='open')await openReport(current);else if(action==='share')await shareReport(current);else if(action==='save'){const result=await saveReportToDirectory(current);this.hooks.notice(result.mode==='share'?'请在目标应用中确认报告':'已保存：'+result.name);}}finally{this.busy=false;this.renderList();this.preview.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
 }
 private async showPreview(report:SavedReport){this.current=report;this.previewToken='';this.preview.innerHTML=`<header class="report-header"><h2>${esc(report.name)}</h2><button class="icon-button" data-managed-preview="close" aria-label="关闭报告预览">×</button></header><div class="report-body"><p id="managed-preview-status" role="status">正在准备预览…</p><iframe title="已保存报告预览" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div><footer class="report-footer"><div><button class="button secondary" data-managed-preview="open">外部打开</button><button class="button" data-managed-preview="save">保存报告</button><button class="button secondary" data-managed-preview="share">分享</button></div></footer>`;this.frame=this.preview.querySelector('iframe');if(!this.preview.open)this.preview.showModal();this.frame!.src='/preview/index.html';}
 private message(text:string){const node=this.preview.querySelector('#managed-preview-status');if(node)node.textContent=text;}
 private async sendPreview(){const report=this.current,frame=this.frame;if(!report||!frame)return;try{await this.fresh(report);const bytes=await reportBytes(report);if(frame!==this.frame||report!==this.current)return;this.previewToken=crypto.randomUUID();frame.contentWindow?.postMessage({type:'report-preview',bytes:bytes.slice().buffer,token:this.previewToken},'*');}catch(e){if(frame===this.frame)this.message('预览未完成：'+(e as Error).message);}}
}
