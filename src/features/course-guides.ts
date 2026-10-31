import {academicAvailable,academicConflict,type AcademicResult} from '../domain/academic.ts';
import { experimentReviews, teacherGuides } from "../domain/reviews.ts";
import {
  guideAvailability,
  type GuideScope,
  type GuideSession,
} from "../domain/recommendations.ts";
import type { Overview, Slot } from "../domain/portal.ts";
import type { CourseDetails } from "../domain/course-metadata.ts";

interface Context {
  academic?:AcademicResult|null;
  overview: Overview | null;
  slots: Iterable<Slot>;
  metadata: ReadonlyMap<string, CourseDetails>;
  status: string;
  running: boolean;
  busy: boolean;
}
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const mark = (category: string) =>
  category === "recommended"
    ? '<span class="course-badge">推荐</span>'
    : category === "not_recommended"
      ? '<span class="course-badge negative">不推荐</span>'
      : "";
const categories = [
  ["recommended", "推荐"],
  ["not_recommended", "不推荐"],
  ["mixed", "介中"],
];
export class CourseGuides {
  private root: HTMLElement | null = null;
  private mode: "recommend" | "teachers" = "recommend";
  private category = "recommended";
  private search = "";
  private remainingOnly = false;
  private excludeAcademic=false;
  private academicOwner="";
  private scopes: GuideScope[] = [];
  private dialog = document.createElement("dialog");
  private scope: GuideScope | null = null;
  private sessions: GuideSession[] = [];
  private generation = 0;
  private pending = false;
  constructor(
    private context: () => Context,
    private refresh: () => Promise<void>,
    private choose: (item: Slot, valid: () => boolean) => Promise<boolean>,
    private notice: (s: string) => void,
  ) {
    this.dialog.id = "guide-sessions";
    this.dialog.className = "modal course-filter-panel";
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {
      this.generation++;
      this.scope = null;
    });
    this.dialog.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-guide-pick],[data-guide-close]",
      );
      if (!button || button.disabled) return;
      if (button.hasAttribute("data-guide-close")) {
        this.close();
        return;
      }
      const item = this.sessions[Number(button.dataset.guidePick)]?.item;
      if (!item || this.pending || this.context().busy) return;
      const generation = this.generation;
      const valid = () => this.dialog.open && generation === this.generation;
      this.pending = true;
      this.updateDialog();
      void this.choose(item, valid)
        .then((ok) => {
          if (ok && valid()) this.close();
        })
        .catch((e) => this.notice((e as Error).message))
        .finally(() => {
          this.pending = false;
          this.updateDialog();
        });
    });
  }
  get isOpen() {
    return this.dialog.open;
  }
  close() {
    this.generation++;
    this.scope = null;
    this.dialog.close();
  }
  leave() {
    this.root = null;
    this.close();
  }
  html(mode: "recommend" | "teachers") {
    if (this.mode !== mode) this.search = "";
    this.mode = mode;
    return '<section class="panel" id="course-guides"></section>';
  }
  bind(host: HTMLElement) {
    const root = host.querySelector<HTMLElement>("#course-guides");
    this.root = root;
    if (!root) return;
    this.render();
    root.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-guide-scope],[data-guide-category],[data-guide-refresh]",
      );
      if (!button || button.disabled) return;
      if (button.dataset.guideCategory) {
        this.category = button.dataset.guideCategory;
        this.render();
      } else if (button.hasAttribute("data-guide-refresh"))
        void this.refresh().catch((e) => this.notice(e.message));
      else {
        this.scope = this.scopes[Number(button.dataset.guideScope)] ?? null;
        if (this.scope) {
          this.updateDialog();
          this.dialog.showModal();
        }
      }
    });
    root.addEventListener("input", (e) => {
      if ((e.target as Element).id === "guide-search") {
        this.search = (e.target as HTMLInputElement).value;
        this.update();
      }
    });
    root.addEventListener("change", (e) => {
      if ((e.target as Element).id === "guide-academic") {this.excludeAcademic=(e.target as HTMLInputElement).checked;this.update();return;}
      if ((e.target as Element).id === "guide-remaining") {
        this.remainingOnly = (e.target as HTMLInputElement).checked;
        this.update();
      }
    });
  }
  private filteredSlots(context:Context){const items=[...context.slots];return this.excludeAcademic&&context.overview&&academicAvailable(context.academic??null,context.overview.identity.account)?items.filter(item=>academicConflict(context.academic??null,item,context.overview!).status==='clear'):items;}
  private register(scope: GuideScope) {
    return this.scopes.push(scope) - 1;
  }
  private seats(scope: GuideScope) {
    const index = this.register(scope);
    return `<div class="guide-seats" data-guide-stat="${index}"><span class="guide-seat-label"></span><button class="button secondary compact" data-guide-scope="${index}">查看场次</button></div>`;
  }
  private render() {
    if (!this.root) return;
    this.scopes = [];
    const cards =
      this.mode === "recommend"
        ? experimentReviews
            .map((r) => {
              const index = this.scopes.length;
              return `<article class="portal-card guide-card" data-guide-card="${index}" data-guide-name="${esc(r.name)}"><h3>${esc(r.name)}${mark(r.category)}</h3><p class="guide-review">${esc(r.review)}</p>${this.seats({ experiment: r.name })}</article>`;
            })
            .join("")
        : teacherGuides
            .filter((t) => t.category === this.category)
            .map((t) => {
              const index = this.register({ teacher: t.name });
              return `<article class="portal-card guide-card" data-guide-card="${index}" data-guide-name="${esc(t.name)}"><h3>${esc(t.name)}${mark(t.category)}</h3>${t.groups.map((g) => `<div class="guide-review-group">${g.experiments.map((experiment) => `<div class="guide-experiment"><strong>${esc(experiment)}</strong>${this.seats({ experiment, teacher: t.name })}</div>`).join("")}<p class="guide-review">${esc(g.review)}</p></div>`).join("")}<div class="guide-seats" data-guide-stat="${index}"><span class="guide-seat-label"></span><button class="button secondary compact" data-guide-scope="${index}">查看全部场次</button></div></article>`;
            })
            .join("");
    this.root.innerHTML = `<div class="portal-title"><h2>${this.mode === "recommend" ? "实验推荐" : "老师推荐"}</h2><button class="button secondary compact" data-guide-refresh>刷新余量</button></div>${this.mode === "teachers" ? `<div class="ai-inline guide-categories">${categories.map(([id, label]) => `<button class="button secondary compact" data-guide-category="${id}" aria-pressed="${id === this.category}">${label} · ${teacherGuides.filter((t) => t.category === id).length}</button>`).join("")}</div>` : ""}<div class="guide-tools"><input id="guide-search" type="search" placeholder="${this.mode === "recommend" ? "搜索实验" : "搜索老师"}" aria-label="搜索推荐" value="${esc(this.search)}"><label class="guide-switch"><input id="guide-remaining" type="checkbox" ${this.remainingOnly ? "checked" : ""}>只看有余量</label><label class="guide-switch"><input id="guide-academic" type="checkbox" ${this.excludeAcademic?"checked":""} ${academicAvailable(this.context().academic??null,this.context().overview?.identity.account??"")?"":"disabled"}>排除教务冲突</label></div><p id="guide-progress" role="status"></p><div class="guide-grid">${cards}</div><p id="guide-empty" hidden>当前已获取结果中没有符合条件的项目。</p>`;
    this.update();
  }
  update() {
    const context = this.context();
    const owner=context.overview?.identity.account??"";if(owner!==this.academicOwner){this.academicOwner=owner;this.excludeAcademic=false;}
    const switcher=this.root?.querySelector<HTMLInputElement>("#guide-academic");if(switcher){switcher.checked=this.excludeAcademic;switcher.disabled=!academicAvailable(context.academic??null,owner);}
    if (this.root?.isConnected) {
      const { overview, status, busy } = context;
      const progress = this.root.querySelector("#guide-progress");
      if (progress)
        progress.textContent = overview ? status + (academicAvailable(context.academic??null,owner)?"":" · 教务冲突未校验"+(this.excludeAcademic?"，教务筛选暂未应用":"")) : "登录后可查询实时余量";
      const refresh = this.root.querySelector<HTMLButtonElement>(
        "[data-guide-refresh]",
      );
      if (refresh) refresh.disabled = !overview || busy || context.running;
      const filteredSlots=this.filteredSlots(context);
      const summaries = this.scopes.map((scope) =>
        guideAvailability(filteredSlots, overview, context.metadata, scope),
      );
      for (const stat of this.root.querySelectorAll<HTMLElement>(
        "[data-guide-stat]",
      )) {
        const summary = summaries[Number(stat.dataset.guideStat)];
        if (!summary) continue;
        const label = stat.querySelector(".guide-seat-label");
        if (label)
          label.textContent = !overview
            ? "未登录"
            : summary.seats === null
              ? "场次待核实"
              : `已获取 ${summary.seats} 人 · ${summary.sessions.length} 场`;
        const button =
          stat.querySelector<HTMLButtonElement>("[data-guide-scope]");
        if (button) button.disabled = busy || !summary.sessions.length;
      }
      let count = 0;
      for (const card of this.root.querySelectorAll<HTMLElement>(
        "[data-guide-card]",
      )) {
        const summary = summaries[Number(card.dataset.guideCard)];
        card.hidden =
          !card.dataset.guideName
            ?.toLowerCase()
            .includes(this.search.trim().toLowerCase()) ||
          (this.remainingOnly && !summary?.sessions.length);
        if (!card.hidden) count++;
      }
      this.root
        .querySelector("#guide-empty")
        ?.toggleAttribute("hidden", count > 0);
    }
    this.updateDialog();
  }
  private updateDialog() {
    if (!this.scope) return;
    const context = this.context(),
      summary = guideAvailability(
        this.filteredSlots(context),
        context.overview,
        context.metadata,
        this.scope,
      );
    this.sessions = summary.sessions;
    const scroll = this.dialog.querySelector(".modal-body")?.scrollTop ?? 0;
    this.dialog.innerHTML = `<div class="modal-heading"><h2>${esc(this.scope.experiment || this.scope.teacher)}</h2><button class="icon-button" data-guide-close aria-label="关闭场次">×</button></div><div class="modal-body"><p>${esc(this.scope.experiment && this.scope.teacher ? this.scope.teacher : "")}</p><p role="status">${esc(context.status)} · ${academicAvailable(context.academic??null,context.overview?.identity.account??'')?'教务课表已同步':'教务冲突未校验'}${summary.uncertain ? " · 部分场次待核实" : ""}</p>${this.sessions.map((s, i) => `<article class="portal-card"><h3>${esc(s.item.name)}</h3><p>第 ${s.item.week} 周 · ${esc(s.date)} · ${esc(s.item.time)}</p><p>教师：${esc(s.teachers.join("、") || "待核实")}</p><div class="portal-card-actions"><strong>余 ${s.item.remaining} 人</strong><button class="button compact" data-guide-pick="${i}" ${context.busy || this.pending ? "disabled" : ""}>选取此场次</button></div></article>`).join("") || "<p>尚无已确认的可选场次。</p>"}</div><div class="modal-actions"><button class="button secondary" data-guide-close>关闭</button></div>`;
    this.dialog.querySelector(".modal-body")!.scrollTop = scroll;
  }
}
