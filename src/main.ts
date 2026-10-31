import {measurementLabel as math} from './domain/measurement-label.ts';
import {queueBlocksRoute} from './domain/report-runtime.ts';
import {editNumericToken} from './domain/entry-tools.ts';
import type {AIHistoryManager} from './features/ai-history-manager.ts';
import type {ReportSectionsView} from './features/report-sections.ts';
import type {EasterEggView} from './features/easter-egg.ts';
import {reportSectionNames} from './domain/report-sections.ts';
import {textHash} from './domain/ai-library.ts';
import {copyReportText} from './platform/clipboard.ts';
import {defaultReportSettings} from './domain/reports.ts';
import {manageEntryViewport} from './platform/entry-viewport.ts';
import {ReportQueueView} from './features/report-queue.ts';
import {AppUpdatesView} from './features/app-updates.ts';
import {appUpdates} from './platform/app-updates.ts';
import {DeveloperToolsView} from './features/developer-tools.ts';
import {developerTools,fillOneDebugData} from './platform/developer-tools.ts';
import {queuedReportRunner} from './platform/report-queue.ts';
import {CreditsView} from './features/credits.ts';
import {DataUpdatesView} from './features/data-updates.ts';
import {dataUpdates} from './platform/data-updates.ts';
import {desktopVariantExport,variantArchiveCandidate} from './domain/variant-transfer.ts';
import {ContributionsView} from './features/contributions.ts';
import {contributions,contributionPhoto} from './platform/contributions.ts';
import {reportBytes} from './platform/reports.ts';
import {HelpView} from './features/help.ts';
import {FeedbackView} from './features/feedback.ts';
import {feedback} from './platform/feedback.ts';
import {VariantLibraryView} from './features/variant-library.ts';
import {reportTemplates,dataSnapshot,reportCredits} from './platform/data-state.ts';
const variantTemplates=await reportTemplates();
import {appendCustomVariant} from './domain/variant-edits.ts';
import {clearVariantLibraryFiles} from './platform/storage.ts';
import {ReportDirectoryView} from './features/report-directory.ts';
import {reportDirectory} from './platform/report-directory.ts';
import { SkillsView } from "./features/skills.ts";
import {AcademicView} from './features/academic.ts';
import {academic} from './platform/academic.ts';
import {SchoolAccountsView} from './features/school-accounts.ts';
import {schoolAccounts} from './platform/school-accounts.ts';
import {schoolSystem} from './domain/school-accounts.ts';
import { ResourceCheck } from "./features/resource-check.ts";
import { ReportManager } from "./features/report-manager.ts";
import type { SchoolReportView } from "./features/school-reports.ts";
import packageInfo from "../package.json";
import { AIFeatures } from "./features/ai.ts";
import type { PortalView } from "./features/portal.ts";
import { Reports } from "./features/reports.ts";
import { openPreparation } from "./platform/preparation.ts";
import { preparationTarget } from "./domain/preparation.ts";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import catalogJson from "./data/catalog.json";
import type {
  Experiment,
  Category,
  RecordData,
  Profile,
  Draft,
  Field,
  Science,
  Photo,
} from "./domain/types.ts";
import { categoryNames } from "./domain/types.ts";
import {
  fields,
  makeDraft,
  recordBlank,
  inspect,
  recordProgress,
  hasValues,
  resizePoints,
  importMeasurements,
  exportMeasurements,
  today,
} from "./domain/model.ts";
import { Repository } from "./domain/repository.ts";
import {
  privateStore,
  storePhoto,
  photoUrl,
  deletePhotoFile,
  deletePhotos,
  exportJson,
} from "./platform/storage.ts";
import {measurementGroupTitle} from './domain/measurement-labels.ts';
import {isSoundExperiment,validSoundPhase,importedSoundPhase,recordSource} from './domain/sound-phase.ts';
import "./style.css";
const experiments = catalogJson.experiments as Experiment[],
  repo = new Repository(privateStore),
  byId = new Map(experiments.map((e) => [e.id, e]));
const pendingRecordWarnings = new Map<string,string>();
const reportQueueView:ReportQueueView=new ReportQueueView(experiments,queuedReportRunner(repo,experiments,(title,body,signal)=>reportQueueView.requestConfirmation(title,body,signal)),(title,body)=>dialog(title,body,"开始生成"),refreshQueueEntry);
const developerView=new DeveloperToolsView(developerTools(repo,experiments,async()=>{
  for(const exp of experiments){try{summaries.set(exp.id,{doc:(await repo.load(exp)).record});}catch(error){summaries.set(exp.id,{error:(error as Error).message});}}
  try{debugWarning=await repo.loadDebugInterrupted()?'上次调试写入未完成，请恢复测试前备份':'';}catch{debugWarning='调试操作状态未能读取，请检查测试前备份';}
},(title,body)=>dialog(title,esc(body),'继续',true)));
let debugWarning='';
const appUpdatesView=new AppUpdatesView({...appUpdates,confirm:(title,body)=>dialog(title,esc(body),'继续安装')});
const root = document.querySelector<HTMLElement>("#app")!;
manageEntryViewport(root);
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icons = {
  back: '<path d="m14 6-6 6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  book: '<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  settings:
    '<path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 3h5l1-3 3-1v-4l2-2-2-1V7l-3-1-1-3z"/><circle cx="11.5" cy="12.5" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
const icon = (name: keyof typeof icons) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${icons[name]}</svg>`;
let profile: Profile = { name: "", studentId: "", className: "" },
  profileDirty = false,
  profileBlocked = false,
  category: Category | "all" = "all",
  query = "",
  view = "home",
  routeSerial = 0,
  currentHash = "",
  timer: ReturnType<typeof setTimeout> | undefined,
  toastTimer: ReturnType<typeof setTimeout> | undefined,
  lastInput: HTMLInputElement | null = null,
  work = false;
let session: {
  exp: Experiment;
  doc: RecordData;
  dirty: boolean;
  blocked: boolean;
  photo: Photo | null;
  photoError: boolean;
  imageUrl: string | null;
  serial: number;
} | null = null;
const summaries = new Map<string, { doc?: RecordData; error?: string }>();
const reports = new Reports(repo, {
  upload: (exp) => go("school-reports/" + exp.id),
  confirm: (title,body) => dialog(title,body,"删除历史",true),
  confirmQuiz: (title,body) => dialog(title,body,"留空并继续"),
  configureAI: () => {
    void aiFeatures.config();
  },
  context: () =>
    session
      ? {
          exp: session.exp,
          doc: session.doc,
          profile,
          photo: session.photo,
          photoError: session.photoError,
          blocked: session.blocked || profileBlocked,
        }
      : null,
  flush,
  notice,
  jump: (key) => {
    const field = document.getElementById("field-" + key);
    field?.closest("details")?.setAttribute("open", "");
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.querySelector<HTMLElement>("input,select")?.focus({ preventScroll: true });
  },
});
const aiFeatures = new AIFeatures({
  context: () => session,
  notice,
  ocrCache:{load:id=>repo.loadOCR(id),save:(id,value,epoch)=>repo.saveOCR(id,value,epoch),clear:id=>repo.clearOCR(id)},
  student:{load:async()=>{await flush();return repo.loadProfile();},apply:async(patch,expected)=>{await flush();profile=await repo.mergeOCRProfile(patch,expected);return structuredClone(profile);}},
  apply: async (context, draft) => {
    const s = session;
    if (
      !s ||
      s.exp.id !== context.exp.id ||
      s.photo?.path !== context.photo?.path
    )
      throw Error("当前实验已变化，请重新识别");
    if(isSoundExperiment(s.exp)&&JSON.stringify(s.doc.draft.L2)!==JSON.stringify(draft.L2))delete s.doc.soundPhase;
    s.doc.draft = draft;
    changed();
    await flush();
    editor();
  },
});
const skillsView = new SkillsView(notice, (title,body)=>dialog(title,body,"删除技能",true));
const schoolAccountsView=new SchoolAccountsView(schoolAccounts,(title,text)=>dialog(title,`<p>${esc(text)}</p>`,"确认",true),notice,{load:()=>repo.loadSchoolPreload(),save:value=>repo.saveSchoolPreload(value),reset:()=>repo.resetSchoolPreload()});
const helpView=new HelpView();
const creditsView=new CreditsView(reportCredits);
const contributionsView=new ContributionsView(experiments,{version:packageInfo.version,list:id=>repo.listVariantLibrary(id),read:(id,key)=>repo.readVariantArchive(id,key),photo:contributionPhoto,upload:contributions.submit,cancel:contributions.cancel,localWord:async id=>{const exp=byId.get(id);if(!exp)throw Error('实验不存在');const loaded=await repo.loadReport(exp),report=loaded.value;if(!report)throw Error('请先生成并保存本机报告');return {name:exp.name+'.docx',bytes:await reportBytes(report)};},confirm:body=>dialog('确认贡献所选内容？',body,'确认上传')});
const dataUpdatesView=new DataUpdatesView({...dataUpdates,confirm:(title,body)=>dialog(title,`<p>${esc(body)}</p>`,'确认')});
const resourceCheck = new ResourceCheck(notice,undefined,()=>dialog('刷新报告运行缓存？','<p>核对安装资源后刷新临时缓存，再检查离线报告环境。测量数据、照片、报告、账号和配置保留。</p>','刷新缓存'));
const feedbackView=new FeedbackView(experiments, {...feedback,confirm:(text,experiment)=>dialog('确认提交反馈？',`<p>${esc(experiment)}</p><pre class="ai-history-original">${esc(text)}</pre><p>另附应用版本 ${esc(packageInfo.version)} 和 Android 平台标识。</p>`,'提交反馈')});
const reportDirectoryView=new ReportDirectoryView(reportDirectory,()=>dialog('清除默认保存目录？','<p>仅清除目录设置，已经保存的文件保留。</p>','清除',true));
const variantLibraryView=new VariantLibraryView(experiments,{list:id=>repo.listVariantLibrary(id),read:(id,key)=>repo.readVariantArchive(id,key),remove:(id,key)=>repo.removeVariantArchive(id,key),clear:id=>repo.clearVariantLibrary(id,()=>clearVariantLibraryFiles(id)),compatible:entry=>{try{variantArchiveCandidate(entry,(variantTemplates as Record<string,Record<string,unknown>>)[entry.experimentId]);return true;}catch{return false;}},use:async entry=>{const base=(variantTemplates as Record<string,Record<string,unknown>>)[entry.experimentId],value=variantArchiveCandidate(entry,base),current=await repo.loadReportSettings(entry.experimentId);await repo.saveReportSettings(entry.experimentId,appendCustomVariant(current,base,entry.section,value));},import:async entries=>{let imported=0;for(const entry of entries)try{await repo.archiveVariant(entry);imported++;}catch(e){return {imported,total:entries.length,error:(e as Error).message};}return {imported,total:entries.length};},exportDesktop:async entries=>{const file=desktopVariantExport(entries,{experiments,templates:variantTemplates});await exportJson(file.name,file.data,'导出电脑版自建变体');},export:entries=>exportJson('自建变体库',{type:'lab-maker-variant-library',version:1,entries},'导出自建变体库'),confirm:(title,body)=>dialog(title,`<p>${esc(body)}</p>`,'确认',true)},{experiments,templates:variantTemplates});
const academicView=new AcademicView(academic,()=>dialog('清除教务会话？','<p>清除当前账号的教务登录和课表，实验数据、报告及其他系统会话保留。</p>','清除',true));
let portalView:PortalView|null=null;
let schoolReportView:SchoolReportView|null=null;
let portalModuleTask:Promise<typeof import('./features/portal.ts')>|null=null;
let schoolReportModuleTask:Promise<typeof import('./features/school-reports.ts')>|null=null;
const portalModule=()=>portalModuleTask??=(import('./features/portal.ts').catch(error=>{portalModuleTask=null;throw error;}));
const schoolReportModule=()=>schoolReportModuleTask??=(import('./features/school-reports.ts').catch(error=>{schoolReportModuleTask=null;throw error;}));
let schoolWarmHandle:number|null=null,schoolWarmIdle=false,schoolWarmComplete=false,schoolAutoEpoch=0,schoolAutoRunning:number|null=null;
const schoolAutoTried=new Set<string>();let schoolAutoBarrier:Promise<unknown>=Promise.resolve();
async function autoLoadSchoolCourse(){
 const epoch=schoolAutoEpoch;if(schoolAutoRunning===epoch)return;schoolAutoRunning=epoch;
 try{
  const preference=await repo.loadSchoolPreload();if(!preference.course||schoolAutoTried.has(preference.course))return;const [{preloadCourseAccount},accounts,module]=await Promise.all([import('./domain/school-preload.ts'),schoolAccounts.list(),portalModule()]);await schoolAutoBarrier;
  if(epoch!==schoolAutoEpoch||view!=='home'||document.hidden)return;const account=preloadCourseAccount(preference,accounts);if(!account||schoolAutoTried.has(account.id))return;
  portalView??=new module.PortalView(notice);schoolAutoTried.add(account.id);await portalView.warm(account);
 }catch{}finally{if(schoolAutoRunning===epoch)schoolAutoRunning=null;if(epoch!==schoolAutoEpoch&&view==='home'&&!document.hidden)scheduleSchoolWarmup();}
}
window.addEventListener('school-preload-changed',()=>{schoolAutoEpoch++;schoolAutoTried.clear();schoolAutoBarrier=schoolAutoBarrier.catch(()=>{}).then(()=>portalView?.cancelWarm());if(view==='home'&&!document.hidden)scheduleSchoolWarmup();});
let reportAutoEpoch=0,reportAutoRunning:number|null=null,reportAutoBarrier:Promise<unknown>=Promise.resolve();
const reportAutoTried=new Set<string>();
async function autoLoadSchoolReport(){
 const epoch=reportAutoEpoch;if(reportAutoRunning===epoch)return;reportAutoRunning=epoch;
 try{const preference=await repo.loadSchoolPreload();if(!preference.report||reportAutoTried.has(preference.report))return;
  const [{preloadReportAccount},accounts,module]=await Promise.all([import('./domain/school-preload.ts'),schoolAccounts.list(),schoolReportModule()]);await reportAutoBarrier;
  if(epoch!==reportAutoEpoch||view!=='home'||document.hidden)return;const account=preloadReportAccount(preference,accounts);if(!account||reportAutoTried.has(account.id))return;
  schoolReportView??=new module.SchoolReportView(notice,repo,experiments);reportAutoTried.add(account.id);await schoolReportView.warm(account);
 }catch{}finally{if(reportAutoRunning===epoch)reportAutoRunning=null;if(epoch!==reportAutoEpoch&&view==='home'&&!document.hidden)scheduleSchoolWarmup();}
}
window.addEventListener('school-report-preload-changed',()=>{reportAutoEpoch++;reportAutoTried.clear();reportAutoBarrier=reportAutoBarrier.catch(()=>{}).then(()=>schoolReportView?.cancelWarm());if(view==='home'&&!document.hidden)scheduleSchoolWarmup();});
function cancelSchoolWarmup(){if(schoolWarmHandle!==null){if(schoolWarmIdle)window.cancelIdleCallback(schoolWarmHandle);else clearTimeout(schoolWarmHandle);}schoolWarmHandle=null;}
function scheduleSchoolWarmup(){
 if(schoolWarmHandle!==null||document.hidden)return;
 const run=()=>{schoolWarmHandle=null;if(view!=='home'||document.hidden)return;if(!schoolWarmComplete)void Promise.allSettled([portalModule(),schoolReportModule()]).then(results=>{schoolWarmComplete=results.every(r=>r.status==='fulfilled');});void autoLoadSchoolCourse();void autoLoadSchoolReport();};
 schoolWarmIdle=typeof window.requestIdleCallback==='function';schoolWarmHandle=schoolWarmIdle?window.requestIdleCallback(run,{timeout:1500}):window.setTimeout(run,800);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelSchoolWarmup();else if(view==='home')scheduleSchoolWarmup();});
async function mountSchoolPage(kind:'course'|'report',host:HTMLElement,serial:number,experimentId?:string){
 try{
  if(kind==='course'){const module=await portalModule();if(serial!==routeSerial||!root.contains(host))return;portalView??=new module.PortalView(notice);portalView.mount(host);}
  else{const module=await schoolReportModule();if(serial!==routeSerial||!root.contains(host))return;schoolReportView??=new module.SchoolReportView(notice,repo,experiments);schoolReportView.mount(host,experimentId);}
 }catch{if(serial!==routeSerial||!root.contains(host))return;host.innerHTML='<section class="error-card"><p>页面资源未能读取，请检查资源后重新加载。</p><a class="button secondary" href="#/resource-check">检查资源</a><button class="button secondary" data-school-reload>重新加载</button></section>';host.querySelector('[data-school-reload]')!.addEventListener('click',()=>{if(reportQueueView.queue.running){notice('请先停止报告队列后再重新加载');return;}location.reload();});}
}
const reportManager = new ReportManager(repo, experiments, { notice, edit: id => go("experiment/" + id), confirm: (title, body) => dialog(title, body, "删除报告", true) });
let aiHistoryManager:AIHistoryManager|null=null;
let reportSectionsView:ReportSectionsView|null=null;
let easterEggView:EasterEggView|null=null;
async function mountEasterEgg(host:HTMLElement,serial:number){
 try{const [{EasterEggView},{easterEgg}]=await Promise.all([import('./features/easter-egg.ts'),import('./platform/easter-egg.ts')]);if(serial!==routeSerial||!root.contains(host))return;easterEggView??=new EasterEggView({...easterEgg,home:()=>go('home')});easterEggView.mount(host);}catch{if(serial===routeSerial&&root.contains(host))host.innerHTML='<section class="error-card"><p>彩蛋资源未能读取，请检查资源后重新打开。</p><a class="button secondary" href="#/resource-check">检查资源</a></section>';}
}
async function mountReportSections(host:HTMLElement,serial:number){
 let module:typeof import('./features/report-sections.ts');try{module=await import('./features/report-sections.ts');}catch{if(serial===routeSerial&&root.contains(host))host.innerHTML='<section class="error-card"><p>章节页面资源未能读取，请检查资源后重新打开。</p><a class="button secondary" href="#/resource-check">检查资源</a></section>';return;}if(serial!==routeSerial||!root.contains(host))return;
 reportSectionsView??=new module.ReportSectionsView(experiments,{
  load:async exp=>{const [templates,result]=await Promise.all([reportTemplates(),repo.inspectReportSettings(exp.id)]);return {names:reportSectionNames(templates[exp.id]),disabled:result.value?.disabledSections??[],warning:result.warning};},
  save:async(exp,names,disabled,expected)=>{const current=reportSectionNames((await reportTemplates())[exp.id]);if(JSON.stringify(current)!==JSON.stringify(names))throw Error('章节模板已变化，请重新读取后核对');return repo.saveSectionSwitches(exp.id,current,disabled,expected);},
 });reportSectionsView.mount(host);
}
async function mountAIHistory(host:HTMLElement,serial:number){
 let module:typeof import('./features/ai-history-manager.ts');try{module=await import('./features/ai-history-manager.ts');}catch{if(serial===routeSerial&&root.contains(host)){host.innerHTML='<section class="error-card"><p>页面资源未能读取，请检查资源完整性后重新加载。</p><a class="button secondary" href="#/resource-check">检查资源</a><button class="button secondary" data-history-reload>重新加载</button></section>';host.querySelector('[data-history-reload]')!.addEventListener('click',()=>location.reload());}return;}if(serial!==routeSerial||!root.contains(host))return;
 aiHistoryManager??=new module.AIHistoryManager(experiments,{
  scan:id=>repo.inspectAIHistory(id),read:(id,item)=>repo.readAIHistory(id,item),remove:(id,rows)=>repo.removeManagedAIHistory(id,rows),
  context:async exp=>{const [data,settings,resources]=await Promise.all([repo.load(exp),repo.inspectReportSettings(exp.id),dataSnapshot()]);const source=recordSource(resources.resourceHash,data.record);return {source,sourceHash:await textHash(source),settings:settings.value??defaultReportSettings(),warning:[data.warning,settings.warning].filter(Boolean).join('；')};},
  copy:copyReportText,confirm:(title,body)=>dialog(title,body,'删除记录',true),edit:id=>go('experiment/'+id),
},notice);
 aiHistoryManager.mount(host);
}
const modal = document.createElement("dialog");
modal.className = "modal";
modal.id = "modal";
modal.setAttribute("aria-labelledby", "modal-title");
document.body.append(modal);
const toast = document.createElement("div");
toast.id = "toast";
toast.role = "status";
toast.hidden = true;
document.body.append(toast);
let closeModal: ((value: boolean) => void) | null = null;
function notice(message: string) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 4000);
}
function dialog(
  title: string,
  body: string,
  confirm = "继续",
  danger = false,
): Promise<boolean> {
  if (closeModal) closeModal(false);
  modal.innerHTML = `<div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-dialog-close aria-label="关闭">×</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="button secondary" data-dialog-close>取消</button>${confirm ? `<button class="button ${danger ? "danger" : ""}" data-dialog-confirm>${esc(confirm)}</button>` : ""}</div>`;
  return new Promise((resolve) => {
    closeModal = (value) => {
      modal.close();
      closeModal = null;
      resolve(value);
    };
    modal.showModal();
  });
}
modal.addEventListener("click", (event) => {
  const target = (event.target as Element).closest(
    "[data-dialog-close],[data-dialog-confirm]",
  );
  if (target) closeModal?.(target.hasAttribute("data-dialog-confirm"));
});
modal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal?.(false);
});
const nav = () =>
  `<nav class="bottom-nav" aria-label="主导航">${[
    ["home", "book", "实验"],
    ["portal", "book", "一站通"],
    ["profile", "user", "学生信息"],
    ["settings", "settings", "设置"],
  ]
    .map(
      ([key, name, text]) =>
        `<button data-nav="${key}" class="${view === key ? "active" : ""}" ${view === key ? 'aria-current="page"' : ""}>${icon(name as keyof typeof icons)}<span>${text}</span></button>`,
    )
    .join("")}</nav>`;
function heading(title: string, subtitle: string, back = false) {
  return `<header class="app-header">${back ? `<button class="icon-button" data-nav="home" aria-label="返回实验目录">${icon("back")}</button>` : '<span class="logo">物</span>'}<div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${back ? `<button class="icon-button" data-action="more" aria-label="更多实验操作">${icon("more")}</button>` : `<span class="version">初版</span>`}</header>${queueEntryHTML()}`;
}
function queueEntryHTML(){const queue=reportQueueView.queue;if(!queue.items.length||currentHash==='#/report-queue')return '';const done=queue.items.filter(r=>r.status==='done').length;const status=reportQueueView.needsConfirmation?'待确认':queue.stopping?'正在停止':queue.paused?'已暂停':queue.running?'生成中':'已结束';return `<button class="queue-shortcut" data-nav="report-queue" data-queue-shortcut>报告队列 · ${done}/${queue.items.length} 完成 · ${status} →</button>`;}
function refreshQueueEntry(){const previous=root.querySelector('[data-queue-shortcut]'),html=queueEntryHTML();if(!html){previous?.remove();return;}const box=document.createElement('div');box.innerHTML=html;const next=box.firstElementChild!;if(previous){previous.textContent=next.textContent;}else root.querySelector('.app-header')?.after(next);}
function stateFor(exp: Experiment) {
  const s = summaries.get(exp.id);
  if (s?.error)
    return { label: "读取异常", kind: "error", detail: "进入后可重试或清除" };
  if (s?.doc && hasValues(s.doc.draft)) {
    const p = recordProgress(exp,s.doc);
    return {
      label: p.done === p.total ? "填写完整" : "已存草稿",
      kind: "saved",
      detail: `必填项 ${p.done} / ${p.total}`,
    };
  }
  return { label: "未录入", kind: "empty", detail: "点击开始录入" };
}
function home() {
  view = "home";
  document.body.classList.remove("editing");
  const recorded = [...summaries.values()].filter(
    (x) => x.doc && hasValues(x.doc.draft),
  ).length;
  root.innerHTML = `${heading("实验搭子", "本机实验记录")}${debugWarning?`<section class="error-card"><p>${esc(debugWarning)}</p><a class="button secondary" href="#/developer">查看并恢复</a></section>`:""}<section class="home-intro"><div><p class="eyebrow">实验目录</p><h2>这次，做哪个实验？</h2></div><span><b>${experiments.length}</b> 个实验 · ${recorded} 份记录</span></section><label class="search-box">${icon("search")}<input id="search" type="search" placeholder="搜索实验名称" aria-label="搜索实验名称" value="${esc(query)}"></label><div id="categories" class="categories" role="group" aria-label="实验分类"></div><div class="list-caption"><span id="result-count"></span><span>离线录入 · 自动保存</span></div><section id="experiment-list" class="experiment-list" aria-label="实验目录"></section>${nav()}`;
  filterList();
  scheduleSchoolWarmup();
}
function filterList() {
  const categories = document.querySelector("#categories");
  if (!categories) return;
  categories.innerHTML = [["all", "全部"], ...Object.entries(categoryNames)]
    .map(
      ([id, name]) =>
        `<button data-category="${id}" class="${category === id ? "active" : ""}" aria-pressed="${category === id}">${name}<small>${id === "all" ? 28 : experiments.filter((e) => e.category === id).length}</small></button>`,
    )
    .join("");
  const found = experiments
    .filter(
      (e) =>
        (category === "all" || e.category === category) &&
        e.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Object.keys(categoryNames).indexOf(a.category) -
          Object.keys(categoryNames).indexOf(b.category) ||
        a.name.localeCompare(b.name, "zh"),
    );
  document.querySelector("#result-count")!.textContent =
    `${found.length} 个实验`;
  document.querySelector("#experiment-list")!.innerHTML = found.length
    ? found
        .map((e) => {
          const s = stateFor(e);
          return `<button class="experiment-card ${e.category}" data-open="${e.id}"><span class="card-top"><span class="category-dot"></span><span>${categoryNames[e.category]}</span><span class="status ${s.kind}">${s.label}</span></span><strong>${esc(e.name)}</strong><span class="card-bottom">${esc(s.detail)}<span aria-hidden="true">→</span></span></button>`;
        })
        .join("")
    : '<div class="empty-state"><h3>没有找到这个实验</h3><p>试试更短的关键词，或切换到全部实验。</p></div>';
}
function numericInput(f: Field, value: string, extra = "", label = f.label) {
  return `<input class="measurement" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="100" data-key="${esc(f.key)}" ${extra} value="${esc(value)}" aria-label="${esc(label)}${f.unit ? "，" + esc(f.unit) : ""}">`;
}
function fieldHTML(f: Field, draft: Draft) {
  const value = draft[f.key],
    unit = f.unit ? `<span class="unit">${esc(f.unit)}</span>` : "",
    head = `<div class="field-heading"><span>${math(f.label)}${f.required ? "" : "<small>可选</small>"}</span>${unit}</div>`;
  if (f.type === "number")
    return `<div class="field scalar" id="field-${esc(f.key)}">${head}${numericInput(f, value as string)}${f.presets ? `<select data-preset="${esc(f.key)}" aria-label="${esc(f.label)}常用值"><option value="">选择常用值</option>${f.presets.map((p) => `<option value="${p.value}">${esc(p.label)}</option>`).join("")}</select>` : ""}</div>`;
  if (f.type === "science") {
    const v = value as Science;
    return `<div class="field" id="field-${esc(f.key)}">${head}<div class="science-row">${numericInput(f, v.mantissa, 'data-part="mantissa"', f.label + "尾数")}<span>× 10</span>${numericInput(f, v.exponent, 'data-part="exponent" inputmode="numeric"', f.label + "指数")}</div><select data-exponent="${esc(f.key)}" aria-label="选择常用指数"><option value="">常用指数</option>${(f.expSuggestions ?? [-6, -7, -8, -9, -10, -11, -12]).map((e) => `<option value="${e}">${e}</option>`).join("")}</select></div>`;
  }
  if (f.type === "array") {
    const values = value as string[];
    return `<div class="field" id="field-${esc(f.key)}">${head}<div class="array-grid">${values.map((v, i) => `<label><span>${i + 1}</span>${numericInput(f, v, `data-index="${i}"`, `${f.label} 第${i + 1}项`)}</label>`).join("")}</div>${f.variableLength ? `<div class="point-controls"><span>${values.length} 个测量点</span><button class="button compact secondary" data-resize="${f.key}" data-delta="-1" ${values.length <= (f.minLength ?? 3) ? "disabled" : ""}>${f.allowedLengths?'减少至 10 点':'删除末点'}</button><button class="button compact secondary" data-resize="${f.key}" data-delta="1" ${values.length >= (f.maxLength ?? 100) ? "disabled" : ""}>${f.allowedLengths?'增加至 12 点':'增加测点'}</button></div>` : ""}</div>`;
  }
  const matrix = value as string[][],
    rows = f.displayTranspose ? (matrix[0]?.length ?? 0) : matrix.length,
    cols = f.displayTranspose ? matrix.length : (matrix[0]?.length ?? 0);
  const rowLabels = f.displayTranspose ? f.colLabels : f.rowLabels,
    colLabels = f.displayTranspose ? f.rowLabels : f.colLabels;
  const header = Array.from({ length: cols }, (_, c) => {
    const position = f.colsFrom ? (draft[f.colsFrom] as string[])?.[c] : null;
    return `<th ${f.colsFrom ? `data-position-source="${f.colsFrom}" data-position-index="${c}"` : ""}>${math(f.colsFrom ? (position ? `D=${position} mm` : `第${c + 1}点`) : (colLabels?.[c] ?? String(c + 1)))}</th>`;
  }).join("");
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `<tr><th scope="row">${math(rowLabels?.[r] ?? String(r + 1))}</th>${Array.from(
        { length: cols },
        (_, c) => {
          const sr = f.displayTranspose ? c : r,
            sc = f.displayTranspose ? r : c;
          return `<td>${numericInput(f, matrix[sr][sc], `data-row="${sr}" data-col="${sc}"`, `${f.label} ${rowLabels?.[r] ?? r + 1} ${colLabels?.[c] ?? c + 1}`)}</td>`;
        },
      ).join("")}</tr>`,
  ).join("");
  return `<div class="field matrix-field" id="field-${esc(f.key)}">${head}<div class="table-scroll" tabindex="0" aria-label="${esc(f.label)}，可左右滑动"><table><thead><tr><th></th>${header}</tr></thead><tbody>${body}</tbody></table></div>${f.variableRows ? `<p class="field-note">至少填写 ${f.minFilledRows ?? 1} 行；未使用的行留空。</p>` : ""}</div>`;
}
function editor() {
  if (!session) return;
  view = "editor";
  document.body.classList.add("editing");
  const { exp, doc, blocked } = session;
  root.innerHTML = `${heading(exp.name, categoryNames[exp.category], true)}<div class="editor-summary"><div><span class="status saved" id="save-state">${blocked ? "读取异常" : "已载入本机数据"}</span><span id="completion"></span></div><label>实验日期<input type="date" id="experiment-date" value="${esc(doc.date)}" aria-label="实验日期"></label></div>${blocked ? '<section class="error-card"><b>本机数据未能读取，原文件未覆盖。</b><p>可重新读取，或清除该实验后重新填写。</p><button class="button secondary" data-action="retry">重新读取</button><button class="button danger" data-action="clear">清除本实验数据</button></section>' : ""}<div class="experiment-actions"><button class="button secondary" data-action="ocr">识别图片</button><button class="button secondary" data-action="prepare">实验预习 ↗</button><button class="button" id="open-report" data-action="report" ${blocked ? "disabled" : ""}>生成 / 查看报告</button></div><form id="measurement-form"><fieldset ${blocked || work ? "disabled" : ""}>${exp.schema.groups.map((g, i) => `<details class="group" ${i === 0 ? "open" : ""}><summary><span class="group-number">${String(i + 1).padStart(2, "0")}</span><h2>${math(measurementGroupTitle(exp.sourceId,g.name))}</h2><span class="chevron">⌄</span></summary><div class="group-fields">${isSoundExperiment(exp)&&g.fields.some(f=>f.key==="L2")?`<label class="ai-field" id="field-soundPhase">相邻位相记录点<select data-sound-phase><option value="">请选择</option><option value="alternating" ${doc.soundPhase==="alternating"?"selected":""}>同相与反相交替（半波长）</option><option value="same" ${doc.soundPhase==="same"?"selected":""}>相同相位（一个波长）</option></select></label>`:""}${g.fields.map((f) => fieldHTML(f, doc.draft)).join("")}</div></details>`).join("")}</fieldset></form><section class="photo-panel"><div><h2>原始数据照片</h2><button class="button secondary compact" data-action="photo" ${blocked ? "disabled" : ""}>${session.photo ? "更换照片" : "添加照片"}</button></div><div id="photo-preview">${session.photoError ? `<p class="ocr-warning">原始照片读取失败，请重新读取或添加照片。</p><button class="button secondary compact" data-action="retry">重新读取</button>` : session.imageUrl ? `<img src="${esc(session.imageUrl)}" alt="当前实验的原始数据照片"><button class="text-button" data-action="remove-photo">移除照片</button>` : "<p>尚未添加</p>"}</div><input id="photo-picker" type="file" accept="image/jpeg,image/png,image/webp" hidden></section><div class="editor-bottom"><div class="entry-tools"><button class="button secondary compact" data-action="sign" aria-label="切换当前数值正负号">±</button><button class="button secondary compact" data-action="exponent-token" aria-label="在当前数值中输入科学计数符号">e</button><button class="button secondary compact" data-action="next">下一项</button><button class="button secondary compact" data-action="save">保存</button></div><button class="button" data-action="validate" ${blocked ? "disabled" : ""}>检查数据</button></div><input id="data-picker" type="file" accept="application/json,.json" hidden>`;
  root.querySelectorAll<HTMLInputElement>('input.measurement').forEach((input,index,inputs)=>{input.enterKeyHint=index===inputs.length-1?'done':'next';});
  updateProgress();
}
function updateProgress() {
  if (!session) return;
  const p = recordProgress(session.exp,session.doc);
  const el = document.querySelector("#completion");
  if(el) el.textContent = `必填项 ${p.done} / ${p.total}`;
}
function saveState(text: string, error = false) {
  const el =
    document.querySelector("#save-state") ??
    document.querySelector("#profile-save-state");
  if (el) {
    el.textContent = text;
    el.classList.toggle("error", error);
  }
}
function changed() {
  if (!session || session.blocked) return;
  session.dirty = true;
  session.doc.updatedAt = new Date().toISOString();
  saveState("正在保存…");
  updateProgress();
  clearTimeout(timer);
  timer = setTimeout(
    () =>
      void flush().catch((e) => {
        saveState("保存失败，点击保存重试", true);
        notice((e as Error).message);
      }),
    350,
  );
}
async function flush() {
  clearTimeout(timer);
  const s = session;
  if (s?.dirty && !s.blocked) {
    const snapshot = structuredClone(s.doc);
    await repo.save(s.exp, snapshot);
    summaries.set(s.exp.id, { doc: snapshot });
    if (session === s && JSON.stringify(s.doc) === JSON.stringify(snapshot)) {
      s.dirty = false;
      saveState("已保存到本机");
    }
  }
  if (profileDirty) {
    const snapshot = structuredClone(profile);
    await repo.saveProfile(snapshot);
    if (JSON.stringify(snapshot) === JSON.stringify(profile)) {
      profileDirty = false;
      saveState("已保存到本机");
    }
  }
}
function profilePage() {
  view = "profile";
  document.body.classList.remove("editing");
  if(profileBlocked){root.innerHTML=`${heading("学生信息", "保存在当前设备")}<section class="error-card"><b>学生信息未能读取，原文件未覆盖。</b><p>请检查本机存储后重试。</p><button class="button secondary" data-action="retry-profile">重新读取</button></section>${nav()}`;return;}
  root.innerHTML = `${heading("学生信息", "保存在当前设备")}<section class="panel"><h2>基本信息</h2><p class="muted">用于生成当前设备的实验报告。</p>${[
    ["name", "姓名", "60"],
    ["studentId", "学号", "40"],
    ["className", "班级", "80"],
  ]
    .map(
      ([key, label, max]) =>
        `<label class="profile-field">${label}<input data-profile="${key}" value="${esc(profile[key as keyof Profile])}" maxlength="${max}" autocomplete="off" ${key === "studentId" ? 'inputmode="numeric"' : ""}></label>`,
    )
    .join(
      "",
    )}<div class="profile-actions"><span id="profile-save-state">自动保存到本机</span><button class="button" data-action="save-profile">保存</button></div></section>${nav()}`;
}
function settingsPage() {
  view = "settings";
  document.body.classList.remove("editing");
  root.innerHTML = `${heading("设置", "实验搭子手机版")}<section class="panel"><h2>当前版本</h2><a class="button secondary" href="#/app-updates">检查应用更新</a><div class="setting-row"><span>应用版本</span><strong>${esc(packageInfo.version)} · 开发版</strong></div><div class="setting-row"><span>内置实验</span><strong>28 个</strong></div><div class="setting-row"><span>运行平台</span><strong>${esc(Capacitor.getPlatform())}</strong></div></section><section class="panel"><h2>AI 服务</h2><p>分别配置报告问答与图片识别模型，密钥仅在本机加密保存。</p><div class="tutorial-actions"><button class="button" data-action="ai-config">配置 API</button><button class="button secondary" data-action="ai-tutorial">配置教程</button><button class="button secondary" data-action="ai-skills">技能管理</button></div></section><section class="panel"><h2>报告管理</h2><div class="ai-inline"><button class="button secondary" data-action="report-manager">管理已生成报告</button><a class="button secondary" href="#/report-queue">批量生成报告</a><a class="button secondary" href="#/report-directory">默认保存目录</a><a class="button secondary" href="#/variant-library">自建变体库</a><a class="button secondary" href="#/ai-history">AI 历史管理</a><a class="button secondary" href="#/report-sections">报告章节</a></div></section><section class="panel"><h2>实验资源</h2><button class="button secondary" data-action="resource-check">实验资源维护</button><a class="button secondary" href="#/data-updates">实验数据更新</a></section><section class="panel"><h2>开发者调试</h2><a class="button secondary" href="#/developer">打开调试工具</a></section><section class="panel"><h2>贡献数据</h2><a class="button secondary" href="#/contributions">贡献数据</a></section><section class="panel"><h2>帮助与反馈</h2><div class="ai-inline"><a class="button secondary" href="#/help/guide">使用说明</a><a class="button secondary" href="#/help/notice">必读公告</a><a class="button secondary" href="#/help/school">选课与实验问答</a><a class="button secondary" href="#/credits">感谢声明</a><a class="button secondary" href="#/feedback">意见反馈</a><a class="button secondary" href="#/easter-egg">请勿点击</a></div></section><section class="panel"><h2>本机数据</h2><p>测量数据、学生信息和原始照片保存在当前设备。请在实验页的“更多”中导出数据备份；导出文件不包含原始照片。</p><p class="muted">卸载应用可能删除本机记录，请先备份。</p></section>${nav()}`;
  const accountsPanel=document.createElement('section');accountsPanel.className='panel';accountsPanel.innerHTML='<h2>一站通账号</h2><a class="button secondary" href="#/school-accounts">管理本机账号</a>';root.querySelector('[data-action="report-manager"]')!.closest('section')!.before(accountsPanel);
  root.querySelector('.setting-row strong')!.textContent=packageInfo.version+' · 开发版';
}
let bootstrapReady = false;
async function route() {
  if (!bootstrapReady) return;
  cancelSchoolWarmup();
  const hash = location.hash || "#/home";
  if(queueBlocksRoute(hash,reportQueueView.queue.running)){history.replaceState(null,'',currentHash||'#/home');const label:Record<string,string>={'developer':'使用开发者调试','resource-check':'维护运行环境','data-updates':'更新实验资源','app-updates':'更新应用','easter-egg':'运行动效'};notice('请先停止报告队列后再'+(label[hash.replace(/^#\//,'').split('/')[0]]??'进行此操作'));return;}
  if (
    work || reportQueueView.isConfirming ||
    appUpdatesView.isSaving || developerView.isSaving || dataUpdatesView.isSaving || resourceCheck.isSaving || reports.isSaving ||
    aiFeatures.isSaving ||
    portalView?.isSaving ||
    schoolReportView?.isSaving ||
    reportSectionsView?.isSaving || aiHistoryManager?.isSaving || reportManager.isSaving || skillsView.isSaving||schoolAccountsView.isSaving||reportDirectoryView.isSaving||variantLibraryView.isSaving||feedbackView.isSaving||contributionsView.isSaving
  ) {
    history.replaceState(null, "", currentHash || "#/home");
    notice(
      contributionsView.isSaving ? "贡献正在处理，请等待或取消发送" : feedbackView.isSaving ? "反馈正在处理，请等待或取消发送" : portalView?.isSaving || schoolReportView?.isSaving
        ? "正在提交并核对官网课表，请稍候"
        : "正在处理本机数据，请稍候",
    );
    return;
  }
  try {
    await flush();
  } catch {
    history.replaceState(null, "", currentHash || "#/home");
    notice("保存失败，请重试保存后再离开");
    return;
  }
  if(!await aiFeatures.close()){
    history.replaceState(null, "", currentHash || "#/home");
    return;
  }
  portalView?.leave();
  schoolReportView?.leave();
  reports.onLeave();
  reportManager.leave();
  aiHistoryManager?.leave();
  reportSectionsView?.leave();
  easterEggView?.leave();
  reportQueueView.leave();
  resourceCheck.leave();
  dataUpdatesView.leave();
  appUpdatesView.leave();
  developerView.leave();
  feedbackView.leave();
  helpView.leave();
  creditsView.leave();
  contributionsView.leave();
  skillsView.leave();
  schoolAccountsView.leave();
  reportDirectoryView.leave();
  variantLibraryView.leave();
  academicView.leave();
  const serial = ++routeSerial;
  if (closeModal) closeModal(false);
  if (session?.imageUrl?.startsWith("blob:"))
    URL.revokeObjectURL(session.imageUrl);
  session = null;
  lastInput = null;
  currentHash = hash;
  document.activeElement instanceof HTMLElement &&
    document.activeElement.blur();
  window.scrollTo(0, 0);
  const parts = hash.replace(/^#\//, "").split("/");
  if (parts[0] === "experiment") {
    const exp = byId.get(parts[1]);
    if (!exp) {
      notice("未找到该实验");
      location.hash = "/home";
      return;
    }
    root.innerHTML = '<div class="loading">正在读取本机数据…</div>';
    let record = recordBlank(exp),
      warning = "",
      blocked = false,
      photo: Photo | null = null,
      photoError = false,
      imageUrl: string | null = null;
    try {
      const result = await repo.load(exp);
      record = result.record;
      warning = result.warning || pendingRecordWarnings.get(exp.id) || '';
    } catch (e) {
      blocked = true;
      warning = (e as Error).message;
    }
    try {
      photo = await repo.loadPhoto(exp.id);
      if (photo) imageUrl = await photoUrl(photo);
    } catch {
      photoError = true;
      warning = warning || "原始照片读取失败，请重新读取或添加。";
    }
    if (serial !== routeSerial) {
      if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
      return;
    }
    session = {
      exp,
      doc: record,
      dirty: false,
      blocked,
      photo,
      photoError,
      imageUrl,
      serial,
    };
    pendingRecordWarnings.delete(exp.id);
    editor();
    if (warning) notice(warning);
  } else if (parts[0] === "ai-skills") {
    view="settings";document.body.classList.remove("editing");root.innerHTML=`${heading("AI 技能", "启停与导入")}<div id="skill-host"></div>${nav()}`;skillsView.mount(root.querySelector<HTMLElement>("#skill-host")!);
  } else if(parts[0]==='variant-library'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('自建变体库','设置')}<div id="variant-library-host"></div>${nav()}`;variantLibraryView.mount(root.querySelector<HTMLElement>('#variant-library-host')!);
  } else if(parts[0]==='ai-history'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('AI 历史管理','设置')}<div id="ai-history-host"><p class="loading">正在读取历史…</p></div>${nav()}`;await mountAIHistory(root.querySelector<HTMLElement>('#ai-history-host')!,serial);
  } else if(parts[0]==='report-sections'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('报告章节','设置')}<div id="report-sections-host"><p class="loading">正在读取章节…</p></div>${nav()}`;await mountReportSections(root.querySelector<HTMLElement>('#report-sections-host')!,serial);
  } else if(parts[0]==='easter-egg'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('请勿点击','设置')}<div id="easter-egg-host"><p class="loading">正在准备…</p></div>${nav()}`;await mountEasterEgg(root.querySelector<HTMLElement>('#easter-egg-host')!,serial);
  } else if(parts[0]==='report-directory'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('报告保存目录','设置')}<div id="report-directory-host"></div>${nav()}`;reportDirectoryView.mount(root.querySelector<HTMLElement>('#report-directory-host')!);
  } else if(parts[0]==='academic'){
    view='portal';document.body.classList.remove('editing');root.innerHTML=`${heading('教务课表','一站通')}<div id="academic-host"></div>${nav()}`;academicView.mount(root.querySelector<HTMLElement>('#academic-host')!,portalView?.currentAccount??'');
  } else if(parts[0]==='school-accounts'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('本机账号','一站通')}<div id="school-accounts-host"></div>${nav()}`;schoolAccountsView.mount(root.querySelector<HTMLElement>('#school-accounts-host')!,schoolSystem(parts[1])?parts[1]:'course');
  } else if(parts[0]==='contributions'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('贡献数据','设置')}<div id="contributions-host"></div>${nav()}`;contributionsView.mount(root.querySelector<HTMLElement>('#contributions-host')!);
  } else if(parts[0]==='credits'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('感谢声明','实验搭子')}<div id="credits-host"></div>${nav()}`;creditsView.mount(root.querySelector<HTMLElement>('#credits-host')!);
  } else if(parts[0]==='help'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('帮助','设置')}<div id="help-host"></div>${nav()}`;helpView.mount(root.querySelector<HTMLElement>('#help-host')!,parts[1]);
  } else if(parts[0]==='feedback'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('意见反馈','设置')}<div id="feedback-host"></div>${nav()}`;feedbackView.mount(root.querySelector<HTMLElement>('#feedback-host')!);
  } else if(parts[0]==='app-updates'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('应用更新','设置')}<div id="app-update-host"></div>${nav()}`;appUpdatesView.mount(root.querySelector<HTMLElement>('#app-update-host')!);
  } else if(parts[0]==='developer'){
    view='settings';document.body.classList.remove('editing');root.innerHTML=`${heading('开发者调试','设置')}<div id="developer-host"></div>${nav()}`;developerView.mount(root.querySelector<HTMLElement>('#developer-host')!);
  } else if(parts[0]==="data-updates"){
    view="settings";root.innerHTML=`${heading("实验数据更新","实验资源")}<div id="data-update-host"></div>${nav()}`;dataUpdatesView.mount(root.querySelector<HTMLElement>("#data-update-host")!);
  } else if (parts[0] === "resource-check") {
    view="settings"; document.body.classList.remove("editing");
    root.innerHTML=`${heading("实验资源维护", "安装资源与离线报告")}<div id="resource-check-host"></div>${nav()}`;
    resourceCheck.mount(root.querySelector<HTMLElement>("#resource-check-host")!);
  } else if(parts[0] === "report-queue"){
    view="settings";document.body.classList.remove("editing");root.innerHTML=`${heading("批量生成报告","报告管理")}<div id="report-queue-host"></div>${nav()}`;reportQueueView.mount(root.querySelector<HTMLElement>("#report-queue-host")!);
  } else if (parts[0] === "report-manager") {
    view = "settings"; document.body.classList.remove("editing");
    root.innerHTML = `${heading("报告管理", "本机已生成报告")}<div id="report-manager-host"></div>${nav()}`;
    reportManager.mount(root.querySelector<HTMLElement>("#report-manager-host")!);
  } else if (parts[0] === "school-reports") {
    view = "portal";
    document.body.classList.remove("editing");
    root.innerHTML = `${heading("实验报告提交", "一站通")}<div id="school-report-host"><p class="loading">正在准备报告页面…</p></div>${nav()}`;
    await mountSchoolPage('report',
      root.querySelector<HTMLElement>("#school-report-host")!,
      serial,parts[1],
    );
  } else if (parts[0] === "portal") {
    view = "portal";
    document.body.classList.remove("editing");
    root.innerHTML = `${heading("一站通", "学校实验系统")}<div class="ai-inline"><a class="button secondary" href="#/academic">教务课表</a></div><div id="portal-host"><p class="loading">正在准备一站通…</p></div>${nav()}`;
    await mountSchoolPage('course',root.querySelector<HTMLElement>("#portal-host")!,serial);
  } else if (parts[0] === "profile") profilePage();
  else if (parts[0] === "settings") settingsPage();
  else home();
  refreshQueueEntry();
}
function go(target: string) {
  location.hash = `/${target}`;
}
function editInput(input: HTMLInputElement) {
  const s = session;
  if (!s || s.blocked || work) return;
  const key = input.dataset.key;
  if (!key) return;
  const value = input.value.slice(0, 100);
  if (input.dataset.part)
    (s.doc.draft[key] as unknown as Record<string, string>)[
      input.dataset.part
    ] = value;
  else if (input.dataset.index !== undefined)
    (s.doc.draft[key] as string[])[+input.dataset.index] = value;
  else if (input.dataset.row !== undefined)
    (s.doc.draft[key] as string[][])[+input.dataset.row][+input.dataset.col!] =
      value;
  else s.doc.draft[key] = value;
  document
    .querySelectorAll<HTMLElement>(
      `[data-position-source="${CSS.escape(key)}"]`,
    )
    .forEach((th) => {
      const v = (s.doc.draft[key] as string[])[
        Number(th.dataset.positionIndex)
      ];
      th.textContent = v
        ? `D=${v} mm`
        : `第${Number(th.dataset.positionIndex) + 1}点`;
    });
  changed();
}
root.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.dataset.key)
    lastInput = event.target;
});
root.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.id === "search") {
    query = input.value;
    filterList();
  } else if (input.dataset.key) editInput(input);
  else if (input.id === "experiment-date" && session) {
    session.doc.date = input.value;
    changed();
  } else if (input.dataset.profile) {
    profile[input.dataset.profile as keyof Profile] = input.value;
    profileDirty = true;
    saveState("正在保存…");
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        void flush().catch(() => {
          saveState("保存失败，请重试", true);
        }),
      350,
    );
  }
});
root.addEventListener("change", (event) => {
  const select = event.target;
  if (select instanceof HTMLSelectElement) {
    if(select.hasAttribute('data-sound-phase')){if(!session||!isSoundExperiment(session.exp))return;if(select.value==='')delete session.doc.soundPhase;else if(validSoundPhase(select.value))session.doc.soundPhase=select.value;else return;changed();return;}
    const key = select.dataset.preset ?? select.dataset.exponent;
    if (!key || !select.value) return;
    const selector = select.dataset.exponent
      ? `input[data-key="${key}"][data-part="exponent"]`
      : `input[data-key="${key}"]`;
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.value = select.value;
    editInput(input);
    select.value = "";
  }
  if (
    event.target instanceof HTMLInputElement &&
    event.target.id === "data-picker"
  )
    void importFile(event.target.files?.[0]);
  if (
    event.target instanceof HTMLInputElement &&
    event.target.id === "photo-picker"
  )
    void attachPhoto(event.target.files?.[0]);
});
root.addEventListener("submit", (event) => event.preventDefault());
root.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.isComposing||!(event.target instanceof HTMLInputElement)||!event.target.matches('input.measurement'))return;
  event.preventDefault();void action('next').catch(e=>notice((e as Error).message||'保存失败，请重试'));
});
root.addEventListener("pointerdown", (event) => {
  if (
    (event.target as Element).closest(
      '[data-action="sign"],[data-action="exponent-token"],[data-action="next"],[data-action="save"]',
    )
  )
    event.preventDefault();
});
root.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("button");
  if (!button) return;
  if (button.dataset.nav) {
    go(button.dataset.nav);
    return;
  }
  if (button.dataset.open) {
    go("experiment/" + button.dataset.open);
    return;
  }
  if (button.dataset.category) {
    category = button.dataset.category as Category | "all";
    filterList();
    return;
  }
  if (button.dataset.resize) {
    void resize(
      button.dataset.resize,
      Number(button.dataset.delta) as 1 | -1,
    ).catch((e) => notice((e as Error).message));
    return;
  }
  if (button.dataset.action)
    void action(button.dataset.action).catch((e) =>
      notice((e as Error).message || "操作未完成，请重试"),
    );
});
async function resize(key: string, delta: 1 | -1) {
  const s = session;
  if (!s || work || s.blocked) return;
  const f = fields(s.exp.schema).find((f) => f.key === key)!;
  if (delta < 0) {
    const v = s.doc.draft[key] as string[],
      m = f.pairedMatrix ? (s.doc.draft[f.pairedMatrix] as string[][]) : [];
    const nextLength = f.allowedLengths ? ([...f.allowedLengths].reverse().find(n=>n<v.length) ?? v.length) : v.length-1;
    if (v.slice(nextLength).some(Boolean) || m.some((row) => row.slice(nextLength).some(Boolean)))
      if (
        !(await dialog(
          "删除末尾测量点？",
          `<p>将删除末尾 ${v.length-nextLength} 个测量点及对应数据。</p>`,
          "删除末点",
          true,
        ))
      )
        return;
  }
  if (session !== s) return;
  s.doc.draft = resizePoints(s.exp.schema, s.doc.draft, key, delta);
  changed();
  const opened = [
    ...root.querySelectorAll<HTMLDetailsElement>("details[open]"),
  ].map((d) => d.querySelector("h2")?.textContent);
  editor();
  root
    .querySelectorAll<HTMLDetailsElement>("details")
    .forEach(
      (d) => (d.open = opened.includes(d.querySelector("h2")?.textContent)),
    );
  await flush();
}
async function importFile(file?: File) {
  const s = session;
  if (!file || !s || s.blocked || work) return;
  try {
    if (file.size > 1024 * 1024) throw Error("数据文件不能超过 1 MB");
    const raw=JSON.parse(await file.text()),draft = importMeasurements(s.exp,raw),soundPhase=importedSoundPhase(s.exp,raw);
    if (session !== s) return;
    if (
      !(await dialog(
        "导入本实验数据？",
        "<p>当前测量数据将被替换。学生信息和原始照片不变。</p>",
        "导入",
      ))
    )
      return;
    if (session !== s) return;
    s.doc.draft = draft;
    if(isSoundExperiment(s.exp)){if(soundPhase)s.doc.soundPhase=soundPhase;else delete s.doc.soundPhase;}
    changed();
    await flush();
    editor();
    notice("已导入并保存到本机");
  } catch (e) {
    notice((e as Error).message || "JSON 数据文件无法读取");
  }
}
async function attachPhoto(file?: File) {
  const s = session;
  if (!file || !s || s.blocked || work) return;
  work = true;
  root.querySelector<HTMLFieldSetElement>("fieldset")!.disabled = true;
  let photo: Photo | null = null,
    committed = false, publishAttempt = false, stagedUrl = "", cacheCleanupFailed = false;
  try {
    photo = await storePhoto(s.exp.id, file);
    if (session !== s) {
      await deletePhotoFile(photo);
      return;
    }
    const url = await photoUrl(photo);stagedUrl=url;
    publishAttempt = true;
    await repo.savePhoto(s.exp.id, photo);
    committed = true;
    const old = s.photo;
    if (s.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(s.imageUrl);
    s.photo = photo;
    s.photoError = false;
    s.imageUrl = url;
    await repo.clearOCR(s.exp.id).catch(()=>{cacheCleanupFailed=true;});
    if (old)
      await deletePhotoFile(old).catch(() =>
        notice("新照片已保存，旧照片可在清除数据时清理"),
      );
    await flush();
    editor();
    notice(cacheCleanupFailed?"原始照片已保存；旧识图缓存未能清除":"原始照片已保存");
  } catch (e) {
    if(stagedUrl.startsWith("blob:")&&!committed)URL.revokeObjectURL(stagedUrl);
    if (photo && !committed && !publishAttempt) await deletePhotoFile(photo).catch(() => {});
    notice(publishAttempt&&!committed?"照片保存状态待核实，新旧照片文件均未删除；请重新打开实验检查":committed?"照片已保存，其他数据未能保存，请重试":(e as Error).message || "照片保存失败，请重试");
  } finally {
    work = false;
    const form = root.querySelector<HTMLFieldSetElement>("fieldset");
    if (form) form.disabled = !!session?.blocked;
  }
}
async function action(name: string) {
  if(name === 'retry-profile'){
    const button=root.querySelector<HTMLButtonElement>('[data-action=retry-profile]');if(button)button.disabled=true;
    try{const loaded=await repo.loadProfile();profile=loaded;profileBlocked=false;profileDirty=false;if(view==='profile')profilePage();notice('学生信息已重新读取');}
    catch{if(button&&button.isConnected)button.disabled=false;notice('学生信息仍无法读取，请检查本机存储后重试');}
    return;
  }
  if(name === "ai-skills") { go("ai-skills"); return; }
  if(name === "resource-check") { go("resource-check"); return; }
  if (name === "report-manager") { go("report-manager"); return; }
  if (name === "ai-config" || name === "ai-tutorial") {
    await aiFeatures.config(name === "ai-tutorial");
    return;
  }
  if (name === "ocr") {
    await flush();
    await aiFeatures.ocr();
    return;
  }
  if (name === "save-profile") {
    await flush();
    notice("学生信息已保存");
    return;
  }
  const s = session;
  if (!s) return;
  if (work)
    return notice(
      portalView?.isSaving || schoolReportView?.isSaving
        ? "正在提交并核对官网课表，请稍候"
        : "正在处理本机数据，请稍候",
    );
  if (name === "prepare") {
    if (!preparationTarget(s.exp.name).matched) {
      const confirmed = await dialog("实验预习", "<p>暂未匹配到本实验的预习入口，可在学校实验目录中查看。</p>", "打开学校目录");
      if (!confirmed || session !== s) return;
    }
    await openPreparation(s.exp.name);
    return;
  }
  if (name === "report") {
    if (profileBlocked) return notice("学生信息未能读取，请在学生信息页重试");
    await reports.open();
    return;
  }
  if (name === "sign" || name === "exponent-token") {
    if (!lastInput || !root.contains(lastInput))
      return notice("请先选择一个数值输入框");
    const edit=editNumericToken(lastInput.value,lastInput.selectionStart,lastInput.selectionEnd,name);
    lastInput.value=edit.value;
    lastInput.dispatchEvent(new Event("input", { bubbles: true }));
    lastInput.focus();
    lastInput.setSelectionRange(edit.start,edit.end);
    return;
  }
  if (name === "next") {
    const inputs = [
      ...root.querySelectorAll<HTMLInputElement>("input.measurement"),
    ];
    const i = lastInput ? inputs.indexOf(lastInput) : -1;
    const next = inputs[i + 1];
    if (next) {
      next.closest("details")?.setAttribute("open", "");
      next.focus();
      if(!document.documentElement.classList.contains('viewport-managed'))next.scrollIntoView({ block: "center", behavior: "smooth" });
    } else if(inputs.length) {
      await flush();lastInput?.blur();notice('已到最后一项，草稿已保存');
    }
    return;
  }
  if (name === "save") {
    await flush();
    notice("草稿已保存，未填写项可以稍后继续");
    return;
  }
  if (name === "retry") {
    await route();
    return;
  }
  if (name === "photo") {
    root.querySelector<HTMLInputElement>("#photo-picker")?.click();
    return;
  }
  if (name === "remove-photo") {
    if (work) return;
    work = true;
    try {
      await repo.clearOCR(s.exp.id);
      await repo.removePhoto(s.exp.id);
      await deletePhotos(s.exp.id);
      if (s.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(s.imageUrl);
      s.photo = null;
      s.photoError = false;
      s.imageUrl = null;
      editor();
    } finally {
      work = false;
      const form = root.querySelector<HTMLFieldSetElement>("fieldset");
      if (form) form.disabled = !!session?.blocked;
    }
    return;
  }
  if (name === "clear") {
    if (work) return notice("照片正在处理，请稍后清除");
    if (
      !(await dialog(
        "清除本实验数据？",
        "<p>测量数据、原始照片、生成的报告与图表、报告配置及本实验 AI 历史都将清除。</p><p>学生信息及其他实验记录保留。</p>",
        "清除数据",
        true,
      ))
    )
      return;
    if (session !== s) return;
    clearTimeout(timer);
    work = true;
    const previousDirty = s.dirty, previousBlocked = s.blocked;
    let resetCompleted = false;
    try {
      s.dirty = false;
      s.blocked = true;
      const blank = await repo.reset(s.exp, async () => {});
      resetCompleted = true;
      s.doc = blank;
      s.dirty = false;
      s.blocked = false;
      s.photo = null;
      if (s.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(s.imageUrl);
      s.imageUrl = null;
      summaries.set(s.exp.id, { doc: blank });
      editor();
      await repo.removePhoto(s.exp.id);
      await deletePhotos(s.exp.id);
      s.photoError = false;
      editor();
      await reports.clear(s.exp);
      notice("本实验数据已清除");
    } catch (e) {
      if (!resetCompleted) {
        // A failed reset may already have written a newer blank copy. Keep
        // the original draft pending until it is safely written back.
        s.dirty = previousDirty || !previousBlocked;
        s.blocked = previousBlocked;
      }
      editor();
      if (!resetCompleted && s.dirty && !s.blocked) saveState('保存失败，点击保存重试', true);
      throw Error("清除未完成，请重试：" + (e as Error).message);
    } finally {
      work = false;
      const form = root.querySelector<HTMLFieldSetElement>("fieldset");
      if (form) form.disabled = !!session?.blocked;
    }
    return;
  }
  if (s.blocked) return notice("请先重试读取或清除损坏数据");
  if(name==='fill-test'){
    work=true;let started=false;
    try{
      await flush();
      if(!await dialog('填入当前实验测试数据？','<p>将替换并保存“'+esc(s.exp.name)+'”的测量数据。保留照片、报告和章节设置；先备份原测量记录，本次备份将替换上次测试前备份。测试数据不能作为实测数据提交。</p>','填入测试数据',true))return;
      if(session!==s)return;started=true;await fillOneDebugData(repo,experiments,s.exp);notice('已填入测试数据，可在调试工具中恢复');
    }finally{
      if(started){try{s.doc=(await repo.load(s.exp)).record;s.dirty=false;summaries.set(s.exp.id,{doc:s.doc});}catch{s.blocked=true;}
      try{debugWarning=await repo.loadDebugInterrupted()?'上次调试写入未完成，请恢复测试前备份':'';}catch{debugWarning='调试操作状态未能读取，请检查测试前备份';}}
      work=false;if(session===s)editor();
    }
    return;
  }
  if (name === "validate") {
    await flush();
    const issues = inspect(s.exp.schema, s.doc.draft);if(isSoundExperiment(s.exp)&&!validSoundPhase(s.doc.soundPhase))issues.push({key:'soundPhase',message:'请选择位相法相邻记录点间隔'});
    if (!issues.length) {
      await dialog(
        "必填项已填写完整",
        "<p>录入格式检查通过。</p><p>请核对原始记录，并检查生成报告中的计算与处理结果。</p>",
        "知道了",
      );
      return;
    }
    const bad = new Map<string, string>();
    for (const issue of issues)
      if (!bad.has(issue.key)) bad.set(issue.key, issue.message);
    await dialog(
      `还有 ${bad.size} 项需要检查`,
      `<ul class="issues">${[...bad].map(([key, message]) => `<li><button data-issue="${esc(key)}">${esc(message)}</button></li>`).join("")}</ul>`,
      "返回修改",
    );
    return;
  }
  if (name === "more") {
    void dialog(
      "实验操作",
      `<div class="menu-actions"><button data-menu="import">导入 JSON 数据</button><button data-menu="export">导出 JSON 数据</button><button data-menu="fill-test">填入测试数据</button><button data-menu="clear" class="danger-text">清除本实验数据</button></div>`,
      "",
    );
    return;
  }
  if (name === "import") {
    root.querySelector<HTMLInputElement>("#data-picker")?.click();
    return;
  }
  if (name === "export") {
    await flush();
    if (inspect(s.exp.schema, s.doc.draft, false).length)
      throw Error("存在无法识别或超限的数值，请先检查修改后导出");
    await exportJson(
      s.exp.name + "-测量数据",
      exportMeasurements(s.exp, s.doc, profile),
    );
    return;
  }
}
modal.addEventListener("click", (event) => {
  const t = (event.target as Element).closest<HTMLElement>(
    "[data-menu],[data-issue]",
  );
  if (!t) return;
  closeModal?.(false);
  if (t.dataset.menu)
    void action(t.dataset.menu).catch((e) => notice((e as Error).message));
  if (t.dataset.issue) {
    const field = document.getElementById("field-" + t.dataset.issue);
    field?.closest("details")?.setAttribute("open", "");
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.querySelector<HTMLElement>("input,select")?.focus({ preventScroll: true });
  }
});
window.addEventListener("hashchange", () => void route());
window.addEventListener("beforeunload", (event) => {
  if (session?.dirty || profileDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden)
    void flush().catch(() => saveState("保存失败，请重试", true));
});
if (Capacitor.isNativePlatform()) {
  void App.addListener("backButton", () => {
    if(closeModal){closeModal(false);return;}
    if(easterEggView?.back())return;
    if(reportQueueView.isConfirming){notice('请先处理队列确认');return;}
    if(appUpdatesView.isSaving){notice('正在处理应用更新，可在页面停止下载');return;}
    if(developerView.isSaving){notice('正在处理调试数据，请稍候');return;}
    if(dataUpdatesView.isSaving){notice('正在处理实验数据更新，可在页面停止检查');return;}
    if(resourceCheck.isSaving){notice('正在刷新运行环境，可在页面点击停止');return;}
    if(contributionsView.isSaving){notice('贡献正在处理，请等待或取消发送');return;}
    if(feedbackView.isSaving){notice('反馈正在处理，请等待或取消发送');return;}
    if(skillsView.isSaving){notice("正在保存技能，请稍候");return;}
    if(schoolAccountsView.isSaving){notice('正在保存本机账号，请稍候');return;}
    if(reportDirectoryView.isSaving){notice('正在处理保存目录，请稍候');return;}
    if(variantLibraryView.isSaving){notice('正在处理自建变体，请稍候');return;}
    if(aiHistoryManager?.isSaving){notice('正在处理 AI 历史，请稍候');return;}
    if(reportSectionsView?.isSaving){notice('正在保存章节开关，请稍候');return;}
    if(aiHistoryManager?.isOpen){aiHistoryManager.closeDetail();return;}
    if(variantLibraryView.isOpen){variantLibraryView.closeDetail();return;}
    if (reportManager.isOpen) { reportManager.close(); return; }
    if (reportManager.isSaving && !closeModal) { notice("报告正在处理，请稍候"); return; }
    if (schoolReportView?.isOpen) {
      schoolReportView.close();
      return;
    }
    if (portalView?.isOpen) {
      portalView.closeReview();
      return;
    }
    if (aiFeatures.isOpen) {
      aiFeatures.back();
      return;
    }
    if (reports.isOpen) {
      if(reports.closeTopPreview())return;
      reports.close();
      return;
    }
    if (view !== "home") go("home");
    else
      void flush()
        .then(() => App.minimizeApp())
        .catch(() => notice("保存失败，请先重试"));
  });
  void App.addListener("appStateChange", ({ isActive }) => {
    if(!isActive)easterEggView?.background();
    if (!isActive)
      void flush().catch(() => saveState("保存失败，请重试", true));
  });
}
async function start() {
  root.innerHTML = '<div class="loading">正在读取本机实验记录…</div>';
  try {
    profile = await repo.loadProfile();
  } catch {
    profileBlocked=true;
    notice("学生信息未能读取，请在学生信息页重试");
  }
  await Promise.all(
    experiments.map(async (exp) => {
      try {
        const r = await repo.load(exp);
        summaries.set(exp.id, { doc: r.record });
        if(r.warning)pendingRecordWarnings.set(exp.id,r.warning);
      } catch (e) {
        summaries.set(exp.id, { error: (e as Error).message });
      }
    }),
  );
  try{debugWarning=await repo.loadDebugInterrupted()?'上次调试写入未完成，请恢复测试前备份':'';}catch{debugWarning='调试操作状态未能读取，请检查测试前备份';}
  const dataState=await dataSnapshot();if(dataState.warning)notice(dataState.warning);
  bootstrapReady = true;
  await route();
}
void start().catch(() => {
  root.innerHTML =
    '<div class="empty-state"><h2>本机存储暂不可用</h2><p>请重新打开应用后重试。</p><button class="button" onclick="location.reload()">重新读取</button></div>';
});
