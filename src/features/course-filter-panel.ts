import {
  defaultCourseFilters,
  checkCourseFilters,
  type CourseFilters,
} from "../domain/course-filters.ts";
import { FilterPreferences } from "../domain/filter-preferences.ts";
import { privateStore } from "../platform/storage.ts";
import { experimentReview, teacherReviews } from "../domain/reviews.ts";
export interface FilterCandidate {
  name: string;
  teachers: { name: string; times: string[] }[];
}
export interface FilterDirectory {
  experiments: FilterCandidate[];
  status: string;
}
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const mark = (category?: string) =>
  category === "recommended"
    ? '<span class="course-badge">推荐</span>'
    : category === "not_recommended"
      ? '<span class="course-badge negative">不推荐</span>'
      : "";
export class CourseFilterPanel {
  private preferences = new FilterPreferences(privateStore);
  private dialog = document.createElement("dialog");
  private draft = defaultCourseFilters();
  private account = "";
  private revision = 0;
  private applied = defaultCourseFilters();
  private picker: "experiments" | "teachers" | null = null;
  private chosen = new Set<string>();
  private reset = false;
  private saving = false;
  private directory: FilterDirectory = {
    experiments: [],
    status: "尚未获取目录",
  };
  constructor(
    private context: () => string | null,
    private scan: (
      update: (d: FilterDirectory) => void,
      force?: boolean,
    ) => Promise<void>,
    private apply: (f: CourseFilters) => void,
    private notice: (s: string) => void,
    private academicReady:()=>boolean=()=>false,
  ) {
    this.dialog.id = "course-filters";
    this.dialog.className = "modal course-filter-panel";
    document.body.append(this.dialog);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-filter-action]",
      );
      if (button && !button.disabled)
        void this.action(button.dataset.filterAction!).catch((e) =>
          this.notice(e.message),
        );
    });
    this.dialog.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.filter) {
        (this.draft as unknown as Record<string, unknown>)[
          input.dataset.filter
        ] = input.checked;
        if (
          input.checked &&
          (input.dataset.filter === "experimentsEnabled" ||
            input.dataset.filter === "teachersEnabled")
        )
          this.openPicker(
            input.dataset.filter === "experimentsEnabled"
              ? "experiments"
              : "teachers",
          );
      } else if (input.dataset.candidate) {
        input.checked
          ? this.chosen.add(input.dataset.candidate)
          : this.chosen.delete(input.dataset.candidate);
        this.selectionCount();
      }
    });
    this.dialog.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).id === "filter-search") this.renderCards();
    });
    this.dialog.addEventListener("focusout", () =>
      setTimeout(() => {
        if (
          this.picker &&
          !this.dialog
            .querySelector("#filter-cards")
            ?.contains(document.activeElement)
        )
          this.renderCards();
      }, 0),
    );
  }
  get isOpen() {
    return this.dialog.open;
  }
  get isSaving() {
    return this.saving;
  }
  async load(account: string) {
    this.close(true);
    const revision = ++this.revision;
    this.account = account;
    this.applied = defaultCourseFilters();
    this.apply(structuredClone(this.applied));
    this.directory = { experiments: [], status: "尚未获取目录" };
    const value = await this.preferences.load(account);
    if (revision !== this.revision || this.context() !== account) return;
    this.applied = value;
    this.apply(structuredClone(value));
  }
  open() {
    const account = this.context();
    if (!account || this.saving) return;
    this.account = account;
    this.draft = structuredClone(this.applied);
    this.picker = null;
    this.reset = false;
    this.render();
    this.dialog.showModal();
  }
  close(all = false) {
    if (all) this.revision++;
    if (this.saving) return;
    if (this.picker && !all) {
      this.picker = null;
      this.render();
      return;
    }
    this.dialog.close();
    this.picker = null;
  }
  private render() {
    if (this.picker) return;
    const row = (key: keyof CourseFilters, label: string, disabled = false) =>
      `<label class="filter-row"><input type="checkbox" data-filter="${key}" ${this.draft[key] ? "checked" : ""} ${disabled ? "disabled" : ""}><span>${label}</span></label>`;
    this.dialog.innerHTML = `<div class="modal-heading"><h2>实验筛选</h2><button class="icon-button" data-filter-action="cancel" aria-label="关闭筛选">×</button></div><div class="modal-body">${row("hideSelected", "隐藏已选和冲突实验")}${row("hideAcademic", this.academicReady()?"隐藏教务课表冲突":"隐藏教务课表冲突（请先同步教务）", !this.academicReady())}${row("recommendedExperiments", "只看推荐实验")}${row("recommendedTeachers", "只看推荐老师")}${row("experimentsEnabled", "指定实验")}<button class="text-button" data-filter-action="experiments">选择实验 · ${this.draft.experiments.length} 项</button>${row("teachersEnabled", "指定老师")}<button class="text-button" data-filter-action="teachers">选择老师 · ${this.draft.teachers.length} 位</button></div><div class="modal-actions"><button class="text-button" data-filter-action="reset">恢复默认</button><button class="button secondary" data-filter-action="cancel">取消</button><button class="button" data-filter-action="apply">应用</button></div>`;
  }
  private openPicker(kind: "experiments" | "teachers") {
    const account = this.account, revision = this.revision;
    this.picker = kind;
    this.chosen = new Set(this.draft[kind]);
    this.dialog.innerHTML = `<div class="modal-heading"><h2>${kind === "experiments" ? "选择实验" : "选择老师"}</h2></div><div class="modal-body"><input id="filter-search" type="search" placeholder="${kind === "experiments" ? "搜索实验" : "搜索老师"}" aria-label="搜索候选项目"><div class="ai-inline"><button class="text-button" data-filter-action="all">全选搜索结果</button><button class="text-button" data-filter-action="clear">清空</button><button class="text-button" data-filter-action="retry">重试目录</button></div><p id="filter-directory-status" role="status"></p><div id="filter-cards" class="filter-candidates"></div></div><div class="modal-actions"><span id="filter-count"></span><button class="button secondary" data-filter-action="cancel">取消</button><button class="button" data-filter-action="confirm">确认</button></div>`;
    this.renderCards();
    void this.scan((d) => {
      if (revision !== this.revision || this.context() !== account) return;
      this.directory = d;
      const status = this.dialog.querySelector("#filter-directory-status");
      if (status) status.textContent = d.status;
      this.renderCards();
    }).catch((e) => { if (revision === this.revision && this.context() === account) this.notice(e.message); });
  }
  private candidates() {
    if (this.picker === "experiments")
      return this.directory.experiments.map((e) => ({
        name: e.name,
        html: `<strong>实验名称：${esc(e.name)}${mark(experimentReview(e.name)?.category)}</strong>${e.teachers.map((t) => `<p>实验老师：${esc(t.name)}${mark(teacherReviews(t.name, e.name)?.category)}<br>实验时间：${esc(t.times.join("／"))}</p>`).join("")}`,
      }));
    const teachers = new Map<string, Map<string, Set<string>>>();
    for (const e of this.directory.experiments)
      for (const t of e.teachers) {
        if (t.name === "待核实") continue;
        const labs = teachers.get(t.name) ?? new Map<string, Set<string>>();
        const times = labs.get(e.name) ?? new Set<string>();
        t.times.forEach((s) => times.add(s));
        labs.set(e.name, times);
        teachers.set(t.name, labs);
      }
    return [...teachers].map(([name, labs]) => ({
      name,
      html: `<strong>实验老师：${esc(name)}${mark(teacherReviews(name, [...labs.keys()][0])?.category)}</strong>${[...labs].map(([lab, times]) => `<p>实验：${esc(lab)}${mark(experimentReview(lab)?.category)}<br>对应时间：${esc([...times].join("／"))}</p>`).join("")}`,
    }));
  }
  private visible() {
    const query = (
      this.dialog.querySelector<HTMLInputElement>("#filter-search")?.value ?? ""
    )
      .trim()
      .toLowerCase();
    const cards = this.candidates();
    for (const name of this.chosen)
      if (!cards.some((c) => c.name === name))
        cards.push({
          name,
          html: `<strong>${esc(name)}</strong><p>当前不在已读取的候选列表中</p>`,
        });
    return cards.filter((c) => c.name.toLowerCase().includes(query));
  }
  private selectionCount() {
    const el = this.dialog.querySelector("#filter-count");
    if (el) el.textContent = `已选 ${this.chosen.size} 项`;
  }
  private renderCards() {
    if (!this.picker) return;
    const el = this.dialog.querySelector("#filter-cards");
    if (!el) return;
    const body = el.closest(".modal-body")!;
    const scroll = body.scrollTop;
    const active = document.activeElement;
    const focusedCandidate = active instanceof HTMLInputElement && el.contains(active)
      ? active.dataset.candidate : undefined;
    el.innerHTML =
      this.visible()
        .map(
          (c) =>
            `<label class="filter-candidate"><input type="checkbox" data-candidate="${esc(c.name)}" ${this.chosen.has(c.name) ? "checked" : ""}><div>${c.html}</div></label>`,
        )
        .join("") || "<p>当前搜索没有结果</p>";
    body.scrollTop = scroll;
    if (focusedCandidate !== undefined) {
      const replacement = [...el.querySelectorAll<HTMLInputElement>('[data-candidate]')]
        .find(input => input.dataset.candidate === focusedCandidate);
      (replacement ?? this.dialog.querySelector<HTMLInputElement>('#filter-search'))?.focus({preventScroll: true});
    }
    this.selectionCount();
    const status = this.dialog.querySelector("#filter-directory-status");
    if (status) status.textContent = this.directory.status;
  }
  private async action(action: string) {
    if (this.saving) return;
    if (action === "cancel") {
      this.close();
      return;
    }
    if (action === "reset") {
      this.draft = defaultCourseFilters();
      this.reset = true;
      this.render();
      return;
    }
    if (action === "experiments" || action === "teachers") {
      this.openPicker(action);
      return;
    }
    if (action === "retry") {
      const account = this.account, revision = this.revision;
      void this.scan((d) => {
        if (revision === this.revision && this.context() === account) {
          this.directory = d;
          this.renderCards();
        }
      }, true).catch((e) => { if (revision === this.revision && this.context() === account) this.notice(e.message); });
      return;
    }
    if (action === "all") {
      this.visible().forEach((c) => this.chosen.add(c.name));
      this.renderCards();
      return;
    }
    if (action === "clear") {
      this.chosen.clear();
      this.renderCards();
      return;
    }
    if (action === "confirm" && this.picker) {
      this.draft[this.picker] = [...this.chosen];
      this.draft[
        this.picker === "experiments" ? "experimentsEnabled" : "teachersEnabled"
      ] = true;
      this.picker = null;
      this.render();
      return;
    }
    if (action !== "apply") return;
    checkCourseFilters(this.draft,this.academicReady());
    const account = this.account,
      value = structuredClone(this.draft),
      revision = ++this.revision;
    this.saving = true;
    this.dialog
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input")
      .forEach((e) => (e.disabled = true));
    try {
      await this.preferences.save(account, value, this.reset);
      if (revision !== this.revision || account !== this.context()) return;
      this.applied = value;
      this.apply(structuredClone(value));
      this.dialog.close();
    } finally {
      this.saving = false;
      if (this.dialog.open) this.render();
    }
  }
}
