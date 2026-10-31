import {reviewImportedTexts,setImportWarnings,type ImportText} from '../domain/ai-import-review.ts';
import {reportGenerator} from '../platform/report-generation.ts';
import {calculationMeasurements,isSoundExperiment,validSoundPhase,recordSource} from '../domain/sound-phase.ts';
import {copyScopeLabels,isCopyScope,polishOriginal} from '../domain/report-copy.ts';
import {reportTemplates,dataSnapshot} from '../platform/data-state.ts';
import {copyReportText} from '../platform/clipboard.ts';
import {VariantEditor,type VariantContext} from './variant-editor.ts';
import {assertVariantEdit,updateVariantEdit,variantChoices,removeCustomVariants} from '../domain/variant-edits.ts';
import {BatchPolishView} from './polish-batch.ts';
import {mergePolishBatch,assertPolishText,type PolishEntry} from '../domain/polish-batch.ts';
import {AIPreferencesView} from './ai-preferences.ts';
import {requestKnowledge} from '../domain/ai-knowledge-policy.ts';
import { loadSkills } from "../platform/ai-library.ts";
import {saveReportToDirectory} from '../platform/report-directory.ts';
import {chartWidth} from '../domain/chart-width.ts';
import {ChartImagePreview} from './chart-image-preview.ts';
import {chartGuide,assertOfficialChart,type OfficialChartSelection} from '../domain/chart-presets.ts';
import { textHash,type AIHistoryEntry } from "../domain/ai-library.ts";
import {reportSystemPrompt,measurementContext,validCalculationContext,type CalculationContext} from '../domain/ai-context.ts';
import {loadExperimentKnowledge} from '../platform/ai-context.ts';
import { clearAIHistoryFiles,clearPlotHistoryFiles } from "../platform/storage.ts";
import {AIPlotView} from './ai-plot.ts';
import {plotFigures,aiPlotMessages,type AdoptedAIPlot,type PlotRepair} from '../domain/ai-plot.ts';
import {runIsolatedPlot} from '../engine/ai-plot-client.ts';
import {readAIPlotImage,stageAIPlotImage,pruneAIPlotImages} from '../platform/ai-plot.ts';
import type {
  Experiment,
  RecordData,
  Profile,
  Photo,
} from "../domain/types.ts";
import { inspect, convert } from "../domain/model.ts";
import { ai } from "../platform/ai.ts";
import { parseAIJson } from "../domain/ocr.ts";
import {
  defaultReportSettings,
  detachAIHistory,
  sameReportInputs,
} from "../domain/reports.ts";
import type {
  ReportSettings,
  SavedReport,
  ReportSnapshot,
} from "../domain/reports.ts";
import type { Repository } from "../domain/repository.ts";
import { ReportEngine } from "../engine/client.ts";
import {
  chartFields,
  chartKinds,
  validateChart,
  type ChartSpec,
} from "../domain/charts.ts";
import {
  reportBytes,
  reportChartBytes,
  shareReport,
  openReport,
  shareChart,
  clearReportFiles,
} from "../platform/reports.ts";
interface Context {
  exp: Experiment;
  doc: RecordData;
  profile: Profile;
  photo: Photo | null;
  photoError?: boolean;
  blocked: boolean;
}
interface Hooks {
  copy?: (text:string)=>Promise<void>;
  confirm: (title:string,body:string)=>Promise<boolean>;
  confirmQuiz?: (title:string,body:string)=>Promise<boolean>;
  context: () => Context | null;
  flush: () => Promise<void>;
  notice: (message: string) => void;
  jump: (key: string) => void;
  configureAI: () => void;
  upload: (experiment: Experiment) => void;
}
const defaultReportAI={status:ai.status.bind(ai),complete:ai.complete.bind(ai),skills:loadSkills,knowledge:loadExperimentKnowledge};
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const rich = (value: string) =>
  esc(value.replace(/\$([^$]+)\$/g, "$1")).replace(
    /([_^])\{([^{}]+)\}/g,
    (_, op, content) =>
      `<${op === "_" ? "sub" : "sup"}>${content}</${op === "_" ? "sub" : "sup"}>`,
  );
export class Reports {
  private resourceHash?:string;
  private reviewingImport=false;
  private plotView:AIPlotView;
  private dialog = document.createElement("dialog");
  private engine = new ReportEngine();
  private generationController:AbortController|null=null;
  private settings = defaultReportSettings();
  private saved: SavedReport | null = null;
  private variants: Record<string, unknown> = {};
  private exp: Experiment | null = null;
  private tab = "generate";
  private phase: "idle" | "computing" | "saving" = "idle";
  private run = 0;
  private preflight = false;
  private opening = false;
  private status = "";
  private error = false;
  private urls: string[] = [];
  private frame: HTMLIFrameElement | null = null;
  private previewToken = "";
  private aiController: AbortController | null = null;
  private calculationCache:{key:string;value:CalculationContext}|null=null;
  private chartEditor: ChartSpec | null = null;
  private chartIndex = -1;
  private officialImages:{bytes:Uint8Array;name:string}[]=[];
  private officialSource='';
  private officialZoom=new ChartImagePreview();
  private chartImage: {
    bytes: Uint8Array;
    title: string;
    source: string;
  } | null = null;
  private preferencesView:AIPreferencesView;
  private batchPolish:BatchPolishView;
  private variantEditor:VariantEditor;
  private baseVariants:Record<string,unknown>={};
  private variantChoiceError='';
  private variantTarget:{section:string;index:number}|null=null;
  private historyPage=0;
  private aiResult: {
    historyId?:string;
    original?:string;
    kind: "quiz" | "polish";
    section: string;
    text: string;
    questions: string[];
    source: string;
  } | null = null;
  constructor(
    private repo: Repository,
    private hooks: Hooks,
    private reportAI=defaultReportAI,
  ) {
    this.preferencesView=new AIPreferencesView({load:id=>this.repo.loadAIPreferences(id),save:(id,value)=>this.repo.saveAIPreferences(id,value),knowledge:{load:()=>this.repo.loadAIKnowledgePolicy(),save:value=>this.repo.saveAIKnowledgePolicy(value)}},()=>{if(!this.preferencesView.isSaving&&!this.preferencesView.hasUnsaved&&this.status.startsWith('AI 要求')){this.status='';this.error=false;}this.controls();});
    this.batchPolish=new BatchPolishView({context:()=>this.polishContext(),request:async(section,original,instruction,signal)=>{const context=this.hooks.context(),source=this.aiSource();if(!context||this.saved?.sections[section]!==original)throw Error('报告原文已变化');const result=await this.requestReportAI(context,'polish',`润色章节“${section}”。只返回正文，保留全部公式、数据与单位。\n要求：${instruction}\n原文：${original}`,source,signal,text=>{if(!signal.aborted)this.message(text);});if(signal.aborted||this.aiSource()!==source)throw Error('润色已停止或数据已变化');if(!result.text.trim()||result.text.length>20000)throw Error('润色正文为空或过长');const value={kind:'polish' as const,section,text:result.text,questions:[],source,original};await this.remember(value,value.text);return {text:value.text,historyId:(value as NonNullable<Reports['aiResult']>).historyId};},import:(source,entries)=>this.importBatchPolish(source,entries),changed:()=>{this.controls();if(!this.batchPolish.isBusy&&!this.aiController&&this.phase==='idle'&&/^(正在请求 AI|正在准备 AI 请求|正在核对本次计算结果)/.test(this.status))this.message('批量润色已结束，请核对返回内容');}});
    this.variantEditor=new VariantEditor({context:()=>this.variantContext(),request:async(original,instruction,signal)=>{const context=this.hooks.context();if(!context)throw Error('实验已切换');const source=this.aiSource(),result=await this.requestReportAI(context,'polish',`调整章节变体。只返回调整后的完整正文，不要代码围栏。必须原样保留所有公式及 %%...%% 数据占位符，不用本次测量值替换占位符。\n要求：${instruction}\n原文：${original}`,source,signal,text=>{if(!signal.aborted)this.message(text);});return result.text;},save:(text,archive)=>this.saveVariantEdit(text,archive),changed:()=>this.controls()});
    this.plotView=new AIPlotView({
      context:()=>{const c=this.hooks.context();if(!c||c.exp.id!==this.exp?.id)return null;const headings=this.saved?.headings??['数据处理','实验结果分析','结论','实验原理'];return {experimentId:c.exp.id,source:this.aiSource(),data:c.doc.soundPhase?calculationMeasurements(c.exp,c.doc,convert(c.exp.schema,c.doc.draft).data):convert(c.exp.schema,c.doc.draft).data,sections:[...headings].sort((a,b)=>Number(b==='数据处理')-Number(a==='数据处理'))};},
      selection:()=>this.settings.aiPlot,
      ask:(requirement,signal,progress)=>this.askPlotCode(requirement,signal,progress),
      repair:(requirement,repair,signal,progress)=>this.askPlotCode(requirement,signal,progress,repair),
      run:(job,signal,progress)=>{const c=this.hooks.context();if(!c)throw Error('实验已切换');const issues=convert(c.exp.schema,c.doc.draft).issues;if(issues.length)throw Error(issues[0].message);return runIsolatedPlot(job,signal,progress);},
      stage:stageAIPlotImage,read:readAIPlotImage,
      save:(id,selection)=>this.savePlotSelection(id,selection),
      confirm:()=>this.hooks.confirm('移除已采用的 AI 图表？','<p>测量数据、照片及已经生成的报告保留。</p>'),
      changed:()=>this.controls(),
      history:{list:id=>this.repo.listPlotHistory(id),read:(id,item)=>this.repo.readPlotHistory(id,item),append:entry=>this.repo.appendPlotHistory(entry),remove:(id,item)=>this.repo.deletePlotHistory(id,item),clear:id=>this.repo.clearPlotHistory(id,()=>clearPlotHistoryFiles(id)),confirm:()=>this.hooks.confirm('清空本实验代码历史？','<p>已采用图表、测量数据和报告保留。</p>')},
    });
    this.dialog.className = "report-sheet";
    this.dialog.id = "report-sheet";
    this.dialog.setAttribute("aria-labelledby", "report-title");
    document.body.append(this.dialog);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLElement>("button");
      if (!button) return;
      if (button.dataset.chart) {
        void this.chartAction(
          button.dataset.chart,
          Number(button.dataset.index),
        ).catch((e) => this.message((e as Error).message, true));
        return;
      }
      const action = button.dataset.report;
      if (action === "close") this.close();
      else if(action==='variant-clear-custom')void this.clearCustomChoices().catch(e=>this.message((e as Error).message,true));
      else if(action==='variant-edit')void this.openVariantEditor(button.dataset.variantSection!).catch(e=>this.message((e as Error).message,true));
      else if (action?.startsWith("ai-"))
        void this.aiAction(action).catch((e) =>
          this.message((e as Error).message, true),
        );
      else if (action === "upload" && this.saved && this.exp) {
        const exp = this.exp;
        this.close();
        this.hooks.upload(exp);
      } else if (action === "cancel") this.cancel();
      else if (action === "generate")
        void this.generate().catch((e) =>
          this.message((e as Error).message, true),
        );
      else if (action === "open" && this.saved)
        void openReport(this.saved).catch(e => this.message((e as Error).message, true));
      else if (action === "export" && this.saved)
        void this.exportFile(false).catch((e) =>
          this.message("导出未完成：" + (e as Error).message, true),
        );
      else if(action==='share'&&this.saved)void this.exportFile(true).catch(e=>this.message((e as Error).message,true));
      else if (button.dataset.reportTab) {
        if(this.isSaving)return;
        this.tab = button.dataset.reportTab;
        this.renderBody();
      } else if (button.dataset.reportIssue) {
        const key = button.dataset.reportIssue;
        this.close();
        this.hooks.jump(key);
      }
    });
    this.dialog.addEventListener("change", (e) => {
      if (this.phase !== "idle") return;
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      if(input.closest('[data-ai-plot-host],[data-ai-preferences],[data-batch-polish]')||['ai-questions','ai-quiz-on-generate'].includes(input.id))return;
      if(input.closest('#official-chart-editor')){this.officialSource='';this.officialImages=[];this.dialog.querySelector('#official-chart-preview')?.replaceChildren();return;}
      if (input.closest("#custom-chart-editor")) {
        this.chartEditor = this.readChartEditor();
        const section = this.dialog.querySelector<HTMLElement>(
          "[data-chart-section]",
        );
        if (section) section.hidden = !this.chartEditor.embed;
        return;
      }
      if (input.dataset.variant)
        this.settings.variants[input.dataset.variant] = Number(input.value);
      if (input.dataset.section) {
        const disabled = new Set(this.settings.disabledSections);
        (input as HTMLInputElement).checked
          ? disabled.delete(input.dataset.section)
          : disabled.add(input.dataset.section);
        this.settings.disabledSections = [...disabled];
      }
      if (input.id === "report-embed-photo")
        this.settings.embedPhoto = (input as HTMLInputElement).checked;
      if (this.saved) this.message("配置已变化，请重新生成报告后使用");
      if (this.exp)
        void this.repo
          .saveReportSettings(this.exp.id, this.settings)
          .catch((e) =>
            this.message("配置保存失败：" + (e as Error).message, true),
          );
    });
    window.addEventListener("message", (e) => {
      if (e.source !== this.frame?.contentWindow) return;
      if (e.data?.type === "report-preview-ready") void this.sendPreview();
      else if (
        e.data?.type === "report-preview-result" &&
        e.data.token === this.previewToken
      ) {
        const el = this.dialog.querySelector("#report-preview-state");
        if (el)
          el.textContent = e.data.ok
            ? "预览已完成"
            : "预览失败，可重试或导出报告后查看";
      }
    });
  }
  get isSaving() {
    return this.phase === "saving"||this.plotView.isSaving||this.preferencesView.isSaving||this.preferencesView.hasUnsaved||this.batchPolish.isSaving||this.variantEditor.isSaving;
  }
  private async exportFile(share:boolean){if(this.phase!=='idle'||this.preflight||this.aiController||this.plotView.isBusy||!this.saved||!this.exp)return;const report=this.saved,exp=this.exp;this.phase='saving';this.controls();this.message(share?'正在准备分享…':'正在保存报告…');try{const current=await this.repo.loadReport(exp);if(current.value?.generation!==report.generation)throw Error('报告已变化，请重新打开后保存');if(share){await shareReport(report);this.message('已打开分享面板');}else{const result=await saveReportToDirectory(report);this.message(result.mode==='share'?'请在目标应用中确认报告':'已保存：'+result.name);}}finally{this.phase='idle';this.controls();}}
  get isOpen() {
    return this.dialog.open;
  }
  closeTopPreview(){if(this.variantEditor.isOpen){this.variantEditor.close();return true;}return this.officialZoom.close()||this.plotView.closeZoom();}
  private snapshot(): ReportSnapshot {
    const context = this.hooks.context();
    if (!context || context.exp.id !== this.exp?.id || context.blocked)
      throw Error("当前实验不可生成，请先完成数据读取");
    if (context.photoError && this.settings.embedPhoto)
      throw Error("原始照片状态未核实，请返回实验页重新读取或添加照片");
    return structuredClone({
      resourceHash:this.resourceHash,
      record: context.doc,
      profile: context.profile,
      photoPath: context.photo?.path ?? null,
      settings: this.settings,
    });
  }
  async open() {
    this.historyPage=0;
    if (this.opening || this.dialog.open) return;
    this.opening = true;
    const openingToken = ++this.run;
    try {
      const context = this.hooks.context();
      if (!context || context.blocked) throw Error("请先重试读取实验数据");
      await this.hooks.flush();
      if (this.hooks.context()?.exp.id !== context.exp.id) return;
      this.exp = context.exp;
      this.settings = defaultReportSettings();
      this.saved = null;
      this.status = "";
      this.error = false;
      this.tab = "generate";
      this.chartEditor = null;
      this.chartIndex = -1;
      const all = await reportTemplates();this.resourceHash=(await dataSnapshot()).resourceHash;
      this.baseVariants = all[context.exp.id] ?? {};
      this.variants=this.baseVariants;this.variantChoiceError='';
      this.settings = await this.repo
        .loadReportSettings(context.exp.id)
        .catch(() => {
          this.hooks.notice("报告配置读取失败，当前使用默认配置");
          return defaultReportSettings();
        });
      try{this.variants=variantChoices(this.baseVariants,this.settings.customVariants);}catch(e){this.variantChoiceError=(e as Error).message;this.variants=this.baseVariants;}
      try {
        const result = await this.repo.loadReport(context.exp);
        this.saved = result.value;
        if (result.warning) this.status = result.warning;
      } catch {
        this.status = "旧报告记录未能读取，可以重新生成报告。";
        this.error = true;
      }
      if (
        this.hooks.context()?.exp.id !== context.exp.id ||
        openingToken !== this.run
      )
        return;
      this.dialog.innerHTML = `<header class="report-header"><div><p class="eyebrow">实验报告</p><h2 id="report-title">${esc(this.exp.name)}</h2></div><button class="icon-button" data-report="close" aria-label="关闭报告页面">×</button></header><nav class="report-tabs" aria-label="报告功能">${[
        ["generate", "生成报告"],
        ["preview", "报告预览"],
        ["charts", "图表"],
        ["ai", "AI 助手"],
      ]
        .map(
          ([key, label]) =>
            `<button data-report-tab="${key}">${label}</button>`,
        )
        .join(
          "",
        )}</nav><div id="report-body" class="report-body"></div><footer class="report-footer"><span id="report-state" role="status"></span><div><button class="button secondary" data-report="cancel" hidden>取消生成</button><button class="button secondary" data-report="open">外部打开</button><button class="button secondary" data-report="export">保存报告</button><button class="button secondary" data-report="share">分享</button><button class="button secondary" data-report="upload">上传报告</button><button class="button" data-report="generate">生成报告</button></div></footer>`;
      this.renderBody();
      if (!this.dialog.open) this.dialog.showModal();
    } finally {
      this.opening = false;
    }
  }
  close() {
    if(this.preferencesView.isSaving){this.message('AI 要求正在保存，请稍候');return;}
    if(this.preferencesView.hasUnsaved){this.message('AI 要求尚未保存，请在上方重试',true);return;}
    if (this.isSaving) {
      this.message("正在保存报告，请稍候");
      return;
    }
    this.run++;
    this.aiController?.abort();
    this.aiController = null;
    this.aiResult = null;
    this.cancel();
    if (this.dialog.open) this.dialog.close();
    this.releaseViews();
  }
  onLeave() {
    this.close();
  }
  private cancel() {
    if (this.isSaving) return;
    this.plotView.stop();
    this.batchPolish.stop();
    if (this.aiController) {
      this.aiController.abort();
      this.aiController = null;
      this.message(this.reviewingImport?"已停止导入核对":"已停止 AI 请求");
      this.controls();
    }
    if (this.phase === "computing" || this.preflight) {
      this.run++;
      this.generationController?.abort();
      this.engine.cancel();
      this.phase = "idle";
      this.message("已取消生成");
      this.controls();
    }
    this.reviewingImport=false;
  }
  private message(text: string, error = false) {
    this.status = text;
    this.error = error;
    const el = this.dialog.querySelector("#report-state");
    if (el) {
      el.textContent = text;
      el.classList.toggle("error", error);
    }
  }
  private controls() {
    const working=this.phase !== "idle" || this.preflight || !!this.aiController||this.plotView.isBusy||this.variantEditor.isBusy;
    this.preferencesView.setDisabled(working||this.batchPolish.isBusy);
    this.batchPolish.setDisabled(working||this.preferencesView.isSaving||this.preferencesView.hasUnsaved);
    const busy = working||this.batchPolish.isBusy||this.preferencesView.isSaving||this.preferencesView.hasUnsaved;
    this.dialog
      .querySelectorAll<
        | HTMLButtonElement
        | HTMLSelectElement
        | HTMLInputElement
        | HTMLTextAreaElement
      >('[data-report="ai-save-questions"],[data-report="variant-clear-custom"],[data-report="variant-edit"],[data-report="generate"],[data-report="export"],[data-report="share"],[data-report="open"],[data-report="upload"],[data-chart],select,input,textarea')
      .forEach(
        (el) => {
          if(el.closest('[data-ai-plot-host],[data-ai-preferences],[data-batch-polish]'))return;
          el.disabled =
            busy ||
            (["export", "share", "upload", "open"].includes(el.dataset.report || "") &&
              !this.saved);
        },
      );
    for(const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-report^="ai-"]')){const action=button.dataset.report;button.disabled=busy||(action==='ai-polish'&&!this.saved);if(action==='ai-import'){const result=this.aiResult;button.disabled=busy||!result||isCopyScope(result.section)||result.source!==this.aiSource()||(result.kind==='polish'&&this.dialog.querySelector<HTMLSelectElement>('#ai-section')?.value!==result.section);}}
    const cancel = this.dialog.querySelector<HTMLButtonElement>(
      '[data-report="cancel"]',
    );
    if (cancel) {
      cancel.hidden = !busy;
      cancel.disabled = this.isSaving;
      cancel.textContent = this.reviewingImport?"停止核对":this.batchPolish.isBusy?"停止润色":this.aiController ? "停止 AI 请求" : "取消生成";
    }
    this.dialog
      .querySelectorAll("[data-report-tab]")
      .forEach((el) =>
        el.classList.toggle(
          "active",
          (el as HTMLElement).dataset.reportTab === this.tab,
        ),
      );
    this.message(this.status, this.error);
  }
  private releaseViews() {
    this.officialZoom.close();
    this.variantEditor.close();
    this.plotView.leave();
    this.preferencesView.leave();
    this.batchPolish.leave();
    this.chartImage = null;
    this.officialImages=[];this.officialSource='';
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
    this.frame = null;
  }
  private renderBody() {
    const body = this.dialog.querySelector<HTMLElement>("#report-body");
    if (!body || !this.exp) return;
    this.releaseViews();
    this.aiController?.abort();
    this.aiController = null;
    this.aiResult = null;
    if (this.tab === "generate") {
      let warning = "";
      if (this.saved) {
        try {
          if (!sameReportInputs(this.saved.snapshot, this.snapshot()))
            warning =
              '<p class="report-warning">录入数据或报告配置已有变化，请重新生成后使用。</p>';
        } catch {}
      }
      warning+=(this.saved?.notices??[]).map(note=>`<p class="report-warning">${esc(note)}</p>`).join('');
      body.innerHTML = `${this.saved ? `<div class="report-summary"><span>上次生成 ${esc(new Date(this.saved.createdAt).toLocaleString("zh-CN"))}</span><b>${this.saved.formulaCount} 条可编辑公式</b></div>` : ""}${warning}<section class="report-options"><h3>章节组合</h3>${this.variantChoiceError?`<p class="ocr-warning">${esc(this.variantChoiceError)}</p>`:''}${this.settings.customVariants?'<button class="button secondary compact" data-report="variant-clear-custom">移除本实验自建候选</button>':''}${Object.entries(
        this.variants,
      )
        .map(
          ([name, values]) =>
            `<div class="report-option"><label><input type="checkbox" data-section="${esc(name)}" ${!this.settings.disabledSections.includes(name) ? "checked" : ""}><span>${esc(name)}</span></label>${Array.isArray(values) ? `<select data-variant="${esc(name)}" aria-label="${esc(name)}变体"><option value="-1" ${this.settings.variants[name] === -1 ? "selected" : ""}>随机组合</option>${values.map((_, i) => `<option value="${i}" ${(this.settings.variants[name] ?? 0) === i ? "selected" : ""}>变体 ${i + 1}${Array.isArray(this.baseVariants[name])&&i>=(this.baseVariants[name] as unknown[]).length?' · 自建':''}${this.settings.variantEdits?.[name]?.[String(i)]?' · 已调整':''}</option>`).join("")}</select><button class="button secondary compact" data-report="variant-edit" data-variant-section="${esc(name)}">AI 调整</button>` : '<span class="muted">内置题目与答案</span>'}</div>`,
        )
        .join(
          "",
        )}<label class="report-photo-option"><input id="report-embed-photo" type="checkbox" ${this.settings.embedPhoto ? "checked" : ""}>插入原始数据照片</label></section><div id="report-issues"></div>`;
    } else if (this.tab === "ai") {
      body.classList.add("ai-body");
      const source = this.aiSource();
      body.innerHTML = `<p>核对后选择复制或导入。</p><div class="ai-inline"><button class="button secondary" data-report="ai-config">配置 API</button><button class="button secondary" data-report="ai-history">历史记录</button><button class="button secondary" data-report="ai-history-clear">清空本实验历史</button></div><div id="ai-preferences-host"></div><div id="report-ai-history"></div>${this.settings.ai ? `<p class="${source === this.settings.ai.source ? "muted" : "ocr-warning"}">${source === this.settings.ai.source ? "已保存本实验的 AI 导入内容" : "录入数据已变化，生成时跳过旧 AI 导入，旧内容保留"}</p><button class="text-button" data-report="ai-clear">清除 AI 导入内容</button>` : ""}<section class="report-options"><h3>自定义思考题</h3><label class="ai-field">每行一个问题，最多 12 题<textarea id="ai-questions" rows="5" maxlength="12000">${esc((this.settings.customQuestions??this.settings.ai?.customQuiz?.questions)?.join("\n") ?? "")}</textarea></label><label class="course-ack"><input id="ai-quiz-on-generate" type="checkbox" ${this.settings.customQuestions?"checked":""}><span>生成报告前重新回答</span></label><p>开启后，每次生成会调用问答模型。</p><div class="ai-inline"><button class="button secondary" data-report="ai-save-questions">保存题目设置</button><button class="button" data-report="ai-quiz">生成回答</button></div></section><section class="report-options"><h3>章节润色</h3><label class="ai-field">选择章节<select id="ai-section">${Object.entries(
        this.saved?.sections ?? {},
      )
        .filter(([name, text]) => name !== "思考题" && typeof text === "string")
        .map(([name]) => `<option>${esc(name)}</option>`)
        .join(
          "",
        )}${Object.entries(copyScopeLabels).filter(([key])=>key!=='@copy:quiz'||!this.settings.ai?.customQuiz).map(([key,label])=>`<option value="${key}" ${this.saved?.copySections?.[key.slice(6)]?'':'disabled'}>${label} · 复制用${this.saved?.copySections?.[key.slice(6)]?'':this.saved?.copyIssues?'（源文不可用）':'（需重新生成报告）'}</option>`).join('')}</select></label><label class="ai-field">润色要求<textarea id="ai-instruction" rows="3" maxlength="2000" placeholder="例如：用更简洁的语言说明实验原理"></textarea></label><button class="button" data-report="ai-polish" ${this.saved ? "" : "disabled"}>润色章节</button>${this.saved ? "" : '<p class="muted">先生成报告，再按实际报告正文润色。</p>'}</section><div id="batch-polish-host"></div><div id="report-ai-result"></div>`;
      this.preferencesView.mount(body.querySelector<HTMLElement>('#ai-preferences-host')!,this.exp.id);
      if(this.saved&&sameReportInputs(this.saved.snapshot,this.snapshot()))this.batchPolish.mount(body.querySelector<HTMLElement>('#batch-polish-host')!);else if(this.saved)body.querySelector<HTMLElement>('#batch-polish-host')!.textContent='请先用当前数据和配置重新生成报告，再进行多章节润色。';
    } else if (this.tab === "charts") {
      this.renderChartEditor(body);
      if (this.saved) void this.showCharts();
    } else if (!this.saved) {
      body.innerHTML =
        '<div class="empty-state"><h3>还没有生成报告</h3><p>完成数据录入后，点击“生成报告”。</p></div>';
    } else if (this.tab === "preview") {
      body.innerHTML =
        '<p id="report-preview-state" class="muted">正在准备预览…</p><iframe id="mobile-report-frame" title="当前实验报告预览" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>';
      this.frame = body.querySelector("iframe");
      this.frame!.src = "/preview/index.html";
    } else {
      body.innerHTML =
        '<div id="report-charts"><p class="muted">正在读取报告图表…</p></div>';
      void this.showCharts();
    }
    body.classList.toggle("ai-body", this.tab === "ai");
    this.controls();
  }
  private async sendPreview() {
    const report = this.saved,
      frame = this.frame;
    if (!report || !frame) return;
    try {
      const bytes = await reportBytes(report);
      if (frame !== this.frame) return;
      this.previewToken = crypto.randomUUID();
      frame.contentWindow?.postMessage(
        {
          type: "report-preview",
          bytes: bytes.slice().buffer,
          token: this.previewToken,
        },
        "*",
      );
    } catch (e) {
      const el = this.dialog.querySelector("#report-preview-state");
      if (el)
        el.textContent = "报告读取失败，请重新生成；" + (e as Error).message;
    }
  }
  private async showCharts() {
    const report = this.saved,
      body = this.dialog.querySelector("#report-charts");
    if (!report || !body) return;
    if (!report.charts.length) {
      body.innerHTML =
        '<div class="empty-state"><h3>此报告没有内置关系图</h3></div>';
      return;
    }
    try {
      const images = await Promise.all(
        report.charts.map(async (c) => ({
          name: c.name,
          url: URL.createObjectURL(
            new Blob(
              [(await reportChartBytes(report, c.file)).slice().buffer],
              { type: "image/png" },
            ),
          ),
        })),
      );
      if (!this.dialog.contains(body)) {
        images.forEach((i) => URL.revokeObjectURL(i.url));
        return;
      }
      this.urls.push(...images.map((i) => i.url));
      body.innerHTML = images
        .map(
          (i) =>
            `<figure><img src="${esc(i.url)}" alt="${esc(i.name)}"><figcaption>${rich(i.name)}</figcaption></figure>`,
        )
        .join("");
    } catch {
      body.innerHTML = '<p class="error">图表读取失败，请重新生成报告。</p>';
    }
  }
  private async generate() {
    if(this.variantChoiceError){this.message(this.variantChoiceError+'；请先移除不匹配的自建候选',true);return;}
    if (
      this.phase !== "idle" ||
      !this.exp ||
      this.preflight ||
      this.aiController||this.plotView.isBusy
    )
      return;
    const auto=this.dialog.querySelector<HTMLInputElement>('#ai-quiz-on-generate');if(auto){const qs=(this.dialog.querySelector<HTMLTextAreaElement>('#ai-questions')?.value??'').split('\n').map(q=>q.trim()).filter(Boolean);if(auto.checked!==!!this.settings.customQuestions||(auto.checked&&JSON.stringify(qs)!==JSON.stringify(this.settings.customQuestions))){this.message('请先保存题目设置后再生成报告',true);return;}}
    this.preflight = true;
    this.controls();
    const pending = this.run;
    try {
      await this.hooks.flush();
      if (!this.dialog.open || pending !== this.run) return;
      const snapshot = this.snapshot();
      const issues = inspect(this.exp.schema, snapshot.record.draft);if(isSoundExperiment(this.exp)&&!validSoundPhase(snapshot.record.soundPhase))issues.push({key:'soundPhase',message:'请选择位相法相邻记录点间隔'});
      if (issues.length) {
        this.tab = "generate";
        this.renderBody();
        const list = this.dialog.querySelector("#report-issues");
        if (list)
          list.innerHTML = `<h3>请先检查录入数据</h3><ul class="issues">${[...new Map(issues.map((i) => [i.key, i])).values()].map((i) => `<li><button data-report-issue="${esc(i.key)}">${esc(i.message)}</button></li>`).join("")}</ul>`;
        this.message("数据未填写完整，未开始生成", true);
        return;
      }
      await this.repo.saveReportSettings(this.exp.id, this.settings);
      if (!this.dialog.open || pending !== this.run) return;
      const current = ++this.run,
        exp = this.exp,
        began = performance.now();
      this.phase = "computing";
      this.message("正在启动本地报告引擎…");
      this.controls();
      const controller=new AbortController();this.generationController=controller;
      try {
        const context=this.hooks.context()!;
        const saved=await reportGenerator(this.repo,this.engine,{ai:this.reportAI,confirm:(title,body)=>(this.hooks.confirmQuiz??this.hooks.confirm)(title,esc(body).replace(/\n/g,"<br>"))}).run({exp,snapshot,templates:this.baseVariants,photo:context.photo,fresh:async()=>{if(current!==this.run||!this.dialog.open)throw Error('已取消生成');return this.snapshot();}},controller.signal,text=>{if(current===this.run)this.message(text);},phase=>{if(current===this.run){this.phase=phase;this.controls();}});
        if(current!==this.run)return;
        this.saved=saved;this.phase='idle';this.tab='preview';this.message('报告已生成 · '+((performance.now()-began)/1000).toFixed(1)+' 秒'+(saved.notices?.length?'；'+saved.notices.join('；'):''));this.renderBody();
      } catch (e) {
        if(current===this.run)this.message((e as Error).message,true);
      } finally {
        if(this.generationController===controller)this.generationController=null;
        if (current === this.run) {
          this.phase = "idle";
          this.controls();
        }
      }
    } finally {
      this.preflight = false;
      this.controls();
    }
  }
  private chartData(spec?: ChartSpec) {
    const context = this.hooks.context();
    if (!context || !this.exp || context.exp.id !== this.exp.id)
      throw Error("当前实验已切换");
    const result = convert(this.exp.schema, context.doc.draft);
    if (spec) {
      const keys = new Set(
        [spec.x, spec.y].map((k) => k.replace(/\[(?:row:)?\d+\]$/, "")),
      );
      const issue = result.issues.find((i) => keys.has(i.key));
      if (issue) throw Error(issue.message);
    }
    return result.data;
  }
  private readChartEditor(): ChartSpec {
    const root = this.dialog.querySelector("#custom-chart-editor");
    const value = (key: string) =>
      root?.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-chart-field="${key}"]`,
      )?.value ?? "";
    return {
      widthCm: chartWidth(Number(value("widthCm"))),
      x: value("x"),
      y: value("y"),
      kind: value("kind") as ChartSpec["kind"],
      title: value("title"),
      xlabel: value("xlabel"),
      ylabel: value("ylabel"),
      caption: value("caption"),
      section: value("section"),
      embed: !!root?.querySelector<HTMLInputElement>(
        '[data-chart-field="embed"]',
      )?.checked,
    };
  }
  private renderChartEditor(body: HTMLElement) {
    const fields = chartFields(this.exp!, this.chartData());
    const current = this.chartEditor ?? {
      x: fields[0]?.key ?? "",
      y: fields[1]?.key ?? fields[0]?.key ?? "",
      kind: "scatter",
      title: "",
      xlabel: "",
      ylabel: "",
      caption: "",
      section: "数据处理",
      embed: false,
    };
    this.chartEditor = current;
    const options = (value: string) =>
      fields
        .map(
          (f) =>
            `<option value="${esc(f.key)}" ${f.key === value ? "selected" : ""}>${esc(f.label)}</option>`,
        )
        .join("");
    const text = (key: keyof ChartSpec, label: string) =>
      `<label class="ai-field">${label}<input data-chart-field="${key}" maxlength="200" placeholder="自动" value="${esc(current[key])}"></label>`;
    body.innerHTML = `<section class="report-options"><h3>自定义绘图</h3>${
      fields.length
        ? `<div id="custom-chart-editor"><div class="chart-source-grid"><label class="ai-field">X 数据<select data-chart-field="x">${options(current.x)}</select></label><label class="ai-field">Y 数据<select data-chart-field="y">${options(current.y)}</select></label></div><label class="ai-field">图表类型<select data-chart-field="kind">${Object.entries(
            chartKinds,
          )
            .map(
              ([k, v]) =>
                `<option value="${k}" ${current.kind === k ? "selected" : ""}>${v}</option>`,
            )
            .join(
              "",
            )}</select></label><details class="chart-label-options" ${current.title || current.xlabel || current.ylabel || current.caption ? "open" : ""}><summary>标题与标注</summary><div class="chart-label-grid">${text("title", "图表标题")}${text("xlabel", "X 轴标注")}${text("ylabel", "Y 轴标注")}${text("caption", "报告图注")}</div></details><label class="report-photo-option"><input type="checkbox" data-chart-field="embed" ${current.embed ? "checked" : ""}>生成报告时插入此图</label><label class="ai-field" data-chart-section ${current.embed ? "" : "hidden"}>插入报告位置<select data-chart-field="section">${[...new Set([current.section, ...(this.saved?.headings ?? ["数据处理", "实验结果分析", "结论", ...Object.keys(this.saved?.sections ?? {})])])].map((s) => `<option ${s === current.section ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label><label class="ai-field">插图宽度（cm）<input type="number" data-chart-field="widthCm" min="4" max="20" step="0.5" value="${current.widthCm??14}"></label><div class="ai-inline"><button class="button secondary" data-chart="preview">预览图表</button><button class="button" data-chart="save">${this.chartIndex < 0 ? "添加绘图配置" : "保存绘图配置"}</button>${this.chartIndex >= 0 ? '<button class="text-button" data-chart="new">新增配置</button>' : ""}</div></div><div id="custom-chart-preview" aria-live="polite"></div>`
        : "<p>此实验没有可选择的数组或表格数据。</p>"
    }</section><section class="report-options"><h3>已保存的绘图配置</h3>${(this.settings.customCharts ?? []).map((c, i) => `<div class="chart-saved"><strong>${esc(c.title || `${c.y} — ${c.x}`)}</strong><p>${esc(chartKinds[c.kind])} · ${c.embed ? "插入“" + esc(c.section) + "”" : "仅预览"}</p><div class="ai-inline"><button class="button secondary compact" data-chart="edit" data-index="${i}">编辑</button><button class="text-button" data-chart="delete" data-index="${i}">删除</button></div></div>`).join("") || '<p class="muted">尚无自定义绘图配置。</p>'}</section>${this.saved ? '<section class="report-options"><h3>已生成报告中的图表</h3><div id="report-charts"></div></section>' : ""}`;
    const manual=document.createElement('details');manual.className='manual-plot';manual.innerHTML='<summary>手动配置图表</summary>';
    for(const section of [...body.children].slice(0,2))manual.append(section);
    body.prepend(manual);
    const host=document.createElement('div');host.dataset.aiPlotHost='';body.prepend(host);this.plotView.mount(host);
    const guide=chartGuide(this.exp!);const preset=document.createElement('section');preset.className='report-options';preset.id='official-chart-editor';
    const selected=this.settings.officialCharts??{preset:'all',embed:false,section:'数据处理'};
    preset.innerHTML=`<h3>实验预设</h3>${guide?.charts.length?`<label class="ai-field">图表<select data-official="preset"><option value="all">全部主图</option>${guide.charts.map(c=>`<option value="${esc(c.id)}" ${selected.preset===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label><label class="report-photo-option"><input type="checkbox" data-official="embed" ${selected.embed?'checked':''}>生成报告时追加此预设图组</label><label class="ai-field">插入报告位置<select data-official="section">${[...new Set([selected.section,...(this.saved?.headings??['数据处理','实验结果分析','结论'])])].map(s=>`<option ${selected.section===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label class="ai-field">插图宽度（cm）<input type="number" data-official="widthCm" min="4" max="20" step="0.5" value="${selected.widthCm??14}"></label><div class="ai-inline"><button class="button secondary" data-chart="official-preview">预览预设</button><button class="button" data-chart="official-save">保存预设配置</button></div><div id="official-chart-preview" aria-live="polite"></div>`:`<p>${esc(guide?.description??'此实验没有已核实的预设图组，可使用手动绘图或 AI 绘图。')}</p>`}`;
    body.prepend(preset);
  }
  private readOfficial():OfficialChartSelection {
    const root=this.dialog.querySelector('#official-chart-editor');
    const selection={widthCm:chartWidth(Number(root?.querySelector<HTMLInputElement>('[data-official=widthCm]')?.value??'')),preset:root?.querySelector<HTMLSelectElement>('[data-official=preset]')?.value??'',embed:!!root?.querySelector<HTMLInputElement>('[data-official=embed]')?.checked,section:root?.querySelector<HTMLSelectElement>('[data-official=section]')?.value??''};
    assertOfficialChart(this.exp!,selection);return selection;
  }
  private async officialAction(action:string,index:number){
    const selection=this.readOfficial(),exp=this.exp!;
    if(action==='official-save'){
      const next=structuredClone(this.settings);next.officialCharts=selection;this.phase='saving';this.controls();
      try{await this.repo.saveReportSettings(exp.id,next);this.settings=next;this.message('预设配置已保存，重新生成报告后生效');}finally{this.phase='idle';this.controls();}return;
    }
    if(action==='official-export'||action==='official-zoom'){
      const image=this.officialImages[index];if(!image||this.officialSource!==JSON.stringify({data:this.chartData(),selection}))throw Error('数据或预设已变化，请重新预览');
      if(action==='official-zoom'){this.officialZoom.open(image.bytes,image.name);return;}
      this.phase='saving';this.controls();try{await shareChart(exp.id,image.bytes,image.name);}finally{this.phase='idle';this.controls();}return;
    }
    if(action!=='official-preview')return;
    const token=++this.run;this.preflight=true;this.controls();
    let data:ReturnType<typeof this.chartData>;
    try{await this.hooks.flush();if(token!==this.run||!this.dialog.open)return;data=this.chartData();}finally{this.preflight=false;this.controls();}
    const source=JSON.stringify({data,selection}),target=this.dialog.querySelector<HTMLElement>('#official-chart-preview')!;
    this.officialImages=[];this.officialSource='';target.replaceChildren();this.phase='computing';this.controls();
    try{
      const context=this.hooks.context()!;
      const result=await this.engine.generate({mode:'plot',experimentId:exp.id,data,profile:context.profile,date:context.doc.date,options:{officialCharts:selection}},s=>{if(token===this.run)this.message(s);});
      if(token!==this.run||!target.isConnected||source!==JSON.stringify({data:this.chartData(),selection:this.readOfficial()}))return;
      if(!result.charts.length)throw Error('预设没有生成图表');
      this.officialImages=result.charts;this.officialSource=source;
      target.innerHTML=result.charts.map((image,i)=>{const url=URL.createObjectURL(new Blob([image.bytes.slice().buffer],{type:'image/png'}));this.urls.push(url);return `<figure><button class="ai-plot-zoom-trigger" data-chart="official-zoom" data-index="${i}" aria-label="放大图表"><img src="${esc(url)}" alt="${esc(image.name)}"></button><figcaption>${rich(image.name)}</figcaption></figure><button class="button secondary" data-chart="official-export" data-index="${i}">保存此图</button>`;}).join('');
      this.message(`已生成 ${result.charts.length} 张预设图表`);
    }catch(e){if(token===this.run)this.message((e as Error).message,true);}finally{if(token===this.run){this.phase='idle';this.controls();}}
  }
  private async chartAction(action: string, index: number) {
    if (
      this.phase !== "idle" ||
      this.preflight ||
      this.aiController ||
      this.plotView.isBusy||
      !this.exp
    )
      return;
    if(action.startsWith('official-'))return this.officialAction(action,index);
    if (action === "new") {
      this.chartEditor = null;
      this.chartIndex = -1;
      this.renderBody();
      return;
    }
    if (action === "export") {
      const image = this.chartImage;
      const spec = this.readChartEditor();
      if (
        !image ||
        image.source !== JSON.stringify({ data: this.chartData(spec), spec })
      )
        throw Error("绘图数据或配置已变化，请重新预览");
      this.phase = "saving";
      this.controls();
      try {
        await shareChart(this.exp.id, image.bytes, image.title);
      } finally {
        this.phase = "idle";
        this.controls();
      }
      return;
    }
    const charts = this.settings.customCharts ?? [];
    if (action === "edit") {
      if (charts[index]) {
        this.chartEditor = structuredClone(charts[index]);
        this.chartIndex = index;
        this.renderBody();
      }
      return;
    }
    if (action === "delete" || action === "save") {
      const next = structuredClone(this.settings);
      if (action === "delete") {
        if (!Number.isInteger(index) || !charts[index]) return;
        next.customCharts = charts.filter((_, i) => i !== index);
      } else {
        const spec = this.readChartEditor();
        validateChart(this.exp, this.chartData(spec), spec);
        const list = structuredClone(charts);
        if (this.chartIndex < 0) {
          if (list.length >= 8) throw Error("最多配置八张自定义图表");
          list.push(spec);
        } else list[this.chartIndex] = spec;
        next.customCharts = list;
      }
      this.phase = "saving";
      this.controls();
      try {
        await this.repo.saveReportSettings(this.exp.id, next);
      } finally {
        this.phase = "idle";
        this.controls();
      }
      this.settings = next;
      this.chartEditor = null;
      this.chartIndex = -1;
      this.renderBody();
      this.message("绘图配置已保存，请重新生成报告以应用");
      return;
    }
    if (action !== "preview") return;
    const preflightRun = ++this.run;
    this.preflight = true;
    this.controls();
    let spec: ChartSpec, data: ReturnType<typeof this.chartData>;
    try {
      await this.hooks.flush();
      if (preflightRun !== this.run || !this.dialog.open) return;
      spec = this.readChartEditor();
      data = this.chartData(spec);
      validateChart(this.exp, data, spec);
    } finally {
      this.preflight = false;
      this.controls();
    }
    const target = this.dialog.querySelector<HTMLElement>(
      "#custom-chart-preview",
    )!;
    const snapshot = JSON.stringify({ data, spec }),
      token = preflightRun;
    this.phase = "computing";
    this.controls();
    this.message("正在准备本机绘图引擎…");
    try {
      const result = await this.engine.generate(
        {
          mode: "plot",
          experimentId: this.exp.id,
          data,
          profile: this.hooks.context()!.profile,
          date: this.hooks.context()!.doc.date,
          options: { chart: spec },
        },
        (s) => {
          if (token === this.run) this.message(s);
        },
      );
      if (
        token !== this.run ||
        !target.isConnected ||
        snapshot !==
          JSON.stringify({
            data: this.chartData(spec),
            spec: this.readChartEditor(),
          })
      )
        return;
      const image = result.charts[0];
      if (!image) throw Error("图表未生成");
      const url = URL.createObjectURL(
        new Blob([image.bytes.slice().buffer], { type: "image/png" }),
      );
      this.urls.push(url);
      this.chartImage = {
        bytes: image.bytes,
        title: image.name,
        source: snapshot,
      };
      target.innerHTML = `<figure><img src="${esc(url)}" alt="${esc(image.name)}"><figcaption>${rich(image.name)}</figcaption></figure><button class="button secondary" data-chart="export">保存图表</button>`;
      this.message("图表已生成 · 使用当前测量数据");
    } catch (e) {
      if (token === this.run) this.message((e as Error).message, true);
    } finally {
      if (token === this.run) {
        this.phase = "idle";
        this.controls();
      }
    }
  }
  private aiSource() {
    const context = this.hooks.context();
    return context?recordSource(this.resourceHash,context.doc):JSON.stringify({resourceHash:this.resourceHash});
  }
  private async savePlotSelection(id:string,selection:AdoptedAIPlot|undefined){
    if(this.exp?.id!==id||this.hooks.context()?.exp.id!==id)throw Error('实验已切换，未修改图表配置');
    const next=structuredClone(this.settings);if(selection)next.aiPlot=selection;else delete next.aiPlot;
    // Both recovery copies must stop referring to an old image before pruning it.
    await this.repo.saveReportSettings(id,next);await this.repo.saveReportSettings(id,next);
    this.settings=next;
    await pruneAIPlotImages(id,selection?plotFigures(selection).map(f=>f.image.id):undefined).catch(()=>this.hooks.notice('图表配置已保存，旧缓存可通过清除数据清理'));
  }
  private async askPlotCode(requirement:string,signal:AbortSignal,progress:(text:string)=>void,repair?:PlotRepair){
    const context=this.hooks.context();if(!context)throw Error('实验已切换');
    const source=this.aiSource();
    if(!requirement.trim()||requirement.length>2000)throw Error('请填写不超过 2000 字的绘图需求');
    const converted=convert(context.exp.schema,context.doc.draft);if(converted.issues.length)throw Error(converted.issues[0].message);
    progress('正在准备 AI 绘图…');const status=await ai.status('chat');if(signal.aborted)throw Error('已停止绘图');if(!status.hasKey)throw Error('请先在 AI 服务中配置报告问答 API Key');
    const [skills,preferences,policy]=await Promise.all([loadSkills(),this.repo.loadAIPreferences(context.exp.id),this.repo.loadAIKnowledgePolicy()]);
    const knowledge=await requestKnowledge(policy.kbOnly,()=>loadExperimentKnowledge(context.exp.sourceId));
    if(signal.aborted)throw Error('已停止绘图');if(this.hooks.context()?.exp.id!==context.exp.id||this.aiSource()!==source)throw Error('数据已变化，请重新生成绘图代码');
    const key=context.exp.id+':'+source;let calculation=this.calculationCache?.key===key?this.calculationCache.value:undefined;
    if(!calculation&&!inspect(context.exp.schema,context.doc.draft).length){
      const stop=()=>this.engine.cancel();signal.addEventListener('abort',stop,{once:true});
      try{calculation=await this.engine.calculate({experimentId:context.exp.id,data:calculationMeasurements(context.exp,context.doc,converted.data),profile:{name:'',studentId:'',className:''},date:context.doc.date,options:{}},progress);}
      finally{signal.removeEventListener('abort',stop);}
      if(signal.aborted)throw Error('已停止绘图');if(this.hooks.context()?.exp.id!==context.exp.id||this.aiSource()!==source)throw Error('数据已变化，请重新生成绘图代码');
      if(!validCalculationContext(calculation,context.exp.id,context.exp.sourceId))throw Error('本次绘图计算结果未能核实');
      this.calculationCache={key,value:calculation};
    }
    const messages=aiPlotMessages({experimentId:context.exp.id,sourceId:context.exp.sourceId,name:context.exp.name,knowledge,kbOnly:policy.kbOnly,skills,measurements:measurementContext(context.exp.schema,converted.data),requirement,calculation,repair,preferences});
    progress(repair?'正在修复绘图代码…':'正在生成绘图代码…');return (await ai.complete('chat',messages,signal)).text;
  }
  private async clearCustomChoices(){if(this.phase!=='idle'||this.preflight||this.aiController||this.plotView.isBusy||this.batchPolish.isBusy||this.variantEditor.isBusy||!this.exp)return;const exp=this.exp;if(!await this.hooks.confirm('移除本实验自建候选？','仅移除下拉候选及其调整，归档库和测量数据保留。')||this.exp!==exp||!this.dialog.open)return;this.phase='saving';this.controls();try{const next=removeCustomVariants(this.settings,this.baseVariants);await this.repo.saveReportSettings(this.exp.id,next);this.settings=next;this.variants=variantChoices(this.baseVariants,next.customVariants);this.variantChoiceError='';this.renderBody();this.message('自建候选已移除，请重新生成报告');}finally{this.phase='idle';this.controls();}}
  private variantContext():VariantContext {const target=this.variantTarget,values=target?this.variants[target.section]:null;if(!target||!Array.isArray(values)||typeof values[target.index]!=='string')throw Error('当前变体不可调整');const builtin=this.baseVariants[target.section],baseCount=Array.isArray(builtin)?builtin.length:0,custom=target.index>=baseCount?this.settings.customVariants?.[target.section]?.[target.index-baseCount]:undefined,base=values[target.index] as string,existing=this.settings.variantEdits?.[target.section]?.[String(target.index)];return {source:JSON.stringify({source:this.aiSource(),target,base,existing,custom}),section:target.section,index:target.index,custom:!!custom,label:'变体 '+(target.index+1)+(custom?' · 自建':''),archiveIndex:custom?.baseIndex,archiveOriginal:custom?.original,archiveStandalone:custom?.standalone,base,current:existing?.text??base,edited:!!existing};}
  private async openVariantEditor(section:string){if(this.variantChoiceError)throw Error(this.variantChoiceError+'；请先移除不匹配的候选');if(this.variantEditor.isOpen||this.variantEditor.isBusy)return;if(this.phase!=='idle'||this.preflight||this.aiController||this.plotView.isBusy||this.batchPolish.isBusy||this.preferencesView.isSaving||this.preferencesView.hasUnsaved)return;const values=this.variants[section];if(!Array.isArray(values)||!values.length)throw Error('没有可调整的文字变体');let index=this.settings.variants[section]??0;if(index<0||index>=values.length)index=0;this.variantTarget={section,index};this.variantEditor.open();}
  private async saveVariantEdit(text?:string,archive=false){const c=this.variantContext();if(text!==undefined)assertVariantEdit(c.base,text);const next=updateVariantEdit(this.settings,c.section,c.index,c.base,text);await this.repo.saveReportSettings(this.exp!.id,next);this.settings=next;if(text!==undefined&&archive)try{await this.repo.archiveVariant({experimentId:this.exp!.id,section:c.section,index:c.archiveStandalone?0:c.archiveIndex??c.index,original:c.archiveStandalone?text:c.archiveOriginal??c.base,text,...(c.archiveStandalone?{desktop:true,unbound:true}:{})});}catch{this.hooks.notice('变体已采用，但自建库归档失败；可重新打开后重试归档');}const select=[...this.dialog.querySelectorAll<HTMLSelectElement>('[data-variant]')].find(e=>e.dataset.variant===c.section);if(select){for(const option of select.options){const index=Number(option.value);if(index>=0)option.textContent=`变体 ${index+1}${Array.isArray(this.baseVariants[c.section])&&index>=(this.baseVariants[c.section] as unknown[]).length?' · 自建':''}${next.variantEdits?.[c.section]?.[String(index)]?' · 已调整':''}`;}select.value=String(next.variants[c.section]??0);}this.message(text===undefined?(c.custom?'已恢复自建原文，请重新生成报告':'已恢复内置变体，请重新生成报告'):'变体已保存，请重新生成报告');}
  private async reviewImport(source:string,entries:ImportText[],signal:AbortSignal){
    const context=this.hooks.context(),token=this.run;if(!context)throw Error('实验已变化');const guard=()=>{if(signal.aborted)throw Error('已停止导入核对');if(!this.dialog.open||token!==this.run||this.hooks.context()?.exp.id!==context.exp.id||source!==this.aiSource())throw Error('实验数据已变化，未导入');};guard();
    const converted=convert(context.exp.schema,context.doc.draft);if(converted.issues.length)throw Error(converted.issues[0].message);let values:Record<string,unknown>;
    if(inspect(context.exp.schema,context.doc.draft).length){values={_kind:'generic',...Object.fromEntries(Object.entries(converted.data).filter(([,v])=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)))};}
    else{const key=context.exp.id+':'+source;let calculation=this.calculationCache?.key===key?this.calculationCache.value:undefined;if(!calculation){const stop=()=>this.engine.cancel();signal.addEventListener('abort',stop,{once:true});try{calculation=await this.engine.calculate({experimentId:context.exp.id,data:calculationMeasurements(context.exp,context.doc,converted.data),profile:{name:'',studentId:'',className:''},date:context.doc.date,options:{}},text=>{if(!signal.aborted)this.message(text);});}finally{signal.removeEventListener('abort',stop);}guard();if(!validCalculationContext(calculation,context.exp.id,context.exp.sourceId))throw Error('当前计算结果未能核实');this.calculationCache={key,value:calculation};}values=calculation.values;}
    guard();return reviewImportedTexts(entries,values);
  }
  private polishContext(){if(!this.saved||!sameReportInputs(this.saved.snapshot,this.snapshot()))throw Error('请先用当前数据和配置重新生成报告，再润色实际正文');return {source:this.aiSource(),sections:Object.fromEntries(Object.entries(this.saved?.sections??{}).filter(([name,text])=>name!=='思考题'&&typeof text==='string')) as Record<string,string>};}
  private async importBatchPolish(source:string,entries:PolishEntry[]){if(this.aiSource()!==source)throw Error('数据已变化，请重新润色');mergePolishBatch(this.settings,source,this.polishContext().sections,entries);const reviews=await this.reviewImport(source,entries.map(e=>({label:e.section,text:e.text,original:e.original})),new AbortController().signal);const prepared:PolishEntry[]=[];for(const entry of entries){const value={kind:'polish' as const,section:entry.section,text:entry.text,questions:[],source,original:entry.original,historyId:entry.historyId};if(value.historyId){const old=await this.repo.readAIHistory(this.exp!.id,value.historyId);if(old.text!==entry.text)value.historyId=undefined;}if(!value.historyId)await this.remember(value,value.text);prepared.push({...entry,historyId:value.historyId});}if(this.aiSource()!==source)throw Error('数据已变化，未导入润色');const next=mergePolishBatch(this.settings,source,this.polishContext().sections,prepared);setImportWarnings(next.ai!,reviews);await this.repo.saveReportSettings(this.exp!.id,next);this.settings=next;this.message('已导入润色内容，请重新生成报告'+(reviews.some(r=>r.warning)?'；部分数值待核对':''));}
  private async requestReportAI(context:Context,kind:'quiz'|'polish',content:string,source:string,signal:AbortSignal,progress:(text:string)=>void){
    const guard=()=>{if(signal.aborted)throw Error('已停止 AI 请求');if(this.hooks.context()?.exp.id!==context.exp.id||this.aiSource()!==source)throw Error('实验数据已变化，请重新请求');};guard();const converted=convert(context.exp.schema,context.doc.draft);if(converted.issues.length)throw Error(converted.issues[0].message);progress('正在准备 AI 请求…');const status=await this.reportAI.status('chat');guard();if(!status.hasKey)throw Error('请先在 AI 服务中配置报告问答 API Key');const [enabledSkills,preferences,policy]=await Promise.all([this.reportAI.skills(),this.repo.loadAIPreferences(context.exp.id),this.repo.loadAIKnowledgePolicy()]);guard();const knowledge=await requestKnowledge(policy.kbOnly,()=>this.reportAI.knowledge(context.exp.sourceId));guard();let calculation:CalculationContext|undefined;
    if(!inspect(context.exp.schema,context.doc.draft).length){const key=context.exp.id+':'+source;if(this.calculationCache?.key===key)calculation=this.calculationCache.value;else{const stop=()=>this.engine.cancel();signal.addEventListener('abort',stop,{once:true});try{calculation=await this.engine.calculate({experimentId:context.exp.id,data:calculationMeasurements(context.exp,context.doc,converted.data),profile:{name:'',studentId:'',className:''},date:context.doc.date,options:{}},text=>{if(!signal.aborted)progress(text);});}finally{signal.removeEventListener('abort',stop);}guard();if(!validCalculationContext(calculation,context.exp.id,context.exp.sourceId))throw Error('本次计算结果未能核实');this.calculationCache={key,value:calculation};}}
    guard();progress('正在请求 AI，可停止');const result=await this.reportAI.complete('chat',[{role:'system',content:reportSystemPrompt({name:context.exp.name,sourceId:context.exp.sourceId,experimentId:context.exp.id,knowledge,kbOnly:policy.kbOnly,skills:enabledSkills,measurements:measurementContext(context.exp.schema,converted.data),calculation,kind,preferences})},{role:'user',content}],signal);guard();return result;
  }
  private async remember(result:NonNullable<Reports['aiResult']>,text:string){
    if(!this.exp)return;const entry:AIHistoryEntry={id:crypto.randomUUID(),experimentId:this.exp.id,kind:result.kind,section:result.kind==='quiz'?'自定义思考题':result.section,createdAt:new Date().toISOString(),source:result.source,sourceHash:await textHash(result.source),text,original:result.original??'',questions:result.questions};
    try{await this.repo.appendAIHistory(entry);result.historyId=entry.id;}catch{this.hooks.notice('AI 结果已返回，但历史未能保存；仍可核对并导入');}
  }
  private renderAIResult(body:HTMLElement){const result=this.aiResult;if(!result)return;const copying=isCopyScope(result.section),allowed=!copying&&result.source===this.aiSource()&&(result.kind==='quiz'||body.querySelector<HTMLSelectElement>('#ai-section')?.value===result.section);body.querySelector('#report-ai-result')!.innerHTML=`<section class="report-options"><h3>核对 AI ${result.kind==='quiz'?'回答':'润色结果'}</h3>${result.original?`<details><summary>查看原文 / 题目</summary><pre class="ai-history-original">${esc(result.original)}</pre></details>`:''}<textarea id="ai-result-text" rows="12">${esc(result.text)}</textarea><div class="ai-inline"><button class="button ${copying?'':'secondary'}" data-report="ai-copy">复制正文</button>${copying?'':`<button class="button" data-report="ai-import" ${allowed?'':'disabled'}>导入本实验并用于生成</button>`}</div>${copying?'<p>此范围仅供复制，不自动替换报告。</p>':allowed?'':'<p class="ocr-warning">数据或章节已变化，仅查看；导入前需使用对应的当前数据。</p>'}</section>`;}

  private async showHistory(body:HTMLElement){const exp=this.exp;if(!exp)return;const run=this.run,box=body.querySelector('#report-ai-history');if(!box)return;box.textContent='正在读取历史…';try{const rows=await this.repo.listAIHistory(exp.id),sourceHash=await textHash(this.aiSource());if(run!==this.run||this.exp!==exp||!this.dialog.contains(body))return;const pages=Math.max(1,Math.ceil(rows.length/10));this.historyPage=Math.min(this.historyPage,pages-1);const refs=this.settings.ai?.historyRefs,applied=new Set([refs?.quiz,...Object.values(refs?.polish??{})]);box.innerHTML=`<section class="report-options"><h3>本实验历史 · ${rows.length} 条</h3>${rows.slice(this.historyPage*10,this.historyPage*10+10).map(r=>`<article class="ai-history-row"><strong>${esc(r.kind==='quiz'?'自定义思考题':copyScopeLabels[r.section as keyof typeof copyScopeLabels]??r.section)}</strong><p>${esc(new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false}))} · ${r.sourceHash===sourceHash?'数据匹配':'旧数据'}${applied.has(r.id)?' · 当前已导入':''}</p><div class="ai-inline"><button class="button secondary" data-report="ai-history-view-${r.id}">查看 / 选用</button><button class="button secondary" data-report="ai-history-delete-${r.id}">删除</button></div></article>`).join('')||'<p>暂无历史记录</p>'}<div class="ai-inline"><button class="button secondary" data-report="ai-history-prev" ${this.historyPage===0?'disabled':''}>上一页</button><span>${this.historyPage+1} / ${pages}</span><button class="button secondary" data-report="ai-history-next" ${this.historyPage>=pages-1?'disabled':''}>下一页</button></div></section>`;}catch{if(run===this.run&&this.dialog.contains(body))box.innerHTML='<p class="ocr-warning">历史目录未能读取，可重试或清空本实验历史。测量数据不受影响。</p>';}}
  private async removeHistory(id?:string){const exp=this.exp;if(!exp)return;this.phase='saving';this.controls();try{
    if(!await this.hooks.confirm(id?'删除这条历史及其当前导入内容？':'清空本实验全部 AI 历史及对应导入内容？','<p>测量数据和原始照片保留；已生成报告需重新生成后更新。</p>'))return;
    const next=detachAIHistory(this.settings,id);
    await this.repo.saveReportSettings(exp.id,next);this.settings=next;
    if(id)await this.repo.deleteAIHistory(exp.id,[id]);else await this.repo.clearAIHistory(exp.id,()=>clearAIHistoryFiles(exp.id));
    if(!id||this.aiResult?.historyId===id)this.aiResult=null;this.renderBody();this.message('历史及对应导入内容已删除，请重新生成报告');
  }finally{this.phase='idle';this.controls();}}
  private async aiAction(action: string) {
    if (this.phase !== "idle" || this.preflight || !this.exp||this.preferencesView.isSaving||this.preferencesView.hasUnsaved) return;
    if (action === "ai-config") {
      this.close();
      this.hooks.configureAI();
      return;
    }
    if (this.aiController||this.plotView.isBusy||this.batchPolish.isBusy) return;
    if(action==='ai-save-questions'){
      const body=this.dialog.querySelector('#report-body')!,enabled=body.querySelector<HTMLInputElement>('#ai-quiz-on-generate')!.checked,questions=(body.querySelector<HTMLTextAreaElement>('#ai-questions')!.value).split('\n').map(q=>q.trim()).filter(Boolean);
      if(enabled&&(!questions.length||questions.length>12||questions.some(q=>q.length>1000)))throw Error('请输入 1～12 道问题，每题不超过 1000 字');
      this.phase='saving';this.controls();try{const next=structuredClone(this.settings);if(enabled)next.customQuestions=questions;else delete next.customQuestions;await this.repo.saveReportSettings(this.exp!.id,next);this.settings=next;this.message(enabled?'题目已保存，每次生成报告前重新回答':'已关闭生成前重新回答');}finally{this.phase='idle';this.controls();}return;
    }
    if (action === "ai-clear") {
      this.phase='saving';this.controls();
      try {
        const next=structuredClone(this.settings);delete next.ai;
        await this.repo.saveReportSettings(this.exp.id, next);
        this.settings=next;
        this.renderBody();
        this.message("已清除 AI 导入内容，请重新生成报告");
      } finally {this.phase='idle';this.controls();}
      return;
    }
    const body = this.dialog.querySelector<HTMLElement>("#report-body")!;
    if(action==='ai-history'||action==='ai-history-next'||action==='ai-history-prev') {if(action==='ai-history')this.historyPage=0;else this.historyPage=Math.max(0,this.historyPage+(action==='ai-history-next'?1:-1));return this.showHistory(body);}
    if(action.startsWith('ai-history-view-')){const exp=this.exp,run=this.run;const entry=await this.repo.readAIHistory(exp.id,action.slice('ai-history-view-'.length));if(run!==this.run||this.exp!==exp||!this.dialog.contains(body))return;this.aiResult={kind:entry.kind,section:entry.section,text:entry.text,questions:entry.questions,source:entry.source,historyId:entry.id,original:entry.original};if(entry.kind==='quiz')body.querySelector<HTMLTextAreaElement>('#ai-questions')!.value=entry.questions.join('\n');else body.querySelector<HTMLSelectElement>('#ai-section')!.value=entry.section;this.renderAIResult(body);return;}
    if(action==='ai-history-clear'||action.startsWith('ai-history-delete-'))return this.removeHistory(action==='ai-history-clear'?undefined:action.slice('ai-history-delete-'.length));
    if(action==='ai-copy'){const text=this.dialog.querySelector<HTMLTextAreaElement>('#ai-result-text')?.value??'';this.phase='saving';this.controls();try{await (this.hooks.copy??copyReportText)(text);this.message('正文已复制');}catch(error){this.phase='idle';this.controls();const field=this.dialog.querySelector<HTMLTextAreaElement>('#ai-result-text');field?.focus();field?.select();throw error;}finally{this.phase='idle';this.controls();}return;}
    if(action==='ai-import'){
      const result=this.aiResult;if(result&&isCopyScope(result.section))throw Error('此范围仅支持复制，不会自动导入报告');if(!result||result.source!==this.aiSource())throw Error('数据已变化，请重新生成 AI 内容');
      if(result.kind==='quiz'){const questions=(body.querySelector<HTMLTextAreaElement>('#ai-questions')?.value??'').split('\n').map(q=>q.trim()).filter(Boolean);if(JSON.stringify(questions)!==JSON.stringify(result.questions))throw Error('问题已变化，请重新生成回答后导入');}
      else if(body.querySelector<HTMLSelectElement>('#ai-section')?.value!==result.section)throw Error('选择的章节已变化，请重新润色后导入');
      const text=body.querySelector<HTMLTextAreaElement>('#ai-result-text')!.value.trim();if(!text||text.length>100000)throw Error('回答内容为空或超过长度限制');
      const options:NonNullable<ReportSettings['ai']>=this.settings.ai?.source===result.source?structuredClone(this.settings.ai):{source:result.source},entries:ImportText[]=[];
      if(result.kind==='quiz'){const values=parseAIJson(text).answers;if(!Array.isArray(values)||values.length!==result.questions.length||values.some(v=>typeof v!=='string'||!v.trim()||v.length>20000))throw Error('回答须为 JSON {"answers":["第1题答案",...]}，与问题逐项对应');options.customQuiz={questions:result.questions,answers:Object.fromEntries(values.map((v,i)=>[String(i+1),[v]]))};entries.push(...values.map((value,i)=>({label:'第'+(i+1)+'题',text:value})));for(const label of Object.keys(options.reviewWarnings??{}))if(/^第\d+题$/.test(label))delete options.reviewWarnings![label];}
      else{if(!this.saved)throw Error('报告原文不可用');const original=polishOriginal(this.saved,result.section);if(original!==result.original)throw Error('报告原文已变化，请重新润色后导入');entries.push({label:result.section,text,original});options.polish={...options.polish,[result.section]:text};}
      const controller=new AbortController();this.aiController=controller;this.reviewingImport=true;this.phase='computing';this.message('正在核对导入内容…');this.controls();
      try{const reviews=await this.reviewImport(result.source,entries,controller.signal);if(controller.signal.aborted||this.aiResult!==result||body.querySelector<HTMLTextAreaElement>('#ai-result-text')!.value.trim()!==text)throw Error('导入内容已变化或核对已停止');setImportWarnings(options,reviews);
        this.reviewingImport=false;this.phase='saving';this.controls();if(text!==result.text||!result.historyId){result.historyId=undefined;await this.remember(result,text);}const refs=options.historyRefs??{};if(result.kind==='quiz'){if(result.historyId)refs.quiz=result.historyId;else delete refs.quiz;}else{refs.polish={...refs.polish};if(result.historyId)refs.polish[result.section]=result.historyId;else delete refs.polish[result.section];}options.historyRefs=refs;
        const next=structuredClone(this.settings);next.ai=options;await this.repo.saveReportSettings(this.exp!.id,next);this.settings=next;this.aiResult=null;if(this.aiController===controller)this.aiController=null;this.reviewingImport=false;this.phase='idle';this.renderBody();this.message('AI 内容已保存，请重新生成报告'+(reviews.some(r=>r.warning)?'；部分数值来源、单位与精度待核对':''));
      }finally{if(this.aiController===controller){this.aiController=null;this.reviewingImport=false;this.phase='idle';this.controls();}}return;
    }
    if (action !== "ai-quiz" && action !== "ai-polish") return;
    const context = this.hooks.context();
    if (!context) return;
    const converted=convert(context.exp.schema,context.doc.draft);
    if(converted.issues.length)throw Error(converted.issues.slice(0,3).map(issue=>issue.message).join('；'));
    const controller = new AbortController(),
      source = this.aiSource(),
      kind = action === "ai-quiz" ? "quiz" : "polish";
    const questions = (
      body.querySelector<HTMLTextAreaElement>("#ai-questions")?.value ?? ""
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const section =
      body.querySelector<HTMLSelectElement>("#ai-section")?.value ?? "";
    let content = "";
    if (kind === "quiz") {
      if (
        !questions.length ||
        questions.length > 12 ||
        questions.some((q) => q.length > 1000)
      )
        throw Error("请输入 1～12 个问题，每题不超过 1000 字");
      content = `回答以下实验思考题，按题目顺序仅返回 JSON {"answers":["答案1","答案2"]}，保留 LaTeX 公式：${JSON.stringify(questions)}`;
    } else {
      if (
        !this.saved ||
        !sameReportInputs(this.saved.snapshot, this.snapshot())
      )
        throw Error("请先用当前数据和配置重新生成报告，再润色实际正文");
      const original = polishOriginal(this.saved,section);
      const instruction =
        body
          .querySelector<HTMLTextAreaElement>("#ai-instruction")
          ?.value.trim() ?? "";
      content = `润色章节“${copyScopeLabels[section as keyof typeof copyScopeLabels]??section}”。只返回可直接用于实验报告的正文，不要说明、代码围栏或额外标题。保持原有测量值、结论方向与 LaTeX 公式。\n要求：${instruction}\n原文：${original}`;
    }
    this.aiController = controller;
    this.aiResult = null;
    this.message("正在准备 AI，可点击停止取消");
    this.controls();
    try {
      const result=await this.requestReportAI(context,kind,content,source,controller.signal,text=>{if(!controller.signal.aborted)this.message(text);});
      if (
        controller.signal.aborted ||
        !this.dialog.open ||
        !this.dialog.contains(body) ||
        source !== this.aiSource()
      )
        return;
      if (result.text.length > 100000)
        throw Error("模型回答过长，请精简问题后重试");
      const value={kind,section,text:result.text,questions,source,original:kind==='polish'?polishOriginal(this.saved!,section):questions.join('\n')} as NonNullable<Reports["aiResult"]>;
      this.aiResult=value;await this.remember(value,value.text);
      if(controller.signal.aborted||!this.dialog.contains(body)||source!==this.aiSource())return;
      this.renderAIResult(body);
      this.message(
        `已返回 · ${(result.elapsedMs / 1000).toFixed(1)} 秒，${isCopyScope(section)?"可复制正文":"尚未导入"}${value.historyId?"":" · 历史未保存"}`,
      );
    } catch (e) {
      if (!controller.signal.aborted && this.dialog.contains(body))
        this.message((e as Error).message, true);
    } finally {
      if (this.aiController === controller) {
        this.aiController = null;
        this.controls();
      }
    }
  }
  async clear(exp: Experiment) {
    this.plotView.leave();
    this.calculationCache=null;
    this.aiController?.abort();
    this.aiController = null;
    this.aiResult = null;
    this.run++;
    this.engine.cancel();
    this.phase = "idle";
    await this.repo.clearAIHistory(exp.id,()=>clearAIHistoryFiles(exp.id));
    await this.repo.clearPlotHistory(exp.id,()=>clearPlotHistoryFiles(exp.id));
    await this.repo.clearReports(exp.id);
    await clearReportFiles(exp.id);
    await pruneAIPlotImages(exp.id);
    if (this.exp?.id === exp.id) {
      this.saved = null;
      this.settings = defaultReportSettings();
    }
  }
}
