import {chartWidth} from '../domain/chart-width.ts';
import {plotFigures,extractPlotCode,type AdoptedAIPlot,type AIPlotImage,type PlotRepair} from '../domain/ai-plot.ts';
import {generatePlotWithRepair} from '../domain/plot-workflow.ts';
import {textHash} from '../domain/ai-library.ts';
import type {IsolatedPlotResult} from '../engine/ai-plot-client.ts';
import type {PlotHistoryEntry,PlotHistorySummary} from '../domain/plot-history.ts';
export interface PlotContext {experimentId:string;source:string;data:Record<string,unknown>;sections:string[];}
export interface AIPlotHooks {
  context:()=>PlotContext|null;
  selection:()=>AdoptedAIPlot|undefined;
  ask:(requirement:string,signal:AbortSignal,progress:(text:string)=>void)=>Promise<string>;
  repair?:(requirement:string,repair:PlotRepair,signal:AbortSignal,progress:(text:string)=>void)=>Promise<string>;
  run:(job:{code:string;data:Record<string,unknown>},signal:AbortSignal,progress:(text:string)=>void)=>Promise<IsolatedPlotResult>;
  stage:(id:string,bytes:Uint8Array)=>Promise<AIPlotImage>;
  read:(id:string,image:AIPlotImage)=>Promise<Uint8Array>;
  save:(id:string,selection:AdoptedAIPlot|undefined)=>Promise<void>;
  confirm:()=>Promise<boolean>;
  changed:()=>void;
  history?:{list:(id:string)=>Promise<PlotHistorySummary[]>;read:(id:string,item:string)=>Promise<PlotHistoryEntry>;append:(entry:PlotHistoryEntry)=>Promise<void>;remove:(id:string,item:string)=>Promise<void>;clear:(id:string)=>Promise<void>;confirm:()=>Promise<boolean>};
}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const rich=(value:string)=>esc(value.replace(/\$([^$]+)\$/g,'$1')).replace(/([_^])\{([^{}]+)\}/g,(_,op,text)=>`<${op==='_'?'sub':'sup'}>${text}</${op==='_'?'sub':'sup'}>`);
export class AIPlotView {
  private host:HTMLElement|null=null;
  private lifetime:AbortController|null=null;
  private controller:AbortController|null=null;
  private token=0;
  private saving=false;
  private initial:PlotContext|null=null;
  private sourceHash:string|undefined;
  private draft={widthCm:14,requirement:'',code:'',caption:'',section:'数据处理',embed:true};
  private preview:{bytes:Uint8Array;source:string;code:string;image?:AIPlotImage;figures?:{bytes:Uint8Array;caption:string;section:string;embed:boolean;image?:AIPlotImage}[]}|null=null;
  private figureIndex=0;
  private url='';
  private zoomDialog:HTMLDialogElement|null=null;
  private historyPage=0;private remembered='';
  private failed:{source:string;code:string;error:string}|null=null;
  constructor(private hooks:AIPlotHooks){}
  get isBusy(){return !!this.controller||this.saving;}
  get isSaving(){return this.saving;}
  closeZoom(){if(!this.zoomDialog)return false;this.zoomDialog.close();this.zoomDialog.remove();this.zoomDialog=null;return true;}
  stop(){const controller=this.controller;this.controller=null;controller?.abort();if(controller){this.message('已停止绘图');this.controls();}}
  leave(){this.closeZoom();this.token++;this.controller?.abort();this.controller=null;this.lifetime?.abort();this.lifetime=null;this.host=null;this.preview=null;this.failed=null;this.saving=false;if(this.url)URL.revokeObjectURL(this.url);this.url='';}
  mount(host:HTMLElement){
    const context=this.hooks.context(),preserve=this.initial?.experimentId===context?.experimentId&&this.initial?.source===context?.source;
    this.leave();this.host=host;this.initial=context;const selected=this.hooks.selection(),token=this.token;
    if(!preserve){this.sourceHash=selected?.sourceHash;
      this.draft={widthCm:chartWidth(selected?.widthCm),requirement:selected?.requirement??'',code:selected?.code??'',caption:selected?.caption??'',section:selected?.section??this.initial?.sections[0]??'数据处理',embed:selected?.embed??true};}
    this.lifetime=new AbortController();
    host.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-ai-plot]');if(!button||button.disabled)return;void this.action(button.dataset.aiPlot!).catch(error=>{if(token===this.token)this.message((error as Error).message,true);});},{signal:this.lifetime.signal});
    host.addEventListener('input',event=>{const field=event.target as HTMLInputElement;const key=field.dataset.aiPlotField as keyof typeof this.draft;if(!key||this.isBusy)return;if(key==='embed')this.draft.embed=field.checked;else if(key==='widthCm')this.draft.widthCm=Number(field.value||NaN);else this.draft[key]=field.value;
      if(key==='code'){this.failed=null;this.preview=null;this.clearImage();this.message('代码已修改，请重新预览并采用');}
      if(key==='caption'){const caption=this.host?.querySelector('figcaption');if(caption)caption.innerHTML=rich(this.draft.caption);}
      if(this.preview?.figures&&['caption','section','embed'].includes(key)){Object.assign(this.preview.figures[this.figureIndex],{caption:this.draft.caption,section:this.draft.section,embed:this.draft.embed});}
      this.controls();
    },{signal:this.lifetime.signal});
    this.render();
    if(this.hooks.history){const box=document.createElement('details');box.className='report-options';box.innerHTML='<summary>代码历史</summary><div class="ai-plot-history"></div>';host.append(box);box.addEventListener('toggle',()=>{if(box.open)void this.historyAction('history-list').catch(e=>this.message((e as Error).message,true));},{signal:this.lifetime.signal});}
    if(selected&&this.initial&&selected.experimentId===this.initial.experimentId){
      this.message('正在读取已采用图表…');
      void Promise.all(plotFigures(selected).map(async f=>({...f,bytes:await this.hooks.read(selected.experimentId,f.image)}))).then(async figures=>{
        if(token!==this.token||!this.initial)return;
        const source=this.initial.source;
        if(await textHash(source)!==selected.sourceHash){this.message('数据已变化，请重新生成并采用图表',true);return;}
        if(token!==this.token||this.isBusy||this.preview||this.draft.code!==selected.code||this.hooks.selection()?.image.id!==selected.image.id)return;
        this.figureIndex=0;Object.assign(this.draft,{caption:figures[0].caption,section:figures[0].section,embed:figures[0].embed});for(const key of ['caption','section'] as const)this.host!.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-ai-plot-field="${key}"]`)!.value=this.draft[key];this.host!.querySelector<HTMLInputElement>('[data-ai-plot-field="embed"]')!.checked=this.draft.embed;this.preview={bytes:figures[0].bytes,source,code:selected.code,image:selected.image,figures};this.showImage();this.message('已采用此图');this.controls();
      }).catch(error=>{if(token===this.token)this.message((error as Error).message,true);});
    }
  }
  private render(){
    if(!this.host)return;const sections=[...new Set([...(this.initial?.sections??[]),this.draft.section])];
    this.host.innerHTML=`<section class="report-options ai-plot-panel"><h3>AI 绘图</h3><label class="ai-field">绘图需求<textarea data-ai-plot-field="requirement" rows="3" maxlength="2000" placeholder="描述要画的图、坐标轴和样式">${esc(this.draft.requirement)}</textarea></label><details ${this.draft.code?'open':''}><summary>查看与编辑代码</summary><textarea class="ai-plot-code" data-ai-plot-field="code" rows="10" maxlength="30000" spellcheck="false">${esc(this.draft.code)}</textarea></details><div class="ai-inline"><button class="button" data-ai-plot="automatic" title="生成并运行，报错时最多尝试三次">生成并预览</button><button class="button secondary" data-ai-plot="generate">生成代码</button><button class="button secondary" data-ai-plot="preview">运行预览</button><button class="button secondary" data-ai-plot="repair" hidden>修复代码</button><button class="button secondary" data-ai-plot="stop" hidden>停止</button></div><p class="ai-plot-state" role="status"></p><div class="ai-plot-preview"></div><label class="ai-field">图注<input data-ai-plot-field="caption" maxlength="200" value="${esc(this.draft.caption)}"></label><div class="chart-source-grid"><label class="ai-field">插入位置<select data-ai-plot-field="section">${sections.map(section=>`<option ${section===this.draft.section?'selected':''}>${esc(section)}</option>`).join('')}</select></label><label class="ai-plot-embed"><input type="checkbox" data-ai-plot-field="embed" ${this.draft.embed?'checked':''}>插入报告</label></div><label class="ai-field">图组插图宽度（cm）<input type="number" data-ai-plot-field="widthCm" min="4" max="20" step="0.5" value="${Number.isFinite(this.draft.widthCm)?this.draft.widthCm:''}"></label><div class="ai-inline"><button class="button" data-ai-plot="adopt">采用图组</button><button class="button secondary" data-ai-plot="remove" ${this.hooks.selection()?'':'hidden'}>移除已采用图组</button></div></section>`;
    this.controls();
  }
  private controls(){
    if(!this.host)return;
    this.host.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLTextAreaElement|HTMLSelectElement>('button,input,textarea,select').forEach(input=>{input.disabled=this.isBusy;});
    const button=(name:string)=>this.host!.querySelector<HTMLButtonElement>(`[data-ai-plot="${name}"]`)!;
    button('stop').hidden=!this.controller;button('stop').disabled=this.saving;
    button('repair').hidden=!this.hooks.repair||!this.failed;button('repair').disabled=this.isBusy||!this.failed||this.failed.code!==this.draft.code;
    button('preview').disabled=this.isBusy||!this.draft.code.trim();
    button('adopt').disabled=this.isBusy||!this.preview||this.preview.code!==this.draft.code;
    this.hooks.changed();
  }
  private message(text:string,error=false){const box=this.host?.querySelector('.ai-plot-state');if(box){box.textContent=text;box.classList.toggle('ocr-warning',error);}}
  private clearImage(){this.closeZoom();if(this.url)URL.revokeObjectURL(this.url);this.url='';const box=this.host?.querySelector('.ai-plot-preview');if(box)box.replaceChildren();}
  private showImage(){this.clearImage();if(!this.preview||!this.host)return;this.url=URL.createObjectURL(new Blob([this.preview.bytes.slice().buffer],{type:'image/png'}));this.host.querySelector('.ai-plot-preview')!.innerHTML=`${(this.preview.figures?.length??0)>1?'<div class="ai-inline">'+this.preview.figures!.map((_,i)=>`<button class="button ${i===this.figureIndex?'':'secondary'} compact" data-ai-plot="figure-${i}" aria-pressed="${i===this.figureIndex}">图 ${i+1}</button>`).join('')+'</div>':''}<figure><button class="ai-plot-zoom-trigger" data-ai-plot="zoom" aria-label="放大图表"><img src="${esc(this.url)}" alt="AI 绘图预览"></button><figcaption>${rich(this.draft.caption)}</figcaption></figure>`;}
  private zoom(){
    if(!this.url||this.zoomDialog)return;
    const dialog=document.createElement('dialog');dialog.className='ai-plot-zoom-sheet';dialog.setAttribute('aria-label','图表预览');
    dialog.innerHTML=`<header><strong>图表预览</strong><div class="ai-inline"><button class="button secondary compact" data-zoom="fit">适应</button><button class="button secondary compact" data-zoom="original">原图</button><button class="button compact" data-zoom="close">关闭</button></div></header><div class="ai-plot-zoom-canvas"><img src="${esc(this.url)}" alt="放大图表"></div>`;
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.closeZoom();});
    dialog.addEventListener('click',event=>{const action=(event.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;if(action==='close')this.closeZoom();else if(action)dialog.querySelector('img')!.classList.toggle('fit',action==='fit');});
    this.zoomDialog=dialog;document.body.append(dialog);dialog.showModal();
  }
  private current(){const context=this.hooks.context();if(!context||context.experimentId!==this.initial?.experimentId)throw Error('实验已切换');return context;}
  private async remember(context:PlotContext,hash:string){const history=this.hooks.history;if(!history)return true;const key=context.experimentId+':'+hash+':'+this.draft.code;if(key===this.remembered)return true;try{await history.append({id:crypto.randomUUID(),experimentId:context.experimentId,createdAt:new Date().toISOString(),sourceHash:hash,...this.draft});this.remembered=key;return true;}catch{return false;}}
  private async historyAction(action:string){const history=this.hooks.history;if(!history||this.isBusy)return;const context=this.current(),token=this.token;this.saving=true;this.controls();try{
    if(action.startsWith('history-open-')){const item=await history.read(context.experimentId,action.slice(13));const matches=item.sourceHash===await textHash(context.source);if(token!==this.token||this.current().source!==context.source)return;this.draft={widthCm:chartWidth(item.widthCm),requirement:item.requirement,code:item.code,caption:item.caption,section:item.section,embed:item.embed};this.sourceHash=item.sourceHash;this.failed=null;this.remembered=context.experimentId+':'+item.sourceHash+':'+item.code;this.preview=null;this.clearImage();for(const key of ['requirement','code','caption','section','embed','widthCm'] as const){const input=this.host?.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`[data-ai-plot-field="${key}"]`);if(input){if(key==='embed')(input as HTMLInputElement).checked=this.draft.embed;else input.value=String(this.draft[key]);}}this.host!.querySelector('details')!.open=true;this.message(matches?'历史代码已载入，请重新预览后采用':'此代码对应旧数据，仅供查看；请按当前数据重新生成',!matches);return;}
    if(action==='history-clear'){if(!await history.confirm()||token!==this.token)return;await history.clear(context.experimentId);this.remembered='';this.historyPage=0;}
    else if(action.startsWith('history-delete-')){await history.remove(context.experimentId,action.slice(15));this.remembered='';}
    else if(action==='history-next')this.historyPage++;else if(action==='history-prev')this.historyPage=Math.max(0,this.historyPage-1);
    const rows=await history.list(context.experimentId),hash=await textHash(context.source);if(token!==this.token)return;this.historyPage=Math.min(this.historyPage,Math.max(0,Math.ceil(rows.length/10)-1));const box=this.host?.querySelector('.ai-plot-history');if(box)box.innerHTML=`${rows.slice(this.historyPage*10,this.historyPage*10+10).map(r=>`<article class="ai-history-row"><strong>${esc(r.requirement||'自定义绘图代码')}</strong><p>${esc(new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false}))} · ${r.sourceHash===hash?'数据匹配':'旧数据'}</p><div class="ai-inline"><button class="button secondary" data-ai-plot="history-open-${r.id}">载入代码</button><button class="button secondary" data-ai-plot="history-delete-${r.id}">删除</button></div></article>`).join('')||'<p>暂无代码历史</p>'}<div class="ai-inline"><button class="button secondary" data-ai-plot="history-prev" ${this.historyPage===0?'hidden':''}>上一页</button><span>${this.historyPage+1} / ${Math.max(1,Math.ceil(rows.length/10))}</span><button class="button secondary" data-ai-plot="history-next" ${(this.historyPage+1)*10>=rows.length?'hidden':''}>下一页</button><button class="button secondary" data-ai-plot="history-list">刷新</button><button class="button secondary" data-ai-plot="history-clear">清空历史</button></div>`;
  }catch(error){if(token===this.token){this.message((error as Error).message,true);const box=this.host?.querySelector('.ai-plot-history');if(box)box.innerHTML='<p>历史未能读取，可重试或清空本实验代码历史。</p><div class="ai-inline"><button class="button secondary" data-ai-plot="history-list">重试</button><button class="button secondary" data-ai-plot="history-clear">清空历史</button></div>';}}finally{if(token===this.token){this.saving=false;this.controls();}}}
  private async automatic(context:PlotContext,token:number){
    if(!this.draft.requirement.trim())throw Error('请填写绘图需求');
    let historySaved=true;const controller=new AbortController();this.controller=controller;this.preview=null;this.failed=null;this.clearImage();this.controls();
    const verify=()=>{if(token!==this.token||controller.signal.aborted)throw Error('绘图已停止');const current=this.current();if(current.experimentId!==context.experimentId||current.source!==context.source)throw Error('数据已变化，请重新生成绘图代码');};
    try{
      const hash=await textHash(context.source);verify();
      const completed=await generatePlotWithRepair({signal:controller.signal,verify,
        request:(repair,progress)=>repair?(this.hooks.repair?this.hooks.repair(this.draft.requirement,repair,controller.signal,progress):Promise.reject(Error('当前配置不支持自动修复'))):this.hooks.ask(this.draft.requirement,controller.signal,progress),
        run:(code,progress)=>this.hooks.run({code,data:context.data},controller.signal,progress),
        code:async code=>{verify();this.draft.code=code;this.sourceHash=hash;this.host!.querySelector<HTMLTextAreaElement>('[data-ai-plot-field="code"]')!.value=code;this.host!.querySelector('details')!.open=true;if(!await this.remember(context,hash))historySaved=false;verify();},
        failure:repair=>{verify();if(repair.code===this.draft.code)this.failed={source:context.source,...repair};},
        progress:text=>{if(token===this.token&&!controller.signal.aborted)this.message(text);},
      });
      verify();const {code,result,attempt}=completed;this.figureIndex=0;this.preview={bytes:result.bytes,source:context.source,code,figures:(result.images??[result]).map(f=>({...f,section:this.draft.section,embed:this.draft.embed}))};this.sourceHash=hash;this.draft.caption=result.caption;this.failed=null;
      this.host!.querySelector<HTMLInputElement>('[data-ai-plot-field="caption"]')!.value=result.caption;this.showImage();this.message(`预览已完成（尝试 ${attempt} 次），请核对后采用${historySaved?'':'；代码历史未保存'}`);
    }catch(error){if(token===this.token&&this.controller===controller)this.message(controller.signal.aborted?'已停止绘图':(error as Error).message,!controller.signal.aborted);}
    finally{if(this.controller===controller)this.controller=null;if(token===this.token)this.controls();}
  }
  private async action(action:string){
    if(action==='stop'){this.stop();return;}if(this.isBusy)return;if(action.startsWith('figure-')){const index=Number(action.slice(7)),figure=this.preview?.figures?.[index];if(!figure||!Number.isInteger(index))return;this.figureIndex=index;this.preview!.bytes=figure.bytes;this.preview!.image=figure.image;this.draft.caption=figure.caption;this.draft.section=figure.section;this.draft.embed=figure.embed;for(const key of ['caption','section'] as const)this.host!.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-ai-plot-field="${key}"]`)!.value=this.draft[key];this.host!.querySelector<HTMLInputElement>('[data-ai-plot-field="embed"]')!.checked=figure.embed;this.showImage();return;}if(action==='zoom'){this.zoom();return;}
    if(action.startsWith('history-'))return this.historyAction(action);
    const context=this.current(),token=this.token;
    if(['automatic','generate','preview','repair','adopt'].includes(action))chartWidth(this.draft.widthCm);
    if(action==='automatic')return this.automatic(context,token);
    if(action==='generate'||action==='preview'||action==='repair'){
      if(action==='repair'&&(!this.hooks.repair||!this.failed||this.failed.code!==this.draft.code||this.failed.source!==context.source))throw Error('数据或代码已变化，请重新预览后修复');
      let running=false;const runningCode=this.draft.code;
      const controller=new AbortController();this.controller=controller;this.controls();
      try{
        if(action==='generate'||action==='repair'){
          const progress=(text:string)=>{if(token===this.token&&!controller.signal.aborted)this.message(text);};
          const raw=action==='repair'?await this.hooks.repair!(this.draft.requirement,{code:this.failed!.code,error:this.failed!.error},controller.signal,progress):await this.hooks.ask(this.draft.requirement,controller.signal,progress);
          if(controller.signal.aborted||token!==this.token)return;
          if(this.current().source!==context.source)throw Error('数据已变化，请重新生成绘图代码');
          const code=extractPlotCode(raw),hash=await textHash(context.source);
          if(controller.signal.aborted||token!==this.token)return;
          if(this.current().source!==context.source)throw Error('数据已变化，请重新生成绘图代码');
          this.draft.code=code;this.sourceHash=hash;this.failed=null;this.preview=null;this.clearImage();
          this.host!.querySelector<HTMLTextAreaElement>('[data-ai-plot-field="code"]')!.value=this.draft.code;this.host!.querySelector('details')!.open=true;
          const stored=await this.remember(context,hash);if(token!==this.token||controller.signal.aborted)return;this.message(stored?(action==='repair'?'修复代码已返回，请重新运行预览':'代码已返回，请运行预览后核对'):'代码已返回，历史保存失败；仍可预览');
        }else{
          const hash=await textHash(context.source);
          if(this.sourceHash?this.sourceHash!==hash:this.initial?.source!==context.source)throw Error('数据已变化，请重新生成绘图代码');
          this.preview=null;this.clearImage();this.failed=null;running=true;
          const code=this.draft.code,result=await this.hooks.run({code,data:context.data},controller.signal,text=>{if(token===this.token&&!controller.signal.aborted)this.message(text);});
          if(controller.signal.aborted||token!==this.token)return;
          if(this.current().source!==context.source||this.draft.code!==code)throw Error('数据或代码已变化，请重新预览');
          this.figureIndex=0;this.preview={bytes:result.bytes,source:context.source,code,figures:(result.images??[result]).map(f=>({...f,section:this.draft.section,embed:this.draft.embed}))};this.sourceHash=hash;this.draft.caption=result.caption;
          this.host!.querySelector<HTMLInputElement>('[data-ai-plot-field="caption"]')!.value=result.caption;this.showImage();const stored=await this.remember(context,hash);if(token!==this.token||controller.signal.aborted)return;this.message(stored?'请核对图表后采用':'预览已完成，历史保存失败；仍可采用');
        }
      }catch(error){const current=this.hooks.context();if(token===this.token&&!controller.signal.aborted&&running&&current?.experimentId===context.experimentId&&current.source===context.source&&this.draft.code===runningCode)this.failed={source:context.source,code:runningCode,error:String((error as Error)?.message||'绘图运行失败').slice(0,4000)};if(token===this.token)this.message(controller.signal.aborted?'已停止绘图':(error as Error).message,!controller.signal.aborted);}
      finally{if(this.controller===controller)this.controller=null;if(token===this.token)this.controls();}
      return;
    }
    if(action==='adopt'||action==='remove'){
      this.saving=true;this.controls();
      try{
        if(action==='remove'){
          if(!await this.hooks.confirm())return;
          await this.hooks.save(context.experimentId,undefined);this.preview=null;this.sourceHash=undefined;this.clearImage();this.message('已移除，请重新生成报告');
        }else{
          const preview=this.preview;if(!preview||preview.code!==this.draft.code||preview.source!==context.source)throw Error('数据或代码已变化，请重新预览');
          if(!this.draft.caption.trim()||!this.draft.section)throw Error('请填写图注并选择插入位置');
          const sourceHash=await textHash(context.source),figures=[];
          const candidates=preview.figures??[{bytes:preview.bytes,caption:this.draft.caption,section:this.draft.section,embed:this.draft.embed,image:preview.image}];
          for(const figure of candidates){
            if(!figure.caption.trim()||figure.caption.length>200||!context.sections.includes(figure.section))throw Error('请核对每张图的图注与插入位置');
            const image=figure.image??await this.hooks.stage(context.experimentId,figure.bytes);
            if(token!==this.token||this.current().source!==context.source)throw Error('数据已变化，未采用图表');
            figure.image=image;figures.push({image,caption:figure.caption,section:figure.section,embed:figure.embed});
          }
          const selection:AdoptedAIPlot={version:1,experimentId:context.experimentId,sourceHash,...this.draft,...figures[0],figures};
          await this.hooks.save(context.experimentId,selection);preview.image=figures[this.figureIndex].image;this.message('已采用，请重新生成报告');
        }
        const remove=this.host?.querySelector<HTMLButtonElement>('[data-ai-plot="remove"]');if(remove)remove.hidden=!this.hooks.selection();
      }finally{this.saving=false;if(token===this.token)this.controls();}
    }
  }
}
