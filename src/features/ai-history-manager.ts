import type {Experiment} from '../domain/types.ts';
import type {AIHistoryEntry,AIHistorySummary} from '../domain/ai-library.ts';
import {historyUseState,type HistoryContext} from '../domain/ai-history-management.ts';
import {copyScopeLabels} from '../domain/report-copy.ts';
const sectionLabel=(row:Pick<AIHistorySummary,'kind'|'section'>)=>row.kind==='quiz'?'自定义思考题':copyScopeLabels[row.section as keyof typeof copyScopeLabels]??row.section;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
interface Port {
 scan(id:string):Promise<{rows:AIHistorySummary[];warning:string}>;
 context(exp:Experiment):Promise<HistoryContext>;
 read(id:string,item:string):Promise<AIHistoryEntry>;
 remove(id:string,expected:AIHistorySummary[]):Promise<number>;
 confirm(title:string,body:string):Promise<boolean>;
 copy(text:string):Promise<void>;
 edit(id:string):void;
}
interface Group {exp:Experiment;quiz:number;polish:number;warning:string;}
export class AIHistoryManager {
 private host:HTMLElement|null=null;private lifetime:AbortController|null=null;private token=0;private selection=0;
 private groups:Group[]=[];private rows:AIHistorySummary[]=[];private context:HistoryContext|null=null;private query='';private kind='all';private expId='';private page=0;private loading=false;private reading=false;private busy=false;private problem='';
 private detail=document.createElement('dialog');private entry:AIHistoryEntry|null=null;
 constructor(private experiments:Experiment[],private port:Port,private notice:(s:string)=>void){
  this.detail.className='report-sheet';this.detail.setAttribute('aria-label','AI 历史详情');document.body.append(this.detail);
  this.detail.addEventListener('cancel',e=>{e.preventDefault();this.closeDetail();});
  this.detail.addEventListener('click',e=>{const action=(e.target as Element).closest<HTMLElement>('[data-history-detail]')?.dataset.historyDetail;if(action==='close')this.closeDetail();else if(action==='copy'&&this.entry&&!this.busy){const text=this.entry.text;this.busy=true;this.controls();void this.port.copy(text).then(()=>this.notice('正文已复制')).catch(()=>{const input=this.detail.querySelector<HTMLTextAreaElement>('textarea');input?.focus();input?.select();this.notice('未能复制，请长按正文选择复制');}).finally(()=>{this.busy=false;this.controls();});}});
 }
 get isSaving(){return this.busy;}get isOpen(){return this.detail.open;}
 closeDetail(){if(this.busy)return;this.detail.close();this.detail.innerHTML='';this.entry=null;}
 leave(){if(this.busy)return;this.token++;this.selection++;this.lifetime?.abort();this.host=null;this.groups=[];this.rows=[];this.context=null;this.loading=false;this.reading=false;this.closeDetail();}
 mount(host:HTMLElement){this.leave();this.host=host;this.lifetime=new AbortController();this.query='';this.kind='all';this.expId='';this.groups=[];this.rows=[];
  host.innerHTML='<section class="panel"><div class="manager-toolbar"><input type="search" data-history-search placeholder="搜索实验名称" aria-label="搜索 AI 历史实验"><select data-history-kind aria-label="历史类型"><option value="all">全部 AI 历史</option><option value="polish">章节润色</option><option value="quiz">思考题回答</option></select><button class="button secondary" data-history-action="refresh">刷新</button></div><label class="ai-field">实验<select data-history-exp></select></label><div class="ai-inline"><button class="button secondary" data-history-action="clear-exp">删除本实验记录</button><button class="button secondary" data-history-action="clear-all">删除全部记录</button><button class="button secondary" data-history-action="edit">进入实验</button></div><p data-history-status role="status"></p><div data-history-rows></div></section>';
  const signal=this.lifetime.signal;
  host.addEventListener('input',e=>{if(this.busy||this.loading||this.reading)return;if((e.target as HTMLElement).hasAttribute('data-history-search')){this.query=(e.target as HTMLInputElement).value;this.choose();}},{signal});
  host.addEventListener('change',e=>{if(this.busy||this.loading||this.reading)return;const input=e.target as HTMLSelectElement;if(input.hasAttribute('data-history-kind')){this.kind=input.value;this.choose();}else if(input.hasAttribute('data-history-exp')){this.expId=input.value;this.page=0;void this.loadSelected();}},{signal});
  host.addEventListener('click',e=>{const button=(e.target as Element).closest<HTMLButtonElement>('[data-history-action]');if(button&&!button.disabled)void this.action(button.dataset.historyAction!,button.dataset.id).catch(e=>this.notice(e.message));},{signal});void this.load();
 }
 private count(g:Group){return this.kind==='all'?g.quiz+g.polish:this.kind==='quiz'?g.quiz:g.polish;}
 private matching(rows:AIHistorySummary[]){return rows.filter(r=>this.kind==='all'||r.kind===this.kind);}
 private choose(){if(!this.host)return;const visible=this.groups.filter(g=>(this.count(g)>0||g.warning)&&g.exp.name.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()));if(!visible.some(g=>g.exp.id===this.expId))this.expId=visible[0]?.exp.id??'';this.host.querySelector('[data-history-exp]')!.innerHTML=visible.map(g=>`<option value="${g.exp.id}" ${this.expId===g.exp.id?'selected':''}>${esc(g.exp.name)} · ${g.warning?'待核实':this.count(g)+' 条'}</option>`).join('')||'<option value="">没有匹配的历史</option>';this.page=0;void this.loadSelected();}
 private message(text:string){const node=this.host?.querySelector('[data-history-status]');if(node)node.textContent=text;}
 private async load(){if(this.busy)return;const token=this.token;this.loading=true;this.groups=[];this.rows=[];this.renderRows();
  try{for(const exp of this.experiments){if(token!==this.token)return;this.message(`正在读取 ${this.groups.length+1} / ${this.experiments.length}`);try{const result=await this.port.scan(exp.id);if(token!==this.token)return;this.groups.push({exp,quiz:result.rows.filter(r=>r.kind==='quiz').length,polish:result.rows.filter(r=>r.kind==='polish').length,warning:result.warning});}catch{if(token!==this.token)return;this.groups.push({exp,quiz:0,polish:0,warning:'历史未能读取，请刷新重试'});}}}
  finally{if(token===this.token){this.loading=false;this.choose();}}
 }
 private async loadSelected(){const token=this.token,selection=++this.selection,id=this.expId,exp=this.experiments.find(e=>e.id===id);this.rows=[];this.context=null;this.problem='';if(!exp){this.reading=false;this.renderRows();return;}this.reading=true;this.renderRows();
  const [history,context]=await Promise.allSettled([this.port.scan(id),this.port.context(exp)]);if(token!==this.token||selection!==this.selection)return;
  if(history.status==='fulfilled'){this.rows=this.matching(history.value.rows);this.problem=history.value.warning;}else this.problem='历史未能读取，请刷新重试';
  if(context.status==='fulfilled'){this.context=context.value;if(context.value.warning)this.problem+=(this.problem?'；':'')+context.value.warning;}else this.problem+=(this.problem?'；':'')+'实验数据或配置未能核实';
  this.reading=false;this.renderRows();
 }
 private controls(){this.host?.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select').forEach(e=>e.disabled=this.busy||this.loading||this.reading);this.detail.querySelectorAll<HTMLButtonElement>('button').forEach(e=>e.disabled=this.busy);
  if(!this.host)return;const single=this.host.querySelector<HTMLButtonElement>('[data-history-action=clear-exp]')!,all=this.host.querySelector<HTMLButtonElement>('[data-history-action=clear-all]')!,edit=this.host.querySelector<HTMLButtonElement>('[data-history-action=edit]')!;
  single.disabled=single.disabled||!this.rows.length||!!this.problem;all.disabled=all.disabled||!this.groups.some(g=>this.count(g))||this.groups.some(g=>g.warning);edit.disabled=edit.disabled||!this.expId;
  const previous=this.host.querySelector<HTMLButtonElement>('[data-history-action=prev]'),next=this.host.querySelector<HTMLButtonElement>('[data-history-action=next]');if(previous)previous.disabled=previous.disabled||this.page===0;if(next)next.disabled=next.disabled||(this.page+1)*20>=this.rows.length;
 }
 private renderRows(){if(!this.host)return;const pages=Math.max(1,Math.ceil(this.rows.length/20));this.page=Math.min(this.page,pages-1);const label=this.kind==='all'?'AI 历史':this.kind==='quiz'?'思考题回答':'润色记录';
  this.host.querySelector('[data-history-rows]')!.innerHTML=this.rows.slice(this.page*20,this.page*20+20).map(row=>`<article class="ai-history-row"><strong>${esc(sectionLabel(row))}</strong><p>${esc(new Date(row.createdAt).toLocaleString('zh-CN',{hour12:false}))} · ${historyUseState(row,this.context)}</p><div class="ai-inline"><button class="button secondary" data-history-action="view" data-id="${row.id}">查看</button><button class="button secondary" data-history-action="delete" data-id="${row.id}">删除</button></div></article>`).join('')+(this.rows.length?`<div class="ai-inline"><button class="button secondary" data-history-action="prev" ${this.page===0?'disabled':''}>上一页</button><span>${this.page+1} / ${pages}</span><button class="button secondary" data-history-action="next" ${this.page+1===pages?'disabled':''}>下一页</button></div>`:'');
  this.message(this.loading?'正在读取历史…':this.reading?'正在读取本实验…':(this.problem?this.problem+' · ':'')+`${this.rows.length} 条${label}${this.groups.some(g=>g.warning)?' · 部分实验读取不完整':''}`);this.controls();
 }
 private async action(action:string,id?:string){if(this.busy||this.loading||this.reading)return;if(action==='refresh')return this.load();if(action==='edit'&&this.expId)return this.port.edit(this.expId);if(action==='next'||action==='prev'){this.page=Math.max(0,this.page+(action==='next'?1:-1));this.renderRows();return;}
  const row=this.rows.find(r=>r.id===id),exp=this.experiments.find(e=>e.id===this.expId);
  if(action==='view'&&row&&exp){const token=this.token,selection=this.selection;this.reading=true;this.controls();try{const entry=await this.port.read(exp.id,row.id);if(token!==this.token||selection!==this.selection||this.expId!==exp.id)return;if(entry.experimentId!==exp.id||entry.id!==row.id||(['kind','section','createdAt','sourceHash'] as const).some(k=>entry[k]!==row[k]))throw Error('历史已变化，请刷新后重新选择');this.entry=entry;this.detail.innerHTML=`<header class="report-header"><h2>${esc(exp.name)}</h2><button class="icon-button" data-history-detail="close" aria-label="关闭历史详情">×</button></header><div class="report-body"><h3>${esc(sectionLabel(entry))}</h3><p>${historyUseState(row,this.context)}</p><details><summary>原文 / 题目</summary><pre class="ai-history-original">${esc(entry.original||entry.questions.join('\n')||'此记录未保存原文')}</pre></details><label class="ai-field">AI 正文<textarea rows="12" readonly>${esc(entry.text)}</textarea></label></div><footer class="report-footer"><button class="button" data-history-detail="copy">复制正文</button><button class="button secondary" data-history-detail="close">关闭</button></footer>`;this.detail.showModal();}finally{if(token===this.token){this.reading=false;this.controls();}}return;}
  if(action==='delete'&&row&&exp)return this.remove([{exp,rows:[row]}]);
  if(action==='clear-exp'&&exp)return this.remove([{exp,rows:this.rows}]);
  if(action==='clear-all'){this.busy=true;this.controls();try{const targets=[];for(const group of this.groups){if(!this.count(group))continue;const result=await this.port.scan(group.exp.id);if(result.warning)throw Error('历史读取不完整，未删除任何记录');const rows=this.matching(result.rows);if(rows.length)targets.push({exp:group.exp,rows});}await this.remove(targets,true);}finally{this.busy=false;this.controls();}}
 }
 private async remove(targets:{exp:Experiment;rows:AIHistorySummary[]}[],alreadyBusy=false){if(!targets.length)return;this.busy=true;this.controls();try{const count=targets.reduce((n,t)=>n+t.rows.length,0),type=this.kind==='polish'?'润色记录':this.kind==='quiz'?'思考题回答':'AI 历史',row=targets[0].rows[0];if(!await this.port.confirm(`删除 ${count} 条${type}？`,`<p>${targets.length===1?esc(targets[0].exp.name):targets.length+' 个实验，包含搜索结果以外的实验'}</p>${count===1?`<p>${esc(sectionLabel(row))} · ${esc(new Date(row.createdAt).toLocaleString('zh-CN',{hour12:false}))}</p>`:''}<p>删除这些记录及其当前 AI 导入内容。测量数据、照片、题目设置和已生成报告保留；重新生成后报告才会更新。</p>`))return;let done=0;const failures=[];for(const target of targets)try{done+=await this.port.remove(target.exp.id,target.rows);}catch(e){failures.push(target.exp.name+'：'+(e as Error).message);}this.busy=false;await this.load();this.notice(failures.length?`已删除 ${done} 条；未完成：${failures.join('；')}`:`已删除 ${done} 条历史，请按需重新生成报告`);}finally{if(!alreadyBusy)this.busy=false;this.controls();}}
}
