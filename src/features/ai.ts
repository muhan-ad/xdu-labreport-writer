import {OCRReviewEditor} from './ocr-review.ts';
import {ChartImagePreview} from './chart-image-preview.ts';
import {usableSavedOCR,type SavedOCR} from '../domain/ocr-cache.ts';
import {textHash} from '../domain/ai-library.ts';
import {OCRStudentEditor,type StudentPort} from './ocr-student.ts';
import {studentFromOCR,type OCRStudentSnapshot} from '../domain/ocr-student.ts';
import type {Profile} from '../domain/types.ts';
import {aiProviders,providerForEndpoint,providerDraft} from '../domain/ai-providers.ts';
import { APITutorial } from "./api-tutorial.ts";
import { ai, type AISlot } from "../platform/ai.ts";
import type { Draft, Experiment, Photo, RecordData } from "../domain/types.ts";
import {
  applyOCR,
  ocrRetainsTail,
  ocrPrompt,
  reviewOCR,
  type OCRReview,
} from "../domain/ocr.ts";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
interface Context {
  exp: Experiment;
  doc: RecordData;
  photo: Photo | null;
  imageUrl: string | null;
  blocked: boolean;
}
interface Hooks {
  context(): Context | null;
  apply(context: Context, draft: Draft): Promise<void>;
  notice(text: string): void;
  ocrCache?:{load(id:string):Promise<{value:SavedOCR|null;warning:string;epoch:number}>;save(id:string,value:SavedOCR,epoch:number):Promise<boolean>;clear(id:string):Promise<void>};
  student?:StudentPort;
}
export class AIFeatures {
  private tutorial: APITutorial | null = null;
  private sheet = document.createElement("dialog");
  private controller: AbortController | null = null;
  private serial = 0;
  private selectedSlot: AISlot = "chat";
  private review: OCRReview | null = null;
  private source: Context | null = null;
  private sourceDraft = "";
  private applying = false;
  private configLoading=false;private fetchingModels=false;private models:string[]=[];private modelsPartial=false;
  private savedEndpoint='';private savedKey=false;
  private configWriting=false;
  private inheritVision=false;
  private inheritedBaseModel='';
  private independentDraft:{endpoint:string;model:string;key:string;savedEndpoint:string;savedKey:boolean}|null=null;
  private editor:OCRReviewEditor|null=null;
  private photoPreview=new ChartImagePreview();
  private scanEnabled=true;
  private cacheBinding:{hash:string;epoch:number}|null=null;
  private cached:SavedOCR|null=null;
  private cacheTimer:ReturnType<typeof setTimeout>|undefined;
  private cacheJob:Promise<boolean>=Promise.resolve(true);
  private cacheFlushing=false;
  private includeStudent=false;
  private studentEditor:OCRStudentEditor|null=null;
  constructor(private hooks: Hooks,private recognition:Pick<typeof ai,'status'|'complete'>=ai,private configuration=ai) {
    this.sheet.id = "ai-sheet";
    this.sheet.className = "report-sheet ai-sheet";
    this.sheet.setAttribute("aria-labelledby", "ai-title");
    document.body.append(this.sheet);
    this.sheet.addEventListener('input',()=>this.scheduleCache());this.sheet.addEventListener('change',()=>this.scheduleCache());
    this.sheet.addEventListener('click',e=>{if((e.target as Element).closest('[data-ocr-resize]'))this.scheduleCache();});
    this.sheet.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.back();
    });
    this.sheet.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-ai]",
      );
      if (button && !button.disabled)
        void this.action(button.dataset.ai!).catch((e) =>
          this.message((e as Error).message),
        );
    });
    this.sheet.addEventListener('input',e=>{const input=e.target as HTMLInputElement;if(input.id==='ai-inherit-model'){if(this.controller)this.cancel();this.modelControls();return;}if(input.id==='ai-model-search'){this.renderModels();return;}if(['ai-endpoint','ai-key'].includes(input.id)){if(input.id==='ai-endpoint')this.providerControls();const had=this.fetchingModels||this.models.length>0;if(this.controller)this.cancel();this.models=[];this.modelsPartial=false;const panel=this.sheet.querySelector<HTMLElement>('#ai-model-panel');if(panel)panel.hidden=true;this.modelControls();if(had)this.message('配置已变化，请重新获取模型');}else if(input.id==='ai-model'&&this.controller){this.cancel();this.modelControls();this.message('配置已变化，请重新测试或保存');}});
    this.sheet.addEventListener("change", (e) => {
      if((e.target as HTMLElement).id==='ai-inherit'){void this.toggleInheritance((e.target as HTMLInputElement).checked).catch(e=>this.message(e.message));return;}
      if((e.target as HTMLElement).id==='ai-provider'){void this.applyProvider((e.target as HTMLSelectElement).value).catch(e=>this.message(e.message));return;}
      if((e.target as HTMLElement).id==='ai-popular-model'){const value=(e.target as HTMLSelectElement).value;if(value){this.sheet.querySelector<HTMLInputElement>('#ai-model')!.value=value;this.sheet.querySelector<HTMLInputElement>('#ai-model')!.dispatchEvent(new Event('input',{bubbles:true}));(e.target as HTMLSelectElement).value='';}return;}
      if((e.target as HTMLElement).id==='ai-model-choice'){const value=(e.target as HTMLSelectElement).value;if(value&&this.models.includes(value)){this.sheet.querySelector<HTMLInputElement>('#ai-model')!.value=value;this.message('已选模型，点击加密保存后生效');}return;}
      if ((e.target as HTMLElement).id === "ai-slot") {
        this.cancel();
        this.selectedSlot = (e.target as HTMLSelectElement).value as AISlot;
        void this.config();
      }
    });
  }
  get isOpen() {
    return this.sheet.open;
  }
  get isSaving() {
    return this.applying||this.configWriting||this.cacheFlushing||!!this.studentEditor?.isSaving;
  }
  back() {
    if(this.photoPreview.close())return;
    if (this.tutorial?.isOpen && !this.controller) this.tutorial.close();
    else this.close();
  }
  async close(force=false):Promise<boolean> {
    if(this.cacheFlushing){this.hooks.notice('正在保存识图校对内容，请稍候');return false;}
    if(this.configWriting){this.hooks.notice('正在保存 API 配置，请稍候');return false;}
    if (this.applying||this.studentEditor?.isSaving) {
      this.hooks.notice("正在保存识别数据，请稍候");
      return false;
    }
    if(!force&&!await this.flushReview())return false;
    this.cancel();
    clearTimeout(this.cacheTimer);this.cacheBinding=null;this.cached=null;
    this.photoPreview.close();
    this.tutorial?.dispose();
    this.tutorial = null;
    this.sheet.close();
    this.editor?.leave();this.editor=null;
    this.studentEditor?.leave();this.studentEditor=null;
    this.review = null;
    this.source = null;
    this.independentDraft=null;this.inheritVision=false;
    this.sheet.innerHTML = "";
    return true;
  }
  private cancel() {
    ++this.serial;
    this.controller?.abort();
    this.controller = null;this.fetchingModels=false;
  }
  private layout(title: string, body: string, footer = "") {
    this.studentEditor?.leave();this.studentEditor=null;
    this.photoPreview.close();
    this.editor?.leave();this.editor=null;
    this.sheet.innerHTML = `<header class="report-header"><h2 id="ai-title">${esc(title)}</h2><button class="icon-button" data-ai="close" aria-label="关闭">×</button></header><div class="report-body ai-body">${body}<p id="ai-message" role="status" aria-live="polite"></p></div><footer class="report-footer">${footer}</footer>`;
    if (!this.sheet.open) this.sheet.showModal();
  }
  private message(text: string) {
    const node = this.sheet.querySelector("#ai-message");
    if (node) node.textContent = text;
  }
  private value(id: string) {
    return this.sheet.querySelector<HTMLInputElement>("#" + id)!.value.trim();
  }
  private scheduleCache(){if(!this.editor||!this.hooks.ocrCache)return;clearTimeout(this.cacheTimer);this.cacheTimer=setTimeout(()=>this.rememberReview(),250);}
  private rememberReview():Promise<boolean>{
    clearTimeout(this.cacheTimer);const binding=this.cacheBinding,context=this.source,review=this.review,editor=this.editor,store=this.hooks.ocrCache;
    if(!context||!review||!editor||!store)return Promise.resolve(true);
    if(!binding)return Promise.resolve(false);
    const value:SavedOCR={version:1,experimentId:context.exp.id,sourceHash:binding.hash,savedAt:new Date().toISOString(),scan:this.scanEnabled,onlyEmpty:this.sheet.querySelector<HTMLInputElement>('#ocr-empty')?.checked??true,review:structuredClone(review),snapshot:editor.snapshot()};
    if(this.studentEditor)value.student=this.studentEditor.snapshot();
    this.cacheJob=store.save(context.exp.id,value,binding.epoch).then(ok=>{if(!ok)throw Error('识图缓存已变化');return true;}).catch(()=>{this.hooks.notice('上次识图结果暂未保存，请重试');return false;});
    return this.cacheJob;
  }
  private cacheFailure(){
    this.message('识图校对内容未能保存，请重试；仍然关闭可能丢失本次修改。');
    if(!this.sheet.querySelector('[data-ocr-save-error]')){
      const warning=document.createElement('span');warning.dataset.ocrSaveError='';warning.className='ocr-save-error';warning.setAttribute('role','alert');warning.textContent='校对内容保存失败，请重试关闭或仍然关闭。';this.sheet.querySelector('.report-footer')?.prepend(warning);
    }
    if(!this.sheet.querySelector('[data-ai=close-unsaved]')){
      const button=document.createElement('button');button.className='button secondary';button.dataset.ai='close-unsaved';button.textContent='仍然关闭';this.sheet.querySelector('.report-footer')?.append(button);
    }
  }
  private async recoverCacheBinding(){
    const context=this.source,store=this.hooks.ocrCache,serial=this.serial;
    if(!context?.photo||!store)throw Error('识图缓存状态不可用');
    const valid=()=>{const current=this.hooks.context();return serial===this.serial&&this.source===context&&this.sheet.open&&current?.exp.id===context.exp.id&&current.photo?.path===context.photo?.path&&current.doc.date===context.doc.date&&current.doc.updatedAt===context.doc.updatedAt&&JSON.stringify(current.doc.draft)===this.sourceDraft;};
    if(!valid())throw Error('实验数据或照片已变化');
    const hash=await textHash(JSON.stringify([context.exp.id,context.exp.schema,context.doc.date,context.doc.updatedAt,context.doc.draft,context.photo.path]));
    const saved=await store.load(context.exp.id);
    if(!valid())throw Error('实验数据或照片已变化');
    this.cacheBinding={hash,epoch:saved.epoch};
  }
  private async flushReview():Promise<boolean>{
    if(!this.editor||!this.hooks.ocrCache)return true;
    if(this.cacheFlushing)return false;
    this.cacheFlushing=true;
    const controls=[...this.sheet.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select')].map(node=>({node,disabled:node.disabled}));
    controls.forEach(({node})=>node.disabled=true);
    this.message('正在保存识图校对内容…');
    try{
      if(!this.cacheBinding)await this.recoverCacheBinding();
      if(await this.rememberReview()){this.sheet.querySelector('[data-ai=close-unsaved]')?.remove();this.sheet.querySelector('[data-ocr-save-error]')?.remove();return true;}
      this.cacheFailure();
      return false;
    }catch{
      this.cacheFailure();return false;
    }finally{
      this.cacheFlushing=false;controls.forEach(({node,disabled})=>node.disabled=disabled);
    }
  }
  private showReview(context:Context,saved?:SavedOCR){
    const review=this.review!;
    this.layout('核对识别结果',`<p>${esc(context.exp.name)}</p>${this.photoHTML(context,'原始测量记录')}${this.studentChoice()}<label class="ai-check"><input type="checkbox" id="ocr-empty" ${saved?.onlyEmpty===false?'':'checked'}>仅填入空白数据</label><div id="ocr-review-editor"></div>${review.errors.length?`<p class="ocr-warning">${review.errors.map(esc).join('<br>')}</p>`:''}<p class="muted">空白表示未识别，不清除已有值。</p>`, '<button class="button secondary" data-ai="recognize">重新识别</button><button class="button" data-ai="apply">录入勾选项</button>');
    this.editor=new OCRReviewEditor(context.exp.schema,review,text=>this.message(text));this.editor.mount(this.sheet.querySelector<HTMLElement>('#ocr-review-editor')!);if(saved)this.editor.restore(saved.snapshot);
    if(saved?.student)this.mountStudent(saved.student.values,saved.student.baseline,saved.student);
    if(this.hooks.ocrCache&&!this.cacheBinding)this.cacheFailure();
  }
  private studentChoice(){return this.hooks.student?`<label class="ai-check"><input type="checkbox" id="ocr-student" ${this.includeStudent?'checked':''}>同时识别姓名、学号和班级</label>`:'';}
  private mountStudent(values:Profile,baseline:Profile,saved?:OCRStudentSnapshot){const port=this.hooks.student,source=this.source,draft=this.sourceDraft;if(!port||!source)return;const guard=()=>{const current=this.hooks.context();if(!current||current.exp.id!==source.exp.id||current.photo?.path!==source.photo?.path||JSON.stringify(current.doc.draft)!==draft)throw Error('实验数据或照片已变化，请重新打开识图');};const host=document.createElement('div');this.sheet.querySelector('#ocr-review-editor')!.before(host);this.studentEditor=new OCRStudentEditor(values,baseline,{load:async()=>{guard();return port.load();},apply:async(patch,expected)=>{guard();return port.apply(patch,expected);}},()=>this.scheduleCache(),text=>this.message(text),saved);this.studentEditor.mount(host);this.sheet.querySelector('[data-ai=apply]')!.textContent='录入测量数据';}
  private providerControls(){
    const select=this.sheet.querySelector<HTMLSelectElement>('#ai-provider');if(!select)return;
    select.value=providerForEndpoint(this.value('ai-endpoint'));
    const popular=this.sheet.querySelector<HTMLSelectElement>('#ai-popular-model')!,provider=aiProviders.find(p=>p.id===select.value),models=provider?.[this.selectedSlot]??[];
    popular.hidden=!models.length;popular.innerHTML='<option value="">常用模型</option>'+models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
    this.keyState();
  }
  private keyState(){const node=this.sheet.querySelector('#ai-key-state');if(node)node.textContent=this.savedKey&&this.value('ai-endpoint').replace(/\/+$/,'')===this.savedEndpoint.replace(/\/+$/,'')?'已加密保存 · 密钥留空可保留当前密钥':'此地址尚未保存密钥';}
  private async toggleInheritance(enabled:boolean){
    if(this.configLoading||this.configWriting||this.selectedSlot!=='vision')return;
    this.cancel();const serial=this.serial;
    if(enabled&&!this.inheritVision)this.independentDraft={endpoint:this.value('ai-endpoint'),model:this.value('ai-model'),key:this.value('ai-key'),savedEndpoint:this.savedEndpoint,savedKey:this.savedKey};
    this.configLoading=true;this.sheet.querySelector<HTMLFieldSetElement>('#ai-config-fields')!.disabled=true;this.modelControls();
    try{
      const stored=!enabled&&this.independentDraft?null:await this.configuration.status(enabled?'chat':'vision',enabled?undefined:false);
      if(serial!==this.serial)return;
      const draft=!enabled&&this.independentDraft?this.independentDraft:{endpoint:stored?.endpoint??'',model:stored?.model??'',key:'',savedEndpoint:stored?.endpoint??'',savedKey:stored?.hasKey??false};
      this.savedEndpoint=draft.savedEndpoint;this.savedKey=draft.savedKey;this.inheritVision=enabled;
      if(enabled)this.inheritedBaseModel=stored?.model??'';
      this.sheet.querySelector<HTMLInputElement>('#ai-inherit')!.checked=enabled;
      for(const [id,value] of [['ai-endpoint',draft.endpoint],['ai-model',draft.model],['ai-key',draft.key]])this.sheet.querySelector<HTMLInputElement>('#'+id)!.value=value;
      this.models=[];this.sheet.querySelector<HTMLElement>('#ai-model-panel')!.hidden=true;this.providerControls();this.message('保存后生效');
    }catch(e){if(serial===this.serial){this.sheet.querySelector<HTMLInputElement>('#ai-inherit')!.checked=this.inheritVision;this.message('配置未能读取，请重试');}throw e;}
    finally{if(serial===this.serial){this.configLoading=false;this.sheet.querySelector<HTMLFieldSetElement>('#ai-config-fields')!.disabled=false;this.modelControls();}}
  }
  private async applyProvider(id:string){
    if(this.configLoading||this.configWriting)return;
    if(this.inheritVision){const serial=this.serial;await this.toggleInheritance(false);if(this.serial!==serial+1||!this.sheet.open||this.inheritVision)return;}
    if(this.configLoading)return;
    this.cancel();this.models=[];this.modelsPartial=false;this.sheet.querySelector<HTMLElement>('#ai-model-panel')!.hidden=true;
    const old={endpoint:this.value('ai-endpoint'),model:this.value('ai-model'),key:this.value('ai-key')},next=providerDraft(id,this.selectedSlot,old);
    this.sheet.querySelector<HTMLInputElement>('#ai-endpoint')!.value=next.endpoint;
    this.sheet.querySelector<HTMLInputElement>('#ai-model')!.value=next.model;
    this.sheet.querySelector<HTMLInputElement>('#ai-key')!.value=next.key;
    if(id!=='custom')this.providerControls();
    else this.sheet.querySelector<HTMLSelectElement>('#ai-popular-model')!.hidden=true;
    this.modelControls();this.message(next.endpoint!==old.endpoint?'已填入地址和模型；请填写此服务商的密钥，核对后保存':id==='custom'?'可手动修改地址和模型，保存后生效':'已填入常用模型，核对后保存');
  }
  async config(showTutorial = false) {
    this.tutorial?.dispose();this.cancel();this.models=[];this.modelsPartial=false;this.savedEndpoint='';this.savedKey=false;this.inheritVision=false;this.independentDraft=null;
    const serial = ++this.serial;this.configLoading=true;
    this.layout(
      "AI 服务",
      `<div id="ai-config-home"><div class="ai-config-tools"><button id="ai-tutorial-open" class="button secondary" data-ai="tutorial-open">DeepSeek 配置教程</button></div><fieldset id="ai-config-fields" class="ai-config-fields" disabled><label class="ai-field">配置用途<select id="ai-slot"><option value="chat" ${this.selectedSlot === "chat" ? "selected" : ""}>报告问答与润色</option><option value="vision" ${this.selectedSlot === "vision" ? "selected" : ""}>图片识别</option></select></label><label class="ai-check" ${this.selectedSlot==="vision"?"":"hidden"}><input id="ai-inherit" type="checkbox">继承报告问答配置</label><label id="ai-inherit-model-row" class="ai-field" hidden>识图模型（可选）<input id="ai-inherit-model" maxlength="256" placeholder="留空使用问答模型" autocomplete="off" spellcheck="false"></label><p id="ai-inherit-summary" class="muted" hidden></p><fieldset id="ai-provider-fields" class="ai-config-fields"><label class="ai-field">API 提供商<select id="ai-provider">${aiProviders.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}<option value="custom">OpenAI 兼容 / 自定义</option></select></label><label class="ai-field">API 地址<input id="ai-endpoint" type="url" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false"></label><label class="ai-field">模型名称<input id="ai-model" maxlength="256" placeholder="填写服务商提供的模型名称" autocomplete="off" spellcheck="false"></label><select id="ai-popular-model" aria-label="常用模型" hidden></select><label class="ai-field">API Key<input id="ai-key" maxlength="4096" type="password" placeholder="输入密钥" autocomplete="off" autocapitalize="off" spellcheck="false"></label><div class="ai-inline"><button class="button secondary" data-ai="models">获取模型</button><button class="button secondary" data-ai="models-stop" hidden>停止获取</button></div><div id="ai-model-panel" hidden><label class="ai-field">搜索模型<input id="ai-model-search" type="search" placeholder="输入模型名称片段" autocomplete="off"></label><label class="ai-field">选择模型<select id="ai-model-choice"></select></label></div><p id="ai-key-state">正在读取本机配置…</p><p class="muted">密钥在本机加密保存；识图时照片发送给所选服务商。</p></fieldset></fieldset></div><section id="ai-tutorial" hidden></section>`,
      `<button class="button secondary" data-ai="clear">清除配置</button><button class="button secondary" data-ai="test">测试连接</button><button class="button" data-ai="save">加密保存</button>`,
    );
    this.tutorial = new APITutorial(this.sheet, (s) => this.message(s),()=>{void this.applyProvider('deepseek').catch(e=>this.message(e.message));});
    if (showTutorial) this.tutorial.open();
    this.sheet.querySelectorAll<HTMLButtonElement>(".report-footer button").forEach(b => b.disabled = true);
    try {
      const status = await this.configuration.status(this.selectedSlot);
      if (serial !== this.serial) return;
      this.savedEndpoint=status.endpoint??'';this.savedKey=status.hasKey;
      this.inheritVision=this.selectedSlot==='vision'&&status.inheritsChat===true;
      this.inheritedBaseModel=status.baseModel??status.model??'';
      this.sheet.querySelector<HTMLInputElement>('#ai-inherit-model')!.value=status.inheritModel??'';
      this.sheet.querySelector<HTMLInputElement>('#ai-inherit')!.checked=this.inheritVision;
      this.sheet.querySelector<HTMLInputElement>("#ai-endpoint")!.value =
        status.endpoint ??
        (this.selectedSlot === "chat"
          ? "https://api.deepseek.com"
          : "https://api.siliconflow.cn/v1");
      this.sheet.querySelector<HTMLInputElement>("#ai-model")!.value =
        status.model ??
        (this.selectedSlot === "chat"
          ? "deepseek-flash"
          : "Qwen/Qwen3-VL-32B-Instruct");
      this.sheet.querySelector("#ai-key-state")!.textContent = status.hasKey
        ? "已加密保存 · 密钥留空可保留当前密钥"
        : "尚未保存密钥";
      this.providerControls();
    } catch (e) {
      if (serial === this.serial) this.message((e as Error).message);
    } finally {
      if (serial === this.serial) {
        this.configLoading=false;this.providerControls();this.sheet.querySelector<HTMLFieldSetElement>("#ai-config-fields")!.disabled = false;
        this.sheet.querySelectorAll<HTMLButtonElement>(".report-footer button").forEach(b => b.disabled = false);this.modelControls();
      }
    }
  }
  private modelControls(){const fields=this.sheet.querySelector<HTMLFieldSetElement>('#ai-provider-fields');if(fields){fields.hidden=this.inheritVision;fields.disabled=this.inheritVision;}const modelRow=this.sheet.querySelector<HTMLElement>('#ai-inherit-model-row');if(modelRow)modelRow.hidden=!this.inheritVision;const summary=this.sheet.querySelector<HTMLElement>('#ai-inherit-summary');if(summary){summary.hidden=!this.inheritVision;summary.textContent=this.savedKey?`当前使用 ${this.value('ai-inherit-model')||this.inheritedBaseModel} · ${this.value('ai-endpoint')}。请确认模型支持图片。`:'请先配置报告问答 API';}const busy=!!this.controller||this.configLoading;this.sheet.querySelectorAll<HTMLButtonElement>('.report-footer button,[data-ai="models"]').forEach(button=>button.disabled=busy);const stop=this.sheet.querySelector<HTMLButtonElement>('[data-ai="models-stop"]');if(stop){stop.hidden=!this.fetchingModels;stop.disabled=false;}const choices=this.sheet.querySelector<HTMLSelectElement>('#ai-model-choice');if(choices)choices.disabled=busy;}
  private renderModels(){const select=this.sheet.querySelector<HTMLSelectElement>('#ai-model-choice');if(!select)return;const query=this.sheet.querySelector<HTMLInputElement>('#ai-model-search')?.value.trim().toLowerCase()??'',matches=this.models.filter(m=>m.toLowerCase().includes(query));select.innerHTML=`<option value="">${matches.length>200?'匹配 '+matches.length+' 项，显示前 200 项；可继续搜索':'请选择模型（'+matches.length+' 项）'}</option>${matches.slice(0,200).map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('')}`;}
  private async fetchModels(){if(this.controller||this.configLoading)return;const serial=this.serial,slot=this.selectedSlot,endpoint=this.value('ai-endpoint'),key=this.value('ai-key'),controller=new AbortController();this.controller=controller;this.fetchingModels=true;this.models=[];this.sheet.querySelector<HTMLElement>('#ai-model-panel')!.hidden=true;this.modelControls();this.message('正在获取模型列表…');try{const result=await this.configuration.models({slot,endpoint,key},controller.signal);if(serial!==this.serial||controller.signal.aborted||!this.sheet.open)return;if(slot!==this.selectedSlot||endpoint!==this.value('ai-endpoint')||key!==this.value('ai-key'))throw Error('配置已变化，未采用旧模型列表');if(!Array.isArray(result.models)||!result.models.length||result.models.length>10000||result.models.some(m=>typeof m!=='string'||!m.trim()||m.length>256||/[\u0000-\u001f\u007f]/.test(m)))throw Error('模型列表格式不兼容，请手动填写');this.models=[...new Set(result.models)];this.modelsPartial=result.partial;this.sheet.querySelector<HTMLInputElement>('#ai-model-search')!.value='';this.sheet.querySelector<HTMLElement>('#ai-model-panel')!.hidden=false;this.renderModels();this.message(`获取到 ${this.models.length} 个模型${this.modelsPartial?'；服务返回部分列表':''}，选择后需另行保存`);}catch(error){if(serial===this.serial&&!controller.signal.aborted)this.message((error as Error).message);}finally{if(this.controller===controller){this.controller=null;this.fetchingModels=false;}if(serial===this.serial)this.modelControls();}}
  async ocr() {
    const context = this.hooks.context();
    if (!context || context.blocked) return;
    if (!context.photo || !context.imageUrl) {
      this.hooks.notice("请先添加原始数据照片，再进行识别");
      return;
    }
    if(!await this.flushReview())return;this.cancel();this.cacheBinding=null;this.cached=null;
    this.source = context;
    this.sourceDraft = JSON.stringify(context.doc.draft);
    this.includeStudent=false;
    this.review = null;
    this.layout(
      "识别图片并录入",
      `<p>${esc(context.exp.name)}</p>${this.photoHTML(context,'待识别的原始测量记录')}<label class="ai-check"><input type="checkbox" id="ocr-scan" ${this.scanEnabled?'checked':''}>扫描增强</label>${this.studentChoice()}<p>照片将发送至已配置的识图服务，核对后再录入。</p><div class="ai-inline"><button class="button secondary" data-ai="image-preview">预览处理图</button><button class="button secondary" data-ai="config">配置图片识别 API</button><button class="button" data-ai="recognize">开始识别</button></div>`,
      `<button class="button secondary" data-ai="close">关闭</button>`,
    );
    const store=this.hooks.ocrCache;if(!store)return;
    const serial=this.serial;
    const cacheControls=[...this.sheet.querySelectorAll<HTMLButtonElement>('[data-ai=recognize],[data-ai=image-preview]')];cacheControls.forEach(e=>e.disabled=true);
    try{await this.cacheJob;const hash=await textHash(JSON.stringify([context.exp.id,context.exp.schema,context.doc.date,context.doc.updatedAt,context.doc.draft,context.photo.path])),saved=await store.load(context.exp.id);
      if(serial!==this.serial||!this.sheet.open)return;this.cacheBinding={hash,epoch:saved.epoch};
      if(usableSavedOCR(context.exp,saved.value,hash)){this.cached=saved.value;const button=document.createElement('button');button.type='button';button.className='button';button.dataset.ai='resume';button.textContent='继续上次校对';this.sheet.querySelector('.ai-inline')!.prepend(button);const recognize=this.sheet.querySelector<HTMLButtonElement>('[data-ai=recognize]')!;recognize.classList.add('secondary');recognize.textContent='重新识别';}
      if(saved.warning)this.message(saved.warning);
    }catch{if(serial===this.serial&&this.sheet.open){this.message('上次识图暂不可读，可清除后重新识别');const button=document.createElement('button');button.className='button secondary';button.dataset.ai='discard-ocr';button.textContent='清除上次识图';this.sheet.querySelector('.ai-inline')!.prepend(button);}}
    finally{if(serial===this.serial)cacheControls.forEach(e=>e.disabled=false);}
  }
  private photoHTML(context:Context,alt:string){return `<button type="button" class="ocr-photo-open" data-ai="photo-zoom" aria-label="放大原始数据照片"><img class="ocr-photo" src="${esc(context.imageUrl)}" alt="${esc(alt)}"><span class="ocr-photo-zoom-marker" aria-hidden="true">⤢</span></button>`;}
  private async image(url:string,signal:AbortSignal){
    const {prepareOCRImage}=await import('../platform/ocr-image.ts');
    return (await prepareOCRImage(url,this.scanEnabled,signal)).dataUrl;
  }
  private async previewImage(){
    const context=this.source;if(!context?.imageUrl||this.controller)return;
    this.scanEnabled=this.sheet.querySelector<HTMLInputElement>('#ocr-scan')?.checked??this.scanEnabled;
    const serial=this.serial,controller=new AbortController();this.controller=controller;
    const controls=[...this.sheet.querySelectorAll<HTMLInputElement|HTMLButtonElement>('#ocr-scan,[data-ai=image-preview],[data-ai=recognize]')];controls.forEach(e=>e.disabled=true);
    this.message('正在处理图片…');
    try{const url=await this.image(context.imageUrl,controller.signal);const current=this.hooks.context();if(serial!==this.serial||controller.signal.aborted||current?.exp.id!==context.exp.id||current.photo?.path!==context.photo?.path)return;this.photoPreview.openPhoto(url,this.scanEnabled?'扫描增强预览':'压缩预览');this.message('');}
    catch(error){if(serial===this.serial&&!controller.signal.aborted)this.message((error as Error).message);}
    finally{if(this.controller===controller)this.controller=null;if(serial===this.serial)controls.forEach(e=>e.disabled=false);}
  }
  private async recognize() {
    const context = this.source;
    if (!context?.imageUrl) return;
    const current=this.hooks.context();if(!current||current.exp.id!==context.exp.id||current.photo?.path!==context.photo?.path||JSON.stringify(current.doc.draft)!==this.sourceDraft)throw Error('实验数据或照片已变化，请重新打开识图');
    this.scanEnabled=this.sheet.querySelector<HTMLInputElement>('#ocr-scan')?.checked??this.scanEnabled;
    this.includeStudent=this.sheet.querySelector<HTMLInputElement>('#ocr-student')?.checked??false;
    if(!await this.flushReview())return;this.cancel();this.review=null;
    const serial = this.serial,
      controller = new AbortController();
    this.controller = controller;
    this.layout(
      "识别图片并录入",
      `<p>${esc(context.exp.name)}</p>${this.photoHTML(context,'待识别的测量记录')}<div class="ai-inline"></div>`,
      `<button class="button secondary" data-ai="close">取消并关闭</button>`,
    );
    this.message("正在识别，可随时停止；结果不会自动覆盖数据");
    this.sheet.querySelector(".ai-inline")!.innerHTML =
      '<button class="button secondary" data-ai="stop">停止识别</button>';
    try {
      const status = await this.recognition.status("vision");
      if (!status.hasKey) throw Error("请先在 AI 服务中配置图片识别 API");
      const studentBaseline=this.includeStudent&&this.hooks.student?await this.hooks.student.load():null;
      const url = await this.image(context.imageUrl,controller.signal);
      if (serial !== this.serial) return;
      const result = await this.recognition.complete(
        "vision",
        [
          {
            role: "system",
            content: ocrPrompt(context.exp.name, context.exp.schema,this.includeStudent),
          },
          {
            role: "user",
            content: [
              { type: "text", text: "请按要求识别这张原始数据照片。" },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
        controller.signal,
      );
      if (serial !== this.serial) return;
      const live=this.hooks.context();if(!live||live.exp.id!==context.exp.id||live.photo?.path!==context.photo?.path||JSON.stringify(live.doc.draft)!==this.sourceDraft)throw Error('实验数据或照片已变化，未采用旧识别结果');
      this.review = reviewOCR(context.exp.schema, result.text);
      this.showReview(context);if(studentBaseline)this.mountStudent(studentFromOCR(result.text),studentBaseline);this.rememberReview();
    } catch (e) {
      if (serial === this.serial) {
        this.message((e as Error).message);
        const row = this.sheet.querySelector(".ai-inline");
        if (row)
          row.innerHTML =
            '<button class="button secondary" data-ai="config">配置图片识别 API</button><button class="button" data-ai="recognize">重试识别</button>';
      }
    } finally {
      if (serial === this.serial) this.controller = null;
    }
  }
  private async action(name: string) {
    if(this.cacheFlushing)return;
    if(this.studentEditor?.isSaving){this.hooks.notice('正在保存学生信息，请稍候');return;}
    if(this.configWriting){this.hooks.notice('正在保存 API 配置，请稍候');return;}
    if(this.applying){if(name==='close')this.close();return;}
    if(name==='models-stop'){this.cancel();this.modelControls();this.message('已停止获取模型');return;}
    if(name==='models')return this.fetchModels();
    if (name.startsWith("tutorial-")) {
      if (this.controller) return;
      return this.tutorial?.action(name);
    }
    if (name === "close") return this.close();
    if (name === "close-unsaved") return this.close(true);
    if(name==='resume'){const context=this.source,saved=this.cached,current=this.hooks.context();if(context&&saved&&this.cacheBinding&&usableSavedOCR(context.exp,saved,this.cacheBinding.hash)){if(!current||current.exp.id!==context.exp.id||current.photo?.path!==context.photo?.path||JSON.stringify(current.doc.draft)!==this.sourceDraft)throw Error('实验数据或照片已变化，请重新打开识图');this.review=structuredClone(saved.review);this.scanEnabled=saved.scan;this.showReview(context,saved);}return;}
    if(name==='discard-ocr'){const context=this.source;if(context&&this.hooks.ocrCache){this.cacheBinding=null;await this.hooks.ocrCache.clear(context.exp.id);if(this.source===context)await this.ocr();}return;}
    if(name==='photo-zoom'){const source=this.source,current=this.hooks.context();if(source?.imageUrl&&current?.exp.id===source.exp.id&&current.photo?.path===source.photo?.path)this.photoPreview.openPhoto(source.imageUrl,'原始数据照片');return;}
    if(name==='image-preview')return this.previewImage();
    if (name === "config") {
      if(!await this.close())return;
      this.selectedSlot = "vision";
      return this.config();
    }
    if (name === "stop") {
      this.cancel();
      const row = this.sheet.querySelector(".ai-inline");
      if (row)
        row.innerHTML =
          '<button class="button" data-ai="recognize">重新识别</button>';
      return this.message("已停止识别");
    }
    if (name === "recognize") return this.recognize();
    if (name === "apply") {
      const context = this.source,
        current = this.hooks.context();
      if (!context || !current || !this.review) return;
      if (
        current.exp.id !== context.exp.id ||
        current.photo?.path !== context.photo?.path ||
        JSON.stringify(current.doc.draft) !== this.sourceDraft
      )
        throw Error("实验数据或照片已变化，请重新识别后核对");
      const selected = this.editor?.selected()??[];
      if (!selected.length) throw Error("请至少勾选一项识别数据");
      const corrected = this.editor?.corrected()??this.review;
      const retainedTail = ocrRetainsTail(context.exp.schema,current.doc.draft,corrected,selected);
      const draft = applyOCR(
        context.exp.schema,
        current.doc.draft,
        corrected,
        selected,
        this.sheet.querySelector<HTMLInputElement>("#ocr-empty")!.checked,
      );
      this.applying = true;
      let cacheCleanupFailed=false;
      this.sheet.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(e=>e.disabled=true);
      try {
        await this.hooks.apply(context, draft);
        this.cacheBinding=null;clearTimeout(this.cacheTimer);
        if(this.hooks.ocrCache)await this.hooks.ocrCache.clear(context.exp.id).catch(()=>{cacheCleanupFailed=true;});
      } finally {
        this.applying = false;
        this.sheet.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(e=>e.disabled=false);
        this.editor?.setDisabled(false);
      }
      await this.close(true); // The review was explicitly applied; do not recreate its cleared cache.
      this.hooks.notice(cacheCleanupFailed?'识别数据已录入，但上次识图缓存未能清除':retainedTail?'识别数据已保存；已有末尾测点已保留':'识别数据已录入并保存，请继续核对实验数据');
      return;
    }
    if (name === "save" || name === "test" || name === "clear") {
      if (this.controller) return;
      const controller = new AbortController();
      this.controller = controller;
      const serial = this.serial,
        slot = this.selectedSlot;
      this.configWriting=name!=='test';if(this.configWriting)this.sheet.querySelector<HTMLFieldSetElement>('#ai-config-fields')!.disabled=true;
      const buttons = [
        ...this.sheet.querySelectorAll<HTMLButtonElement>(
          ".report-footer button",
        ),
      ];
      buttons.forEach((b) => (b.disabled = true));this.modelControls();
      try {
        if (name === "clear") {
          await this.configuration.clear(slot);
          if (serial === this.serial) await this.config();
          return;
        }
        if(name==='test'){this.message('正在测试当前填写的配置，会发起一次小请求');const result=await this.configuration.test({slot,endpoint:this.value('ai-endpoint'),model:this.inheritVision?this.value('ai-inherit-model'):this.value('ai-model'),key:this.value('ai-key'),inheritChat:this.inheritVision},controller.signal);if(serial===this.serial)this.message(`连接成功 · ${(result.elapsedMs/1000).toFixed(1)} 秒 · 本次测试未保存配置${slot==='vision'?'；文本测试不代表已验证图片能力':''}`);return;}
        const saved=await this.configuration.configure(
          slot,
          this.value("ai-endpoint"),
          this.inheritVision?this.value('ai-inherit-model'):this.value("ai-model"),
          this.value("ai-key"),
          this.inheritVision,
        );
        if (serial !== this.serial) return;
        this.savedEndpoint=saved.endpoint??this.value('ai-endpoint');this.savedKey=saved.hasKey;
        this.sheet.querySelector<HTMLInputElement>("#ai-key")!.value = "";
        this.sheet.querySelector("#ai-key-state")!.textContent =
          "已加密保存 · 密钥留空可保留当前密钥";
        this.message("配置已加密保存到本机");
      } finally {
        this.configWriting=false;
        if (serial === this.serial) {
          this.sheet.querySelector<HTMLFieldSetElement>('#ai-config-fields')!.disabled=this.configLoading;
          this.controller = null;
          buttons.forEach((b) => (b.disabled = false));this.modelControls();
        }
      }
    }
  }
}
