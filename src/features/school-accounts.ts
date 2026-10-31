import {schoolSystem,type SavedSchoolAccount,type SchoolSystem} from '../domain/school-accounts.ts';
import {defaultSchoolPreload,type SchoolPreloadPreference} from '../domain/school-preload.ts';
export interface AccountPort {
  list():Promise<SavedSchoolAccount[]>;
  save(value:{system:SchoolSystem;id?:string;account:string;password:string;label:string;confirmed:boolean}):Promise<{id:string}>;
  remove(id:string,confirmed:boolean):Promise<void>;
  reset(confirmed:boolean):Promise<void>;
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const systems={course:'实验选课',report:'报告系统',academic:'教务系统（登录待接入）'};
export class SchoolAccountsView {
  private host:HTMLElement|null=null;private lifetime:AbortController|null=null;private token=0;private busy=false;private ready=false;private rows:SavedSchoolAccount[]=[];private editing='';private initialSystem:SchoolSystem='course';private preload=defaultSchoolPreload();private preloadReady=false;
  constructor(private port:AccountPort,private confirm:(title:string,text:string)=>Promise<boolean>,private notice:(s:string)=>void,private preloadPort?:{load:()=>Promise<SchoolPreloadPreference>;save:(value:SchoolPreloadPreference)=>Promise<void>;reset?:()=>Promise<void>}){}
  get isSaving(){return this.busy;}
  leave(){this.token++;this.lifetime?.abort();this.lifetime=null;const password=this.host?.querySelector<HTMLInputElement>('[data-account-field="password"]');if(password)password.value='';this.host=null;this.rows=[];this.editing='';}
  mount(host:HTMLElement,system:SchoolSystem='course'){
    this.leave();this.host=host;this.initialSystem=system;this.ready=false;this.lifetime=new AbortController();this.render();const token=this.token;
    host.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-account]');if(!button||button.disabled||this.busy)return;void this.action(button.dataset.account!,button.dataset.id).catch(error=>{if(token===this.token)this.message((error as Error).message,true);});},{signal:this.lifetime.signal});
    void this.reload().catch(error=>{if(token===this.token)this.message((error as Error).message,true);});
  }
  private render(){if(!this.host)return;
    this.host.innerHTML=`<section class="panel"><h2>${this.editing?'修改账号':'保存本机账号'}</h2><label class="ai-field">系统<select data-account-field="system">${Object.entries(systems).map(([key,label])=>`<option value="${key}" ${this.initialSystem===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="ai-field">账号<input data-account-field="account" inputmode="numeric" autocomplete="off" maxlength="30"></label><label class="ai-field">${this.editing?'重新输入密码':'密码'}<input data-account-field="password" type="password" autocomplete="new-password" maxlength="200"></label><label class="ai-field">备注<input data-account-field="label" maxlength="40" placeholder="可选"></label><div class="ai-inline"><button class="button" data-account="save">${this.editing?'保存修改':'加密保存'}</button><button class="button secondary" data-account="cancel" ${this.editing?'':'hidden'}>取消修改</button></div><p data-account-status role="status"></p>${this.preloadPort?.reset&&!this.preloadReady&&this.ready?'<button class="button secondary compact" data-account="preload-reset">重置自动加载设置</button>':''}</section><section class="panel"><div class="managed-actions"><h2>已保存账号</h2><button class="button secondary compact" data-account="reload">刷新</button></div><div class="school-account-list">${this.ready?this.rows.map(row=>`<article class="saved-school-account"><strong>${esc(row.label||row.account)}</strong><p>${esc(systems[row.system])}${row.account?' · '+esc(row.account):''}</p>${row.locked?'<p class="ocr-warning">无法解密，请重设或删除此配置</p>':''}<div class="ai-inline"><button class="button secondary compact" data-account="edit" data-id="${row.id}">${row.locked?'重设':'修改'}</button><button class="button secondary compact" data-account="remove" data-id="${row.id}">删除</button>${this.preloadPort&&(row.system==='course'||row.system==='report')&&!row.locked?`<button class="button secondary compact" data-account="preload" data-id="${row.id}">${this.preload[row.system]===row.id?'取消首页自动加载':'设为首页自动加载'}</button>`:''}</div></article>`).join('')||'<p>暂无保存的账号</p>':'<p>正在读取本机账号…</p>'}</div><div class="managed-actions"><a class="button secondary" href="#/portal">前往选课</a><a class="button secondary" href="#/school-reports">前往报告系统</a><button class="text-button" data-account="reset">重置全部本机账号</button></div></section>`;
    this.controls();
  }
  private controls(){this.host?.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,select,button').forEach(e=>{e.disabled=this.busy||(!this.ready&&!['reload','reset'].includes(e.dataset.account??''))||!!this.editing&&e.dataset.accountField==='system'||e.dataset.account==='preload'&&!this.preloadReady;});}
  private message(text:string,error=false){const box=this.host?.querySelector('[data-account-status]');if(box){box.textContent=text;box.classList.toggle('ocr-warning',error);}}
  private async reload(){const token=this.token,rows=await this.port.list();let preference=defaultSchoolPreload(),preloadReady=false;if(this.preloadPort)try{preference=await this.preloadPort.load();preloadReady=true;}catch{}if(token!==this.token||!this.host)return;this.rows=rows;this.preload=preference;this.preloadReady=preloadReady;this.ready=true;this.render();if(this.preloadPort&&!preloadReady)this.message('自动加载设置未能读取，可刷新或重置',true);}
  private field(key:string){return this.host!.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-account-field="${key}"]`)!;}
  private async action(action:string,id?:string){
    if(action==='cancel'){this.editing='';this.render();return;}
    if(action==='edit'){const row=this.rows.find(r=>r.id===id);if(!row)return;this.editing=row.id;this.initialSystem=row.system;this.render();this.field('system').disabled=true;this.field('account').value=row.account;this.field('label').value=row.locked?'':row.label;this.field('account').focus();return;}
    if(action==='reload'){await this.reload();return;}
    this.busy=true;this.controls();
    try{
      if(action==='preload-reset'){if(!this.preloadPort?.reset)throw Error('自动加载设置无法重置');await this.preloadPort.reset();window.dispatchEvent(new Event('school-preload-changed'));window.dispatchEvent(new Event('school-report-preload-changed'));await this.reload();this.message('自动加载已关闭，请重新选择账号');
      }else if(action==='preload'&&id){const row=this.rows.find(r=>r.id===id&&(r.system==='course'||r.system==='report')&&!r.locked);if(!row||!this.preloadPort||!this.preloadReady)throw Error('请先核对已保存的账号');const system=row.system as 'course'|'report';const next={...this.preload,[system]:this.preload[system]===id?null:id};await this.preloadPort.save(next);this.preload=next;window.dispatchEvent(new Event(system==='course'?'school-preload-changed':'school-report-preload-changed'));this.render();this.message(next[system]?'已设置首页自动加载，已有登录会话保留':'已关闭首页自动加载');
      }else if(action==='save'){
        const system=this.field('system').value,account=this.field('account').value.trim(),password=this.field('password').value,label=this.field('label').value.trim();
        if(!schoolSystem(system)||!/^\d{6,30}$/.test(account)||!password||password.length>200||label.length>40)throw Error('请填写有效的账号和密码，备注最多 40 字');
        if(!await this.confirm('在本机加密保存此账号？','账号仅保存在当前应用；这一步不会登录官网。'))return;
        const preloadCourseChanged=!!this.editing&&this.preload.course===this.editing,preloadReportChanged=!!this.editing&&this.preload.report===this.editing;await this.port.save({system,account,password,label,...(this.editing?{id:this.editing}:{}),confirmed:true});if(preloadCourseChanged)window.dispatchEvent(new Event('school-preload-changed'));if(preloadReportChanged)window.dispatchEvent(new Event('school-report-preload-changed'));
        this.field('password').value='';this.editing='';await this.reload();this.message('已加密保存在本机');
      }else if(action==='remove'&&id){
        if(!await this.confirm('删除这条本机账号？','只删除保存的配置，不退出当前官网会话，也不删除课表和实验数据。'))return;
        await this.port.remove(id,true);const courseChanged=this.preload.course===id,reportChanged=this.preload.report===id;if(courseChanged)window.dispatchEvent(new Event('school-preload-changed'));if(reportChanged)window.dispatchEvent(new Event('school-report-preload-changed'));if((courseChanged||reportChanged)&&this.preloadPort)try{await this.preloadPort.save({...this.preload,...(courseChanged?{course:null}:{}),...(reportChanged?{report:null}:{})});}catch{await this.reload();throw Error('账号已删除，自动加载设置未能更新；不会改用其他账号');}this.editing='';await this.reload();this.message('本机账号已删除');
      }else if(action==='reset'){
        if(!await this.confirm('清空全部本机账号？','保存的账号密码将被删除；课表、报告、测量数据和当前官网会话保留。'))return;
        await this.port.reset(true);window.dispatchEvent(new Event('school-preload-changed'));window.dispatchEvent(new Event('school-report-preload-changed'));if(this.preloadPort)try{await this.preloadPort.save(defaultSchoolPreload());}catch{await this.reload();throw Error('账号已重置，自动加载设置未能更新；不会改用其他账号');}this.editing='';await this.reload();this.message('本机账号已重置');
      }
    }finally{this.busy=false;this.controls();}
  }
}

export class SavedAccountPicker {
  private token=0;private host:HTMLElement|null=null;private lifetime:AbortController|null=null;
  constructor(private port:Pick<AccountPort,'list'>,private system:'course'|'report',private choose:(account:SavedSchoolAccount)=>Promise<void>,private error:(text:string)=>void){}
  leave(){this.token++;this.lifetime?.abort();this.host=null;}
  mount(host:HTMLElement){this.leave();this.host=host;const token=this.token;this.lifetime=new AbortController();host.innerHTML=`<a class="button secondary compact" href="#/school-accounts/${this.system}">管理本机账号</a>`;
    void this.port.list().then(rows=>{if(token!==this.token||!this.host)return;const available=rows.filter(row=>row.system===this.system&&!row.locked);if(!available.length)return;
      const select=document.createElement('select');select.setAttribute('aria-label','已保存账号');select.innerHTML='<option value="">选择已保存账号</option>'+available.map(row=>`<option value="${row.id}">${esc(row.label?row.label+' · '+row.account:row.account)}</option>`).join('');
      const button=document.createElement('button');button.className='button secondary compact';button.textContent='使用此账号登录';button.disabled=true;
      select.addEventListener('change',()=>{button.disabled=!select.value;},{signal:this.lifetime!.signal});
      button.addEventListener('click',()=>{const row=available.find(value=>value.id===select.value);if(!row)return;button.disabled=true;void this.choose(row).catch(error=>{if(token===this.token){button.disabled=false;this.error((error as Error).message);}});},{signal:this.lifetime!.signal});
      host.prepend(select,button);
    }).catch(()=>{if(token===this.token&&this.host){const note=document.createElement('span');note.className='ocr-warning';note.textContent='本机账号未能读取';this.host.append(note);}});
  }
}
