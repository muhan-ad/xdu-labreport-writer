import {academic} from '../platform/academic.ts';
import {academicAvailable,academicConflict,type AcademicResult} from '../domain/academic.ts';
import { CourseGuides } from "./course-guides.ts";
import {SavedAccountPicker} from './school-accounts.ts';
import {schoolAccounts} from '../platform/school-accounts.ts';
import type {SavedSchoolAccount} from '../domain/school-accounts.ts';
import { SchoolPortal, type PreparedCourse } from "../platform/portal.ts";
import {
  CourseFilterPanel,
  type FilterDirectory,
} from "./course-filter-panel.ts";
import {
  defaultCourseFilters,
  filterCount,
  matchesCourseFilters,
} from "../domain/course-filters.ts";
import {
  cancelReason,
  courseStart,
  nearestFuture,
  type Slot,
  type Overview,
} from "../domain/portal.ts";
import { experimentReview, teacherReviews } from "../domain/reviews.ts";
import {
  metadataKey,
  matchTeachers,
  type CourseDetails,
} from "../domain/course-metadata.ts";
import {
  eligibilityReason,
  resolveSlotDate,
} from "../domain/course-eligibility.ts";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const badge = (name: string) => {
  const category = experimentReview(name)?.category;
  return category === "recommended"
    ? '<span class="course-badge">推荐</span>'
    : category === "not_recommended"
      ? '<span class="course-badge negative">不推荐</span>'
      : "";
};
export class PortalView {
  private accountPicker=new SavedAccountPicker(schoolAccounts,'course',account=>this.action('login-saved',undefined,account),text=>{this.status=text;this.render();});
  private service = new SchoolPortal();
  get currentAccount(){return this.service.overview?.identity.account??'';}
  private host: HTMLElement | null = null;
  private academicValue:AcademicResult|null=null;
  private academicToken=0;
  private token = 0;
  private busy = false;
  private warmTask:Promise<void>|null=null;
  private warmEpoch=0;
  private warmOwnsSession=false;
  private warmedOwner='';
  private warmedFilters='';
  private week: number | null = null;
  private slots: Slot[] | null = null;
  private tab = "selected";
  private status = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private review = document.createElement("dialog");
  private confirmation = document.createElement("dialog");
  private prepared: PreparedCourse | null = null;
  private committing = false;
  private expiresAt = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private metadata = new Map<string, CourseDetails>();
  private filters = defaultCourseFilters();
  private search = "";
  private directorySlots = new Map<string, Slot>();
  private directoryFailed = new Set<number>();
  private directoryTask: Promise<void> | null = null;
  private directoryEpoch = 0;
  private directoryReadAt = 0;
  private directoryOverview: Overview | null = null;
  private directoryListeners = new Set<(d: FilterDirectory) => void>();
  private directoryState: FilterDirectory = {
    experiments: [],
    status: "尚未查询",
  };
  private crossWeek = false;
  private searchSlots: Slot[] = [];
  private academicReady(){return academicAvailable(this.academicValue,this.currentAccount);}
  private academicLabel(){return this.academicReady()?'教务课表已同步':this.filters.hideAcademic?'教务冲突未校验，教务筛选暂未应用':'教务冲突未校验';}
  private slotReason(item:Slot,overview:Overview,now=Date.now()){
    const base=eligibilityReason(item,overview,now);if(base)return base;const result=academicConflict(this.academicValue,item,overview,now);return result.status==='conflict'?'与教务课程“'+result.event!.name+'”冲突':'';
  }
  private async refreshAcademic(){const owner=this.currentAccount,token=++this.academicToken;if(!owner){this.academicValue=null;return;}let value:AcademicResult|null=null;try{value=await academic.status(owner);}catch{}if(token!==this.academicToken||!this.host||owner!==this.currentAccount)return;this.academicValue=value;this.refreshTimes();}
  private async loadWarmedFilters(){const owner=this.warmedOwner,token=this.token;if(!this.host||!owner||owner!==this.currentAccount||this.warmedFilters===owner)return;try{await this.filterPanel.load(owner);if(token===this.token&&this.host&&this.currentAccount===owner)this.warmedFilters=owner;}catch{if(token===this.token)this.status='筛选设置未能读取，可在实验筛选中重试';}}
  private hydrateWarmed(){if(!this.host||!this.warmedOwner||this.currentAccount!==this.warmedOwner)return;const token=this.token;void this.hydrate(token,false).then(()=>{if(token===this.token&&this.host){this.status='已自动加载课表'+this.metadataState();this.render();}}).catch(error=>{if(token===this.token&&this.host){this.status=this.service.overview?'课表已加载，教师与教室信息可重试':(error as Error).message;this.render();}});}
  /** Read-only, single-account warmup. Never prepares or submits a course action. */
  warm(saved:SavedSchoolAccount):Promise<void>{
    if(this.warmTask)return this.warmTask;if(this.busy||this.service.overview||saved.system!=='course'||saved.locked)return Promise.resolve();
    const epoch=++this.warmEpoch;this.warmOwnsSession=false;this.busy=true;this.status='正在自动加载选课课表…';this.render();
    const task=(async()=>{try{const existing=await this.service.restoreActive();if(epoch!==this.warmEpoch)return;if(!existing){this.warmOwnsSession=true;await this.service.loginSaved(saved.id,saved.account);}if(epoch!==this.warmEpoch)return;
      const overview=this.service.overview!;this.warmedOwner=overview.identity.account;this.warmedFilters='';this.week=overview.currentWeek;this.slots=null;
      let weekWarning='';if(this.week!==null&&overview.allowedWeeks.includes(this.week))try{this.slots=await this.service.week(this.week,false);}catch(error){if(!this.service.overview)throw error;weekWarning=' · 本周场次可手动重试';}
      if(epoch!==this.warmEpoch)return;if(this.currentAccount!==overview.identity.account)throw Error('学校账号已变化，请重新登录');await this.loadWarmedFilters();if(epoch!==this.warmEpoch)return;this.status=(this.slots?'已自动加载课表与本周场次':'已自动加载课表')+weekWarning;if(this.host)void this.refreshAcademic();
    }catch(error){if(epoch===this.warmEpoch)this.status='自动加载未完成：'+(error as Error).message;}
    finally{if(epoch===this.warmEpoch){this.warmOwnsSession=false;this.warmTask=null;this.busy=false;this.render();this.hydrateWarmed();}}})();this.warmTask=task;return task;
  }
  async cancelWarm(){const task=this.warmTask;if(!task)return;const owned=this.warmOwnsSession;this.warmEpoch++;this.warmOwnsSession=false;this.warmedOwner='';this.warmedFilters='';try{if(owned)await this.service.clear();else this.service.invalidateReads();}catch(error){this.status='自动加载停止失败，请重试';this.render();throw error;}if(this.warmTask===task)this.warmTask=null;this.busy=false;this.render();}
  private visibleSlots() {
    return this.crossWeek ? this.searchSlots : this.slots;
  }
  private updateSearchResults(preserveExisting = false) {
    if (!this.crossWeek || !this.host || this.tab !== "available") return;
    const next = [...this.directorySlots.values()].filter((item) => {
      const overview = this.service.overview;
      if (!overview) return false;
      const date = resolveSlotDate(item, overview);
      return date && (courseStart({ ...item, date }) ?? 0) > Date.now();
    });
    const same = preserveExisting && next.length === this.searchSlots.length && next.every((item,i)=>item===this.searchSlots[i]);
    this.searchSlots = next;
    const results = this.host.querySelector("#portal-results");
    if (results && !same) results.innerHTML = this.slotCards();
    const status = this.host.querySelector("#portal-scan-status");
    if (status) status.textContent = this.directoryState.status;
    this.applyVisibility();
  }
  private async searchAcrossWeeks() {
    const retry = this.crossWeek;
    this.crossWeek = true;
    this.tab = "available";
    this.searchSlots = [...this.directorySlots.values()].filter((item) => {
      const overview = this.service.overview;
      if (!overview) return false;
      const date = resolveSlotDate(item, overview);
      return date && (courseStart({ ...item, date }) ?? 0) > Date.now();
    });
    this.render();
    await this.scanDirectory(() => {}, retry);
  }
  private slotCards() {
    const overview = this.service.overview!;
    return (
      this.visibleSlots()
        ?.map(
          (item, i) =>
            `<article class="portal-card" data-slot-index="${i}"><h3>${esc(item.name)}${badge(item.name)}</h3><p>第 ${item.week} 周 · ${esc(item.time)}</p><p>${esc(resolveSlotDate(item, overview) || "日期待核实")} · 余量 ${item.remaining} 人</p><p data-metadata-kind="slot" data-metadata-index="${i}">${this.metadataHTML(item)}</p><p class="muted" data-slot-reason>${esc(this.slotReason(item, overview))}</p><p class="ocr-warning" data-academic-slot-warning ${this.academicReady()&&academicConflict(this.academicValue,item,overview).status==="unknown"?"":"hidden"}>教务时间待核实</p><div class="portal-card-actions"><button class="button secondary compact" data-portal="slot-review" data-index="${i}">查看评价</button><button class="button compact" data-portal="add" data-index="${i}" ${this.slotReason(item, overview) || this.busy ? "disabled" : ""}>选课</button></div></article>`,
        )
        .join("") ||
      (this.crossWeek
        ? "<p>尚无已读取的未来场次，可调整搜索或重试查询。</p>"
        : "<p>官网本周没有可选场次。</p>")
    );
  }
  private guides = new CourseGuides(
    () => ({
      overview: this.service.overview,
      slots: [...this.directorySlots.values()],
      metadata: this.metadata,
      academic:this.academicValue,
      status: this.directoryState.status,
      running: !!this.directoryTask,
      busy: this.busy || this.committing,
    }),
    async () => {
      await this.scanDirectory(() => {}, true);
    },
    async (item, valid) => {
      await this.prepare("add", 0, item, valid);
      return this.confirmation.open;
    },
    (s) => this.notice(s),
  );
  private filterPanel = new CourseFilterPanel(
    () =>
      this.host ? (this.service.overview?.identity.account ?? null) : null,
    (update, force) => this.scanDirectory(update, force),
    (f) => {
      this.filters = f;
      this.render();
    },
    (s) => this.notice(s),
    () => this.academicReady(),
  );
  constructor(private notice: (s: string) => void) {
    this.review.className = "modal";
    this.review.id = "course-review";
    document.body.append(this.review);
    this.confirmation.className = "modal course-confirm";
    this.confirmation.id = "course-confirm";
    document.body.append(this.confirmation);
    this.confirmation.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.closeConfirmation();
    });
    this.confirmation.addEventListener("click", (e) => {
      const target = (e.target as Element).closest<HTMLButtonElement>(
        "[data-course-confirm]",
      );
      if (!target || target.disabled) return;
      if (target.dataset.courseConfirm === "cancel") this.closeConfirmation();
      else void this.submit();
    });
    this.confirmation.addEventListener("change", () =>
      this.updateConfirmation(),
    );
    this.review.addEventListener("click", (e) => {
      if ((e.target as Element).closest("[data-review-close]"))
        this.review.close();
    });
    window.addEventListener("focus", () => {
      if (this.host && !this.busy) {this.refreshTimes();void this.refreshAcademic();}
    });
  }
  get isOpen() {
    return (
      this.review.open ||
      this.confirmation.open ||
      this.filterPanel.isOpen ||
      this.guides.isOpen
    );
  }
  get isSaving() {
    return this.committing || this.filterPanel.isSaving;
  }
  closeReview() {
    if (this.guides.isOpen) {
      this.guides.close();
      return;
    }
    if (this.filterPanel.isOpen) {
      this.filterPanel.close();
      return;
    }
    if (this.confirmation.open) {
      this.closeConfirmation();
      return;
    }
    this.review.close();
  }
  leave() {
    this.accountPicker.leave();const password=this.host?.querySelector<HTMLInputElement>('#portal-password');if(password)password.value='';
    this.directoryEpoch++;
    this.directoryTask = null;
    this.directoryListeners.clear();
    this.filterPanel.close(true);
    this.guides.leave();
    this.token++;
    this.host = null;
    this.academicToken++;this.academicValue=null;
    clearTimeout(this.timer);
    this.review.close();
    this.closeConfirmation();
  }
  mount(host: HTMLElement) {
    this.leave();
    this.host = host;
    this.busy = !!this.warmTask;
    this.render();
    if(this.warmedOwner&&!this.warmTask&&this.warmedFilters!==this.warmedOwner){const token=this.token;this.busy=true;this.render();void this.loadWarmedFilters().finally(()=>{if(token===this.token&&!this.warmTask){this.busy=false;this.render();}});}if(this.warmedOwner&&!this.warmTask)this.hydrateWarmed();
    void this.refreshAcademic();
    host.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-portal]",
      );
      if (button && !button.disabled)
        void this.action(button.dataset.portal!, button.dataset.index).catch(
          (e) => {
            this.status = (e as Error).message;
            this.render();
          },
        );
    });
    host.addEventListener("change", (e) => {
      const input = e.target as HTMLSelectElement;
      if (input.id === "portal-week") {
        this.crossWeek = false;
        this.week = Number(input.value);
        void this.loadWeek(false);
      }
    });
    host.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id === "portal-search") {
        this.search = input.value;
        this.applyVisibility();
      }
    });
  }
  private render() {
    const host = this.host;
    if (!host) return;
    this.accountPicker.leave();
    const overview = this.service.overview;
    host.innerHTML = `<section class="panel"><div class="portal-title"><h2>学校实验选课</h2><button class="button secondary compact" data-portal="${overview ? "clear" : "login"}" ${this.busy ? "disabled" : ""}>${overview ? "清除登录状态" : "登录"}</button></div>${overview ? `<p>${esc(overview.identity.name)} · ${esc(overview.identity.account)}</p><div class="portal-stats"><span>本学期要求 <b>${overview.rules.requiredHours}</b> 学时</span><span>每周最多 <b>${overview.rules.weeklyHourLimit}</b> 学时</span><span>已选 <b>${overview.rules.selectedHours}</b> 学时</span></div><div class="ai-inline"><button class="button secondary compact" data-portal="refresh" ${this.busy ? "disabled" : ""}>刷新课表</button><button class="button secondary compact" data-portal="metadata" ${this.busy ? "disabled" : ""}>重试教师与教室</button><button class="button secondary compact" data-portal="selected">我的实验课表</button><button class="button secondary compact" data-portal="available">开始选课</button></div>` : `<p>请先连接并认证校园网，再登录学校物理实验系统读取课表。</p><label class="ai-field">学校账号<input id="portal-account" inputmode="numeric" autocomplete="off" maxlength="30"></label><label class="ai-field">密码<input id="portal-password" type="password" autocomplete="off" maxlength="200"></label><p class="muted">手动输入的密码仅用于本次登录。</p>`}<p role="status" id="portal-status">${esc(this.busy ? "正在按官网顺序读取，请稍候…" : this.status)}</p>${this.busy ? '<button class="text-button" data-portal="clear">停止并清除会话</button>' : ""}</section><div class="ai-inline portal-guide-nav"><a class="button secondary compact" href="#/school-reports">实验报告提交</a><button class="button secondary compact" data-portal="recommend">实验推荐</button><button class="button secondary compact" data-portal="teachers">老师推荐</button><a class="button secondary compact" href="#/help/school">常见问题</a></div>${overview || ["recommend", "teachers"].includes(this.tab) ? this.content() : ""}`;
    this.guides.bind(host);
    if(!overview&&!this.busy){const picker=document.createElement('div');picker.className='saved-account-tools';host.querySelector('#portal-status')!.before(picker);this.accountPicker.mount(picker);}
    this.refreshTimes();
    this.applyVisibility();
  }
  private applyVisibility() {
    const overview = this.service.overview;
    if (!this.host || !overview || this.tab !== "available") return;
    for(const summary of this.host.querySelectorAll<HTMLElement>('[data-academic-summary]')){summary.textContent=this.academicLabel();summary.classList.toggle('resource-ok',this.academicReady());summary.classList.toggle('ocr-warning',!this.academicReady());}
    const academicReady=this.academicReady(),activeFilters=academicReady?this.filters:{...this.filters,hideAcademic:false},now=Date.now();
    let count = 0;
    for (const card of this.host.querySelectorAll<HTMLElement>(
      "[data-slot-index]",
    )) {
      const item = this.visibleSlots()?.[Number(card.dataset.slotIndex)];
      if (!item) continue;
      const teachers = matchTeachers(
        this.metadata.get(metadataKey(item.name)),
        item,
      );
      const academicState=academicConflict(this.academicValue,item,overview,now).status;
      card.hidden =
        !item.name.toLowerCase().includes(this.search.trim().toLowerCase()) ||
        !matchesCourseFilters(item, overview, teachers, activeFilters, academicState==='clear'?false:academicState==='conflict'?true:null);
      if (!card.hidden) count++;
    }
    const label = this.host.querySelector("#portal-filter-count");
    if (label)
      label.textContent = `显示 ${count} / ${this.visibleSlots()?.length ?? 0} 场`;
  }
  private directoryCandidates(overview: Overview) {
    const labs = new Map<string, Map<string, Set<string>>>();
    let teachersUnknown = false, datesUnknown = false;
    for (const item of [...this.directorySlots.values(), ...overview.enrolled]) {
      if (!overview.allowedWeeks.includes(item.week)) continue;
      const date = ("date" in item ? item.date : "") || resolveSlotDate(item, overview),
        start = date ? courseStart({ ...item, date }) : null;
      if (start === null) { datesUnknown = true; continue; }
      if (start <= Date.now()) continue;
      const names = matchTeachers(this.metadata.get(metadataKey(item.name)), item);
      if (!names.length) teachersUnknown = true;
      const teachers = labs.get(item.name) ?? new Map<string, Set<string>>();
      const time = /星期([一二三四五六日天])(下午|晚上|上午)/.exec(item.time);
      const short = time ? "周" + time[1] + time[2] : "时间待核实";
      for (const name of names.length ? names : ["待核实"]) {
        const times = teachers.get(name) ?? new Set<string>();
        times.add(short);
        teachers.set(name, times);
      }
      labs.set(item.name, teachers);
    }
    return { experiments: [...labs].map(([name, teachers]) => ({
      name, teachers: [...teachers].map(([name, times]) => ({name, times: [...times]})),
    })), teachersUnknown, datesUnknown };
  }
  private async scanDirectory(
    update: (directory: FilterDirectory) => void,
    force = false,
  ) {
    if (this.directoryTask) {
      this.directoryListeners.add(update);
      update(this.directoryState);
      return this.directoryTask;
    }
    this.directoryListeners.clear();
    this.directoryListeners.add(update);
    const overview = this.service.overview;
    if (!overview || !this.host) return;
    const age = Date.now() - this.directoryReadAt;
    if (
      !force &&
      overview === this.directoryOverview &&
      age >= 0 &&
      age < 60000
    ) {
      update(this.directoryState);
      this.updateSearchResults();
      this.guides.update();
      return;
    }
    const epoch = this.directoryEpoch;
    const valid = () =>
      this.host &&
      this.service.overview === overview &&
      this.directoryEpoch === epoch;
    const weeks = overview.allowedWeeks
      .filter((w) => overview.currentWeek !== null && w >= overview.currentWeek)
      .sort((a, b) => a - b);
    let completed = 0,
      unknown = 0;
    const emit = (done = false) => {
      if (!valid()) return;
      const { experiments, teachersUnknown, datesUnknown } = this.directoryCandidates(overview);
      this.directoryState = {
        experiments,
        status: `${overview.currentWeek === null ? "当前周次待核实 · " : ""}已读取 ${completed}/${weeks.length} 周${done ? "" : " · 获取中"}${this.directoryFailed.size ? " · 未完整获取（第 " + [...this.directoryFailed].join("、") + " 周）" : ""}${teachersUnknown ? " · 教师待核实" : ""}${unknown || datesUnknown ? " · 有场次日期待核实" : ""}`,
      };
      for (const listener of this.directoryListeners)
        listener(this.directoryState);
      this.updateSearchResults();
      this.guides.update();
    };
    for (const item of this.slots ?? [])
      this.directorySlots.set(
        JSON.stringify([item.name, item.week, item.time]),
        item,
      );
    emit();
    if (!weeks.length) {
      emit(true);
      return;
    }
    let task!: Promise<void>;
    task = (async () => {
      try {
        for (const week of weeks) {
          if (!valid()) return;
          try {
            const items = await this.service.week(
              week,
              force || this.directoryFailed.has(week),
            );
            if (!valid()) return;
            this.directoryFailed.delete(week);
            for (const [key, item] of this.directorySlots)
              if (item.week === week) this.directorySlots.delete(key);
            completed++;
            for (const item of items) {
              const date = resolveSlotDate(item, overview);
              if (!date) unknown++;
              else if ((courseStart({ ...item, date }) ?? 0) <= Date.now())
                continue;
              this.directorySlots.set(
                JSON.stringify([item.name, item.week, item.time]),
                item,
              );
            }
            emit();
            for (const name of [...new Set(items.map((i) => i.name))]) {
              if (!valid()) return;
              const old = this.metadata.get(metadataKey(name));
              if (!old || old.warnings.length) {
                const details = await this.service.details(name, !!old);
                if (!valid()) return;
                this.metadata.set(metadataKey(name), details);
                this.updateMetadata();
                emit();
              }
            }
          } catch {
            if (!valid()) {
              if (
                this.host &&
                epoch === this.directoryEpoch &&
                !this.service.overview
              ) {
                this.metadata.clear();
                this.directorySlots.clear();
                this.directoryState = { experiments: [], status: "登录已失效" };
                this.status = "学校登录已失效，请重新登录";
                this.render();
              }
              return;
            }
            this.directoryFailed.add(week);
            emit();
          }
        }
        if (valid()) {
          this.directoryReadAt = Date.now();
          this.directoryOverview = overview;
        }
        emit(true);
      } finally {
        if (this.directoryTask === task) {
          this.directoryTask = null;
          this.refreshTimes();
        }
      }
    })();
    this.directoryTask = task;
    return task;
  }
  private refreshTimes() {
    clearTimeout(this.timer);
    const overview = this.service.overview;
    if (!this.host || !overview) return;
    const next = nearestFuture(overview.enrolled),
      now = Date.now();
    for (const summary of this.host.querySelectorAll<HTMLElement>('[data-academic-summary]')) {
      summary.textContent = this.academicLabel();
      summary.classList.toggle('resource-ok', this.academicReady());
      summary.classList.toggle('ocr-warning', !this.academicReady());
    }
    for (const card of this.host.querySelectorAll<HTMLElement>(
      "[data-course-index]",
    )) {
      const i = Number(card.dataset.courseIndex),
        item = overview.enrolled[i];
      if (!item) continue;
      card.classList.toggle("portal-next", i === next);
      const heading = card.querySelector(".eyebrow");
      if (heading)
        heading.textContent = i === next ? "下一场实验" : `第 ${item.week} 周`;
      const reason = card.querySelector("[data-course-reason]");
      if (reason) reason.textContent = cancelReason(item) || "可取消";
      const button = card.querySelector<HTMLButtonElement>(
        '[data-portal="cancel"]',
      );
      if (button)
        button.disabled = !!cancelReason(item) || this.busy || this.committing;
    }
    if (this.tab === "available") {
      this.updateSearchResults(true);
      for (const card of this.host.querySelectorAll<HTMLElement>(
        "[data-slot-index]",
      )) {
        const item = this.visibleSlots()?.[Number(card.dataset.slotIndex)];
        if (!item) continue;
        const reason = this.slotReason(item, overview, now);
        const label = card.querySelector("[data-slot-reason]");
        if (label) label.textContent = reason;
        const warning = card.querySelector<HTMLElement>("[data-academic-slot-warning]");
        if (warning) warning.hidden = !(this.academicReady() && academicConflict(this.academicValue,item,overview,now).status === "unknown");
        const button = card.querySelector<HTMLButtonElement>(
          '[data-portal="add"]',
        );
        if (button) button.disabled = !!reason || this.busy || this.committing;
      }
      this.applyVisibility();
    }
    this.guides.update();
    if (this.directoryListeners.size || this.directoryOverview === overview) {
      this.directoryState = { ...this.directoryState, experiments: this.directoryCandidates(overview).experiments };
      for (const listener of this.directoryListeners) listener(this.directoryState);
    }
    const boundaries = overview.enrolled
      .flatMap((item) => {
        const start = courseStart(item);
        return start === null ? [] : [start, start - 72 * 3600000];
      })
      .filter((t) => t > now);
    for (const item of [
      ...(this.slots ?? []),
      ...this.directorySlots.values(),
    ]) {
      const date = resolveSlotDate(item, overview),
        start = date ? courseStart({ ...item, date }) : null;
      if (start !== null && start > now) boundaries.push(start);
    }
    if(this.academicReady()&&this.academicValue?.snapshot)boundaries.push(Date.parse(this.academicValue.snapshot.fetchedAt)+24*3600000);
    if (boundaries.length)
      this.timer = setTimeout(
        () => this.refreshTimes(),
        Math.min(2147483000, Math.max(50, Math.min(...boundaries) - now + 5)),
      );
  }
  private content() {
    const overview = this.service.overview!;
    if (this.tab === "recommend" || this.tab === "teachers")
      return this.guides.html(this.tab);
    if (this.tab === "selected") {
      const next = nearestFuture(overview.enrolled);
      return `<section class="panel"><h2>${overview.enrolled.length} 项已选实验</h2><p class="${this.academicReady()?'resource-ok':'ocr-warning'}" data-academic-summary>${esc(this.academicLabel())}</p>${overview.enrolled.map((item, i) => `<article data-course-index="${i}" class="portal-card ${i === next ? "portal-next" : ""}"><p class="eyebrow">${i === next ? "下一场实验" : "第 " + item.week + " 周"}</p><h3>${esc(item.name)}${badge(item.name)}</h3><p>${esc(item.date || "日期待核实")} · ${esc(item.time)}</p><p data-metadata-kind="selected" data-metadata-index="${i}">${this.metadataHTML(item)}</p><div class="portal-card-actions"><button class="button secondary compact" data-portal="review" data-index="${i}">查看评价</button><span data-course-reason class="muted">${esc(cancelReason(item) || "可取消")}</span><button class="button secondary compact" data-portal="cancel" data-index="${i}" ${cancelReason(item) || this.busy ? "disabled" : ""}>取消选课</button></div></article>`).join("") || "<p>官网当前没有已选实验。</p>"}</section>`;
    }
    const week = this.week ?? overview.currentWeek;
    return `<section class="panel"><div class="portal-title"><h2>开始选课</h2><select id="portal-week" aria-label="查询周次" ${this.busy ? "disabled" : ""}>${overview.allowedWeeks.map((n) => `<option value="${n}" ${n === week ? "selected" : ""}>第 ${n} 周${n === overview.currentWeek ? " · 本周" : ""}</option>`).join("")}</select></div><p class="${this.academicReady()?'resource-ok':'ocr-warning'}" data-academic-summary>${esc(this.academicLabel())}</p><div class="portal-filter-tools"><input id="portal-search" type="search" value="${esc(this.search)}" placeholder="搜索实验" aria-label="搜索实验"><button class="button secondary compact" data-portal="filters" ${this.busy ? "disabled" : ""}>实验筛选${filterCount(this.filters) ? " · " + filterCount(this.filters) : ""}</button><button class="button secondary compact" data-portal="cross-week" ${this.busy ? "disabled" : ""}>${this.crossWeek ? "重试跨周查询" : "搜索全部未来周次"}</button><span id="portal-filter-count" class="muted"></span></div><p id="portal-scan-status" role="status">${this.crossWeek ? esc(this.directoryState.status) : ""}</p><div id="portal-results">${!this.crossWeek && this.slots === null ? "<p>场次尚未读取，可重试查询。</p>" : this.slotCards()}</div><button class="button secondary" data-portal="week" ${this.busy ? "disabled" : ""}>${this.crossWeek ? "返回单周查询" : "重新查询本周"}</button></section>`;
  }
  private showReview(item: { name: string; week: number; time: string }) {
    const name = item.name,
      review = experimentReview(name),
      teachers = matchTeachers(this.metadata.get(metadataKey(name)), item);
    this.review.innerHTML = `<div class="modal-heading"><h2>${esc(name)}</h2><button class="icon-button" data-review-close aria-label="关闭评价">×</button></div><div class="modal-body course-review-body"><h3>实验评价</h3><p>${esc(review?.review || "暂无评价")}</p><h3>教师评价</h3>${
      teachers.length
        ? teachers
            .map((name) => {
              const entry = teacherReviews(name, item.name);
              return `<section><strong>${esc(name)}</strong><p>${esc(
                entry?.groups
                  .map((group) => group.review)
                  .filter(Boolean)
                  .join("\n\n") || "暂无评价",
              )}</p></section>`;
            })
            .join("")
        : "<p>教师待核实，暂无可明确关联的评价。</p>"
    }</div><div class="modal-actions"><button class="button" data-review-close>关闭</button></div>`;
    this.review.showModal();
  }
  private closeConfirmation() {
    if (this.committing) {
      this.notice("正在提交并核对官网课表，请稍候");
      return;
    }
    const ticket = this.prepared?.ticket;
    this.prepared = null;
    clearTimeout(this.expiryTimer);
    this.confirmation.close();
    if (ticket) void this.service.discard(ticket).catch(() => {});
  }
  private updateConfirmation() {
    const expired = performance.now() >= this.expiresAt;
    const checkbox = this.confirmation.querySelector<HTMLInputElement>(
      "#course-academic-ack",
    );
    const submit = this.confirmation.querySelector<HTMLButtonElement>(
      '[data-course-confirm="continue"]',
    );
    if (submit)
      submit.disabled =
        this.committing || expired || (!!checkbox && !checkbox.checked);
    const cancel = this.confirmation.querySelector<HTMLButtonElement>(
      '[data-course-confirm="cancel"]',
    );
    if (cancel) cancel.disabled = this.committing;
    if (checkbox) checkbox.disabled = this.committing;
    const status = this.confirmation.querySelector("[data-confirm-status]");
    if (status)
      status.textContent = this.committing
        ? "正在提交并回读官网，请勿重复操作…"
        : expired
          ? "确认已过期，请取消后重新选择。"
          : "确认有效期为两分钟，提交前会再次核对官网。";
  }
  private async prepare(
    action: "add" | "cancel",
    index: number,
    chosen?: Slot,
    valid: () => boolean = () => true,
  ) {
    const item =
      chosen ??
      (action === "add"
        ? this.visibleSlots()?.[index]
        : this.service.overview?.enrolled[index]);
    if (!item || this.busy || this.committing) return;
    const token = ++this.token;
    this.busy = true;
    this.render();
    try {
      const names = matchTeachers(
        this.metadata.get(metadataKey(item.name)),
        item,
      );
      const result = await this.service.prepare(action, item, names);
      if (token !== this.token || !this.host || !valid()) {
        void this.service.discard(result.ticket).catch(() => {});
        return;
      }
      this.prepared = result;
      this.expiresAt = performance.now() + result.expiresIn * 1000;
      this.confirmation.innerHTML = `<div class="modal-heading"><h2>${action === "add" ? "确认选课" : "确认取消选课"}</h2></div><div class="modal-body"><h3>${esc(result.item.name)}</h3><p>${esc(result.item.date || "日期待核实")} · 第 ${result.item.week} 周</p><p>${esc(result.item.time)}</p><p>教师：${esc(result.expectedTeachers.join("、") || "待核实")}</p>${action === "add" && result.academicChecked ? '<p class="resource-ok">已按同步教务课表核对时间</p>' : action === "add" ? '<label class="course-ack"><input id="course-academic-ack" type="checkbox"><span>教务课表冲突尚未校验，我已自行核对该实验时间。</span></label>' : ""}<p role="status" class="muted" data-confirm-status></p></div><div class="modal-actions"><button class="button secondary" data-course-confirm="cancel">取消</button><button class="button" data-course-confirm="continue">${action === "add" ? "确认选课" : "确认取消选课"}</button></div>`;
      this.updateConfirmation();
      this.confirmation.showModal();
      clearTimeout(this.expiryTimer);
      this.expiryTimer = setTimeout(
        () => this.updateConfirmation(),
        result.expiresIn * 1000 + 10,
      );
    } catch (e) {
      if (token === this.token) this.status = (e as Error).message;
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.render();
      }
    }
  }
  private async submit() {
    const prepared = this.prepared;
    if (!prepared || this.committing || performance.now() >= this.expiresAt) {
      this.updateConfirmation();
      return;
    }
    const acknowledged =
      this.confirmation.querySelector<HTMLInputElement>("#course-academic-ack")
        ?.checked ?? false;
    if (prepared.action === "add" && !prepared.academicChecked && !acknowledged) return;
    this.committing = true;
    this.busy = true;
    this.updateConfirmation();
    this.render();
    let message = "";
    try {
      const result = await this.service.commit(prepared.ticket, acknowledged);
      message = result.message + " · 已回读官网课表核对";
      this.metadata.clear();
      this.slots = null;
      this.crossWeek = false;
      this.directoryEpoch++;
      this.directoryTask = null;
      this.directoryListeners.clear();
      this.directorySlots.clear();
      this.directoryReadAt = 0;
      this.directoryOverview = null;
      this.directoryState = { experiments: [], status: "尚未查询" };
      this.tab = "selected";
    } catch (e) {
      message = (e as Error).message;
      // Read only after failure; never automatically prepare or replay a consumed ticket.
      try {
        await this.service.refresh();
        await this.refreshAcademic();
        this.metadata.clear();
        this.slots = null;
        this.directoryEpoch++;
        this.directoryTask = null;
        this.directoryListeners.clear();
        this.directorySlots.clear();
        this.directoryReadAt = 0;
        this.directoryOverview = null;
        this.directoryState = { experiments: [], status: "尚未查询" };
        message += " · 已刷新官网课表";
      } catch {
        message += " · 官网课表未能刷新，请手动核对结果";
      }
    } finally {
      this.prepared = null;
      this.committing = false;
      this.busy = false;
      clearTimeout(this.expiryTimer);
      this.confirmation.close();
      this.status = message;
      this.render();
    }
  }
  private metadataHTML(item: {
    name: string;
    week: number;
    time: string;
    room?: string;
  }) {
    const details = this.metadata.get(metadataKey(item.name)),
      teachers = matchTeachers(details, item);
    const names = teachers.length
      ? teachers
          .map((name) => {
            const category = teacherReviews(name, item.name)?.category;
            return (
              esc(name) +
              (category === "recommended"
                ? '<span class="course-badge">推荐</span>'
                : category === "not_recommended"
                  ? '<span class="course-badge negative">不推荐</span>'
                  : "")
            );
          })
          .join("、")
      : "待核实";
    const rooms = item.room
      ? esc(item.room)
      : details?.rooms.length
        ? esc(details.rooms.join("、"))
        : "待核实";
    return `教师：${names}<br>${item.room ? "教室" : "实验用房"}：${rooms}${details?.warnings.length ? '<br><span class="ocr-warning">部分信息未完整获取，可重试</span>' : ""}`;
  }
  private updateMetadata() {
    if (!this.host) return;
    for (const node of this.host.querySelectorAll<HTMLElement>(
      "[data-metadata-kind]",
    )) {
      const index = Number(node.dataset.metadataIndex),
        item =
          node.dataset.metadataKind === "selected"
            ? this.service.overview?.enrolled[index]
            : this.visibleSlots()?.[index];
      if (item) node.innerHTML = this.metadataHTML(item);
    }
    this.applyVisibility();
  }
  private async hydrate(token: number, force = false) {
    const names = [
      ...new Set(
        [...(this.slots ?? []), ...(this.service.overview?.enrolled ?? [])].map(
          (item) => item.name,
        ),
      ),
    ];
    for (const [i, name] of names.entries()) {
      if (token !== this.token || !this.host) return;
      const label = this.host.querySelector("#portal-status");
      if (label)
        label.textContent = `正在核对教师与教室 ${i + 1}/${names.length}`;
      const result = await this.service.details(name, force);
      if (token !== this.token || !this.host) return;
      this.metadata.set(metadataKey(name), result);
      this.updateMetadata();
    }
  }
  private metadataState() {
    return [...this.metadata.values()].some((d) => d.warnings.length)
      ? " · 部分教师/教室未完整获取，可重试"
      : "";
  }
  private async loadWeek(force: boolean) {
    const overview = this.service.overview;
    if (!overview || !this.host || this.busy) return;
    if (this.week === null || !overview.allowedWeeks.includes(this.week))
      this.week = overview.allowedWeeks.includes(overview.currentWeek ?? -1)
        ? overview.currentWeek
        : (overview.allowedWeeks[0] ?? null);
    if (this.week === null) {
      this.status = "官网没有提供可查询周次";
      this.render();
      return;
    }
    const token = ++this.token;
    this.busy = true;
    this.slots = null;
    this.render();
    try {
      const rows = await this.service.week(this.week, force);
      if (token !== this.token || !this.host) return;
      this.slots = rows;
      this.render();
      await this.hydrate(token, force);
      if (token !== this.token) return;
      this.status = "已读取官网场次 · "+this.academicLabel() + this.metadataState();
    } catch (e) {
      if (token === this.token) this.status = (e as Error).message;
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.render();
      }
    }
  }
  private async action(action: string, index?: string,saved?:SavedSchoolAccount) {
    if (action === "filters" && !this.isSaving) {
      this.filterPanel.open();
      return;
    }
    if (this.isSaving) {
      this.notice("正在提交并核对官网课表，请稍候");
      return;
    }
    if (action === "add" || action === "cancel") {
      await this.prepare(action, Number(index));
      return;
    }
    if (action === "review") {
      const item = this.service.overview?.enrolled[Number(index)];
      if (item) this.showReview(item);
      return;
    }
    if (action === "slot-review") {
      const item = this.visibleSlots()?.[Number(index)];
      if (item) this.showReview(item);
      return;
    }
    if (action === "clear") {
      this.warmEpoch++;this.warmOwnsSession=false;this.warmTask=null;this.warmedOwner='';this.warmedFilters='';
      this.token++;
      this.busy = false;
      this.slots = null;
      this.week = null;
      this.metadata.clear();
      this.crossWeek = false;
      this.searchSlots = [];
      this.directoryEpoch++;
      this.directoryTask = null;
      this.directoryListeners.clear();
      this.directorySlots.clear();
      this.directoryReadAt = 0;
      this.directoryOverview = null;
      this.directoryState = { experiments: [], status: "尚未查询" };
      this.directoryFailed.clear();
      this.filters = defaultCourseFilters();
      this.search = "";
      this.filterPanel.close(true);
      this.guides.close();
      await this.service.clear();
      this.status = "登录会话与余量缓存已清除，本次运行不会自动重连";
      this.render();
      return;
    }
    if (this.busy) return;
    if (action === "recommend" || action === "teachers") {
      this.tab = action;
      this.render();
      if (this.service.overview) await this.scanDirectory(() => {});
      return;
    }
    if (action === "selected") {
      this.tab = "selected";
      this.render();
      return;
    }
    if (action === "available") {
      this.tab = "available";
      await this.loadWeek(false);
      return;
    }
    if (action === "metadata") {
      const token = ++this.token;
      this.busy = true;
      this.render();
      try {
        await this.hydrate(token, true);
        if (token === this.token)
          this.status = "已重新核对教师与教室" + this.metadataState();
      } catch (e) {
        if (token === this.token) this.status = (e as Error).message;
      } finally {
        if (token === this.token) {
          this.busy = false;
          this.render();
        }
      }
      return;
    }
    if (action === "cross-week") {
      await this.searchAcrossWeeks();
      return;
    }
    if (action === "week") {
      this.crossWeek = false;
      await this.loadWeek(true);
      return;
    }
    if (action === "login" || action === "login-saved" || action === "refresh") {
      if(action==='login-saved'&&(!saved||saved.system!=='course'||saved.locked))throw Error('请选择可用的选课账号');
      this.guides.close();
      const account = saved?.account??
          this.host
            ?.querySelector<HTMLInputElement>("#portal-account")
            ?.value.trim() ?? "",
        password = saved?'':
          this.host?.querySelector<HTMLInputElement>("#portal-password")
            ?.value ?? "";
      if (action === "login" && (!account || !password))
        throw Error("请填写学校账号和密码");
      const token = ++this.token;
      this.busy = true;
      this.status = "";
      this.render();
      try {
        if (action === "login") await this.service.login(account, password);
        else if(action==='login-saved')await this.service.loginSaved(saved!.id,account);
        else await this.service.refresh();
        if (token !== this.token) return;
        this.metadata.clear();
        this.slots = null;
        this.week = this.service.overview?.currentWeek ?? null;
        this.crossWeek = false;
        this.searchSlots = [];
        this.directoryEpoch++;
        this.directoryTask = null;
        this.directoryListeners.clear();
        this.directorySlots.clear();
        this.directoryReadAt = 0;
        this.directoryOverview = null;
        this.directoryState = { experiments: [], status: "尚未查询" };
        this.directoryFailed.clear();
        this.directoryTask = null;
        this.search = "";
        try {
          await this.filterPanel.load(this.service.overview!.identity.account);
        } catch (e) {
          this.notice((e as Error).message);
        }
        if (token !== this.token) return;
        let weekWarning = "";
        if (
          this.week !== null &&
          this.service.overview?.allowedWeeks.includes(this.week)
        ) {
          try {
            this.slots = await this.service.week(this.week, true);
          } catch (e) {
            if (token !== this.token) return;
            weekWarning =
              " · 当前周场次读取失败，可重试：" + (e as Error).message;
          }
        } else weekWarning = " · 官网当前周场次未提供";
        if (token !== this.token) return;
        this.render();
        await this.hydrate(token, false);
        if (token !== this.token) return;
        this.status =
          "已连接学校实验系统 · "+this.academicLabel() +
          weekWarning +
          this.metadataState();
        this.tab = "selected";
      } catch (e) {
        if (token === this.token) this.status = (e as Error).message;
      } finally {
        if (token === this.token) {
          this.busy = false;
          this.render();
        }
      }
    }
  }
}
