import type {Experiment} from '../domain/types.ts';
import {knownDisabledSections} from '../domain/report-sections.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
interface Port {
 load(exp:Experiment):Promise<{names:string[];disabled:string[];warning:string}>;
 save(exp:Experiment,names:string[],disabled:string[],expected:string[]):Promise<string[]>;
}
export class ReportSectionsView {
 private host:HTMLElement|null=null;private lifetime:AbortController|null=null;private token=0;private selection=0;private busy=false;private loading=false;private ready=false;private query='';private id='';private names:string[]=[];private initial:string[]=[];private disabled:string[]=[];private warning='';
 constructor(private experiments:Experiment[],private port:Port){}
 get isSaving(){return this.busy;}get hasUnsaved(){return JSON.stringify(this.disabled)!==JSON.stringify(this.initial);}
 leave(){if(this.busy)return;this.token++;this.selection++;this.lifetime?.abort();this.host=null;this.names=[];this.initial=[];this.disabled=[];this.ready=false;this.loading=false;}
 mount(host:HTMLElement){this.leave();this.host=host;this.lifetime=new AbortController();this.query='';this.id=this.experiments[0]?.id??'';
  host.innerHTML='<section class="panel"><div class="manager-toolbar"><input type="search" data-sections-search placeholder="搜索实验名称" aria-label="搜索实验章节"><select data-sections-exp aria-label="选择实验"></select></div><p>保存后用于下次生成，已有报告保留。</p><div data-sections-list></div><div class="ai-inline"><button class="button secondary" data-sections-action="all">全部保留</button><button class="button secondary" data-sections-action="discard">放弃修改</button><button class="button" data-sections-action="save">保存章节开关</button><button class="button secondary" data-sections-action="retry" hidden>重新读取</button></div><p data-sections-status role="status"></p></section>';
  const signal=this.lifetime.signal;
  host.addEventListener('input',e=>{if((e.target as HTMLElement).hasAttribute('data-sections-search')&&!this.busy&&!this.loading&&!this.hasUnsaved){this.query=(e.target as HTMLInputElement).value;this.options();void this.load();}},{signal});
  host.addEventListener('change',e=>{if(this.busy||this.loading)return;const input=e.target as HTMLInputElement|HTMLSelectElement;if(input.hasAttribute('data-sections-exp')&&!this.hasUnsaved){this.id=input.value;void this.load();}else if(input instanceof HTMLInputElement&&input.dataset.reportSection&&this.ready){const values=new Set(this.disabled);input.checked?values.delete(input.dataset.reportSection):values.add(input.dataset.reportSection);this.disabled=knownDisabledSections(this.names,[...values]);this.message(this.hasUnsaved?'有未保存修改，保存或放弃后可切换实验':'');this.controls();}},{signal});
  host.addEventListener('click',e=>{const button=(e.target as Element).closest<HTMLButtonElement>('[data-sections-action]');if(!button||button.disabled)return;const action=button.dataset.sectionsAction;if(action==='retry')void this.load();else if(action==='discard'){this.disabled=[...this.initial];this.render();this.message(this.warning||'已放弃修改',!!this.warning);}else if(action==='all'){this.disabled=[];this.render();this.message(this.hasUnsaved?'有未保存修改，保存后生效':'');}else if(action==='save')void this.save();},{signal});this.options();void this.load();
 }
 private options(){if(!this.host)return;const matches=this.experiments.filter(e=>e.name.toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase()));if(!matches.some(e=>e.id===this.id))this.id=matches[0]?.id??'';this.host.querySelector('[data-sections-exp]')!.innerHTML=matches.map(exp=>`<option value="${exp.id}" ${exp.id===this.id?'selected':''}>${esc(exp.name)}</option>`).join('')||'<option value="">没有匹配的实验</option>';}
 private message(text:string,error=false){const node=this.host?.querySelector<HTMLElement>('[data-sections-status]');if(node){node.textContent=text;node.classList.toggle('ocr-warning',error);}}
 private controls(){if(!this.host)return;this.host.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select').forEach(input=>input.disabled=this.busy||this.loading||(!input.hasAttribute('data-sections-search')&&input.hasAttribute('data-report-section')&&(!this.ready||!!this.warning)));for(const selector of ['[data-sections-search]','[data-sections-exp]'])this.host.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!.disabled=this.busy||this.loading||this.hasUnsaved;
  this.host.querySelectorAll<HTMLButtonElement>('[data-sections-action]').forEach(button=>{const action=button.dataset.sectionsAction;button.disabled=this.busy||this.loading||(action==='save'?(!this.ready||!!this.warning||!this.hasUnsaved):action==='discard'?!this.hasUnsaved:action==='all'?(!this.ready||!!this.warning||!this.disabled.length):false);if(action==='retry')button.hidden=!this.warning;});
 }
 private render(){if(!this.host)return;const disabled=new Set(this.disabled);this.host.querySelector('[data-sections-list]')!.innerHTML=this.names.map(name=>`<label class="section-switch-card"><input type="checkbox" data-report-section="${esc(name)}" ${disabled.has(name)?'':'checked'}><span>${esc(name)}</span></label>`).join('');this.controls();}
 private async load(){if(this.busy)return;const token=this.token,selection=++this.selection,exp=this.experiments.find(e=>e.id===this.id);this.ready=false;this.warning='';this.names=[];this.initial=[];this.disabled=[];if(!exp){this.loading=false;this.render();this.message('没有匹配的实验');return;}this.loading=true;this.render();this.message('正在读取章节…');
  try{const result=await this.port.load(exp);if(token!==this.token||selection!==this.selection)return;const disabled=knownDisabledSections(result.names,result.disabled);this.names=[...result.names];this.initial=disabled;this.disabled=[...this.initial];this.warning=result.warning;this.ready=true;this.message(this.warning||(!this.names.length?'该实验没有可配置章节':''),!!this.warning);}
  catch(e){if(token===this.token&&selection===this.selection){this.warning=(e as Error).message||'章节未能读取';this.message(this.warning,true);}}
  finally{if(token===this.token&&selection===this.selection){this.loading=false;this.render();}}
 }
 private async save(){const exp=this.experiments.find(e=>e.id===this.id);if(!exp||this.busy||this.loading||!this.ready||this.warning||!this.hasUnsaved)return;this.busy=true;this.controls();this.message('正在保存…');
  try{const saved=await this.port.save(exp,[...this.names],[...this.disabled],[...this.initial]);this.initial=knownDisabledSections(this.names,saved);this.disabled=[...this.initial];this.message('已保存，下次生成时生效');}
  catch(e){this.warning=(e as Error).message||'保存未能确认，请重新读取核对';this.message(this.warning,true);}
  finally{this.busy=false;this.render();}
 }
}
