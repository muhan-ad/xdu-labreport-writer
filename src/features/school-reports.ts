import { ReportUploadConfirm } from "./report-upload-confirm.ts";
import {schoolAccounts} from '../platform/school-accounts.ts';
import type {SavedSchoolAccount} from '../domain/school-accounts.ts';
import {preloadReportAccount} from '../domain/school-preload.ts';
import type { Repository } from "../domain/repository.ts";
import type { Experiment } from "../domain/types.ts";
import type { SavedReport } from "../domain/reports.ts";
import { nameMatches } from "../domain/reviews.ts";
import { uniqueReportRow } from "../domain/report-upload.ts";
import { sameReportInputs, reportFilename } from "../domain/reports.ts";
import { reportSourceUri } from "../platform/reports.ts";
import { dataSnapshot } from "../platform/data-state.ts";
import { SchoolReports } from "../platform/school-reports.ts";
import type {
  SchoolReportState,
  SchoolReportRow,
} from "../domain/report-status.ts";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class SchoolReportView {
  private savedAccount: SavedSchoolAccount | null = null;
  private lifetime: AbortController | null = null;
  private accountRead = 0;
  private service:SchoolReports;
  private host: HTMLElement | null = null;
  private state: SchoolReportState | null = null;
  private busy = false;
  private warmTask:Promise<void>|null=null;
  private warmEpoch=0;
  private warmOwnsSession=false;
  private connected = false;
  private token = 0;
  private message = "";
  private account = "";
  private pendingExperiment: string | null = null;
  private retryExperiment: string | null = null;
  private uploadRun = 0;
  private confirmation = new ReportUploadConfirm(
    async (p) => {
      this.busy = true;
      this.updateControls();
      try {
        const result = await this.service.commitUpload(p.ticket);
        this.receive(result.state, this.token);
        this.message = result.message;
        this.notice(result.message);
      } catch (e) {
        this.message = (e as Error).message;
        try {
          await this.service.read((s) => this.receive(s, this.token));
        } catch {}
        throw e;
      } finally {
        this.busy = false;
        this.updateControls();
      }
    },
    (ticket) => this.service.discardUpload(ticket),
    (ticket) => this.service.openUploadPreview(ticket),
    (s) => this.notice(s),
  );
  get isOpen() {
    return this.confirmation.isOpen;
  }
  get isSaving() {
    return this.confirmation.isSaving;
  }
  close() {
    this.confirmation.close();
  }
  constructor(
    private notice: (s: string) => void,
    private repo: Repository,
    private experiments: Experiment[],
    service?:SchoolReports,
    private currentResources: typeof dataSnapshot = dataSnapshot,
    private accounts: Pick<typeof schoolAccounts, "list"> = schoolAccounts,
  ) {this.service=service??new SchoolReports();}

  leave() {
    this.lifetime?.abort();
    this.lifetime = null;
    this.savedAccount = null;
    const password = this.host?.querySelector<HTMLInputElement>("#report-site-password");
    if (password) password.value = "";
    this.confirmation.close();
    this.uploadRun++;
    this.host = null;
    this.pendingExperiment = null;
    this.retryExperiment = null;
    this.token++;
    this.busy = !!this.warmTask;
  }
  private accountConfig: 'checking'|'ready'|'missing'|'error' = 'checking';
  private async checkAccountConfig() {
    const request = ++this.accountRead;
    const signal = this.lifetime?.signal;
    const current = () => !!this.host && !!signal && !signal.aborted && request === this.accountRead;
    this.accountConfig = "checking";
    this.savedAccount = null;
    if (!this.connected) this.render();
    try {
      const [rows, preferred] = await Promise.all([
        this.accounts.list(),
        Promise.resolve().then(() => this.repo.loadSchoolPreload()).catch(() => null),
      ]);
      if (!current()) return;
      this.savedAccount = (preferred && preloadReportAccount(preferred, rows))
        || rows.find(row => row.system === "report" && !row.locked) || null;
      this.accountConfig = this.savedAccount ? "ready" : "missing";
    } catch {
      if (!current()) return;
      this.accountConfig = "error";
    }
    if (!this.connected) this.render();
  }
  mount(host: HTMLElement, experimentId?: string) {
    this.leave();
    this.host = host;
    const {signal} = this.lifetime = new AbortController();
    this.pendingExperiment = experimentId || null;
    this.retryExperiment = null;
    this.accountConfig = "checking";
    this.render();
    void this.checkAccountConfig();
    host.addEventListener("input", (event) => {
      const account = event.target as HTMLInputElement;
      if (account.id !== "report-site-account") return;
      const password = host.querySelector<HTMLInputElement>("#report-site-password");
      if (password) password.placeholder = this.passwordMask(account.value.trim());
    }, {signal});
    host.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>("[data-report-site]");
      if (!button || button.disabled) return;
      if (button.dataset.reportSite === "check-config") {
        void this.checkAccountConfig();
        return;
      }
      void this.action(button.dataset.reportSite!).catch((error: Error) => {
        if (signal.aborted) return;
        this.message = error.message;
        this.updateControls();
      });
    }, {signal});
    if (this.connected&&!this.warmTask) void this.action("read");
  }
  /** Preload only a selected saved account. Never prepare or submit an upload. */
  warm(saved:SavedSchoolAccount):Promise<void>{
    if(this.warmTask)return this.warmTask;
    if(this.busy||this.connected||saved.system!=='report'||saved.locked)return Promise.resolve();
    const epoch=++this.warmEpoch;this.warmOwnsSession=false;this.busy=true;this.message='正在自动加载报告状态…';this.render();
    const update=(state:SchoolReportState)=>{if(epoch!==this.warmEpoch)return;if(this.host){this.receive(state,this.token);return;}if(state.phase==='ready'){this.connected=true;this.state=state;this.message=state.message;}else if(['expired','needs_login','login_failed'].includes(state.phase)&&this.connected){this.connected=false;this.state=null;this.message=state.message||'报告登录已失效，请重新登录';}};
    const task=(async()=>{try{
      const existing=await this.service.restoreActive(update,account=>{if(epoch===this.warmEpoch)this.account=account;});if(epoch!==this.warmEpoch)return;
      if(existing)this.account=existing;
      else{this.warmOwnsSession=true;this.account=saved.account;await this.service.connectSaved(saved.id,saved.account,update);}
      if(epoch===this.warmEpoch)this.message='已自动加载报告状态';
    }catch(error){if(epoch===this.warmEpoch){this.message='自动加载未完成：'+(error as Error).message;if(!this.connected)this.state=null;}}
    finally{if(epoch===this.warmEpoch){this.warmOwnsSession=false;this.warmTask=null;this.busy=false;this.render();void this.preparePendingUpload();}}})();
    this.warmTask=task;return task;
  }
  async cancelWarm(){const task=this.warmTask;if(!task)return;const owned=this.warmOwnsSession;this.warmEpoch++;this.warmOwnsSession=false;this.service.invalidate();if(owned){try{await this.service.clear();}catch(error){this.message='自动加载停止失败，请清除报告会话后重试';this.render();throw error;}this.connected=false;this.state=null;this.account='';}if(this.warmTask===task)this.warmTask=null;this.busy=false;this.render();}
  private grade(row: SchoolReportRow) {
    if (row.score !== null)
      return `<strong class="school-report-score">${esc(row.score)}</strong>`;
    if (row.status)
      return `<strong class="school-report-status">${esc(row.status)}</strong>`;
    if (
      row.imageState === "loading" ||
      (row.gradeImage &&
        row.imageState !== "unreadable" &&
        row.imageState !== "recognized")
    )
      return '<span class="muted">识别中…</span>';
    if (row.gradeImage)
      return `<img class="school-report-status-image" src="${row.gradeImage}" alt="官网状态，识别待核实"><span class="muted">待核实</span>`;
    return '<span class="muted">状态待核实</span>';
  }
  private receive(state: SchoolReportState, token: number) {
    if (token !== this.token || !this.host) return;
    if (
      ["expired", "needs_login", "login_failed"].includes(state.phase) &&
      this.connected
    ) {
      this.connected = false;
      this.state = null;
      this.message = state.message || "报告登录已失效，请重新登录";
      this.render();
      return;
    }
    if (state.phase === "error") {
      this.message = state.message || "报告网站响应异常";
      return;
    }
    if (state.phase !== "ready") {
      const label = this.host.querySelector("#report-site-status");
      if (label) label.textContent = "正在读取报告系统…";
      return;
    }
    this.connected = true;
    const same =
      this.state?.rows.map((r) => r.fingerprint).join("|") ===
        state.rows.map((r) => r.fingerprint).join("|") &&
      this.state?.page === state.page;
    this.state = state;
    this.message = state.message;
    if (!same || !this.host.querySelector("[data-report-row]")) {
      this.render();
      return;
    }
    state.rows.forEach((r, i) => {
      const grade = this.host?.querySelector(`[data-report-grade="${i}"]`);
      if (grade) grade.innerHTML = this.grade(r);
    });
  }
  private updateControls() {
    if (!this.host) return;
    const status = this.host.querySelector("#report-site-status");
    if (status)
      status.textContent =
        this.message || (this.busy ? "正在读取报告系统…" : "");
    for (const button of this.host.querySelectorAll<HTMLButtonElement>(
      "[data-report-site]",
    )) {
      const action = button.dataset.reportSite;
      if (action === "refresh" || action === "retry-upload") button.disabled = this.busy;
      if (action?.startsWith("upload-")) {
        const row = this.state?.rows[Number(action.slice(7))];
        button.disabled =
          this.busy ||
          !row ||
          row.score !== null ||
          (!row.canUpload && row.uploadKnown !== false);
      }
      if (action === "previous")
        button.disabled = this.busy || !this.state || this.state.page <= 1;
      if (action === "next")
        button.disabled =
          this.busy || !this.state || this.state.page >= this.state.pages;
    }
  }
  private passwordMask(account = this.savedAccount?.account) {
    return account === this.savedAccount?.account ? "*".repeat(this.savedAccount?.passwordLength ?? 0) : "";
  }
  private render() {
    if (!this.host) return;
    if(!this.connected && !this.busy && this.accountConfig!=='ready') {
      const text=this.accountConfig==='checking'?'正在核对报告提交账号…':this.accountConfig==='missing'?'请先在“配置 → 实验报告提交账号”中完成账号配置。':'报告提交账号未能读取，请重试或前往配置核对。';
      this.host.innerHTML=`<section class="panel"><h2>实验报告提交</h2><p role="status">${text}</p><div class="ai-inline"><a class="button" href="#/portal/config" style="text-decoration:none">前往配置</a>${this.accountConfig==='error'?'<button class="button secondary" data-report-site="check-config">重新读取</button>':''}</div></section>`;
      return;
    }
    const state = this.state;
    this.host.innerHTML = `<section class="panel"><div class="portal-title"><h2>实验报告提交</h2><button class="button secondary compact" data-report-site="clear">清除报告会话</button></div>${this.connected ? `<p>报告账号 ${esc(this.account)}</p><div class="ai-inline"><button class="button secondary compact" data-report-site="refresh" ${this.busy ? "disabled" : ""}>刷新状态</button>${this.retryExperiment ? '<button class="button secondary compact" data-report-site="retry-upload">重新准备上传</button>' : ""}<a class="button secondary compact" href="#/portal">返回选课</a></div>` : this.busy ? "" : `<label class="ai-field">报告系统账号<input id="report-site-account" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(this.savedAccount?.account ?? this.account)}"></label><label class="ai-field">密码<input id="report-site-password" type="password" autocomplete="off" maxlength="200" placeholder="${this.passwordMask()}"></label><button class="button" data-report-site="login">登录报告系统</button>`}<p id="report-site-status" role="status">${esc(this.message || (this.busy ? "正在读取报告系统…" : ""))}</p></section>${this.connected && state ? `<section id="report-site-list" class="school-report-list">${state.rows.map((row, i) => `<article class="panel school-report-card" data-report-row="${i}"><div class="school-report-week">${esc(row.week)}<small>教学周</small></div><div><h3>${esc(row.name)}</h3><p>${esc(row.time)}</p></div><div class="school-report-grade"><span class="muted">成绩 / 状态</span><div data-report-grade="${i}">${this.grade(row)}</div><button class="button compact" data-report-site="upload-${i}" ${this.busy || row.score !== null || (!row.canUpload && row.uploadKnown !== false) ? "disabled" : ""}>上传报告</button></div></article>`).join("") || '<section class="panel">官网当前没有报告记录。</section>'}</section><div class="ai-inline"><button class="button secondary compact" data-report-site="previous" ${this.busy || state.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${state.page} / ${state.pages} 页</span><button class="button secondary compact" data-report-site="next" ${this.busy || state.page >= state.pages ? "disabled" : ""}>下一页</button></div>` : ""}`;
  }
  private async stage(
    row: SchoolReportRow,
    exp: Experiment,
    report: SavedReport,
  ) {
    const run = ++this.uploadRun;
    this.busy = true;
    this.updateControls();
    try {
      const [loaded, profile, photo, settings, resources] = await Promise.all([
        this.repo.load(exp),
        this.repo.loadProfile(),
        this.repo.loadPhoto(exp.id),
        this.repo.loadReportSettings(exp.id),
        this.currentResources(),
      ]);
      if (
        !sameReportInputs(report.snapshot, {
          record: loaded.record,
          profile,
          photoPath: photo?.path ?? null,
          settings,
          resourceHash: resources.resourceHash,
        })
      )
        throw Error("录入数据或报告配置已变化，请重新生成报告后上传");
      const uri = await reportSourceUri(report);
      if (run !== this.uploadRun || !this.host) throw Error("报告页面已变化");
      const prepared = await this.service.prepareUpload({
        fingerprint: row.fingerprint,
        page: this.state!.page,
        experimentId: exp.id,
        generation: report.generation,
        studentId: report.snapshot.profile.studentId,
        fileName: reportFilename(exp.name),
        uri,
      });
      if (run !== this.uploadRun || !this.host) {
        await this.service.discardUpload(prepared.ticket);
        return;
      }
      this.confirmation.show(prepared, report);
    } finally {
      if (run === this.uploadRun) {
        this.busy = false;
        this.updateControls();
      }
    }
  }
  private async chooseReport(row: SchoolReportRow, selected?: Experiment) {
    const token = this.token;
    const exps = selected
      ? [selected]
      : this.experiments.filter((e) => nameMatches(e.name, row.name));
    const options = [] as { exp: Experiment; report: SavedReport }[];
    for (const exp of exps) {
      const result = await this.repo.loadReport(exp);
      if (result.value) options.push({ exp, report: result.value });
    }
    if (!options.length) throw Error("没有找到对应的本机报告，请先生成报告");
    if (options.length !== 1)
      throw Error("本机有多份对应报告，请从具体实验的报告页面点击“上传报告”");
    if (token !== this.token || !this.host) throw Error("报告页面已变化");
    await this.stage(row, options[0].exp, options[0].report);
  }
  private async preparePendingUpload() {
    if (!this.host || !this.connected || this.busy || !this.pendingExperiment) return;
    const token = this.token;
    const id = this.pendingExperiment;
    this.pendingExperiment = null;
    this.retryExperiment = null;
    this.busy = true;
    this.message = "正在查找对应的官网实验记录…";
    this.updateControls();
    try {
      const exp = this.experiments.find((e) => e.id === id);
      if (!exp) throw Error("实验标识无效");
      let currentPage: number;
      const receive = (state: SchoolReportState) => {
        if (token !== this.token || !this.host) throw Error("报告页面已变化");
        if (state.phase === "ready") currentPage = state.page;
        this.receive(state, token);
      };
      const row = await uniqueReportRow(
        exp.name,
        () => this.service.readReady(receive),
        direction => this.service.page(direction, receive, currentPage + direction),
      );
      if (token !== this.token || !this.host) return;
      this.message = "正在准备本机报告…";
      this.updateControls();
      await this.chooseReport(row, exp);
      if (token === this.token) this.message = "";
    } catch (error) {
      if (token !== this.token || !this.host) return;
      this.message = (error as Error).message;
      this.retryExperiment = id;
      if (!this.connected) this.pendingExperiment = id;
      this.notice(this.message);
    } finally {
      if (token === this.token && this.host) {
        this.busy = false;
        if (this.retryExperiment) this.render();
        else this.updateControls();
      }
    }
  }
  private async action(action: string) {
    if (this.isSaving) {
      this.notice("报告正在提交并回读，请稍候");
      return;
    }
    if (action === "retry-upload" && !this.busy) {
      this.pendingExperiment = this.retryExperiment;
      await this.preparePendingUpload();
      return;
    }
    if (action.startsWith("upload-") && !this.busy) {
      const row = this.state?.rows[Number(action.slice(7))];
      if (row) {
        this.busy = true;
        this.updateControls();
        try {
          await this.chooseReport(row);
          this.message = "";
        } catch (error) {
          this.notice((error as Error).message);
          throw error;
        } finally {
          this.busy = false;
          this.updateControls();
        }
      }
      return;
    }

    if (action === "clear") {
      this.confirmation.close();
      this.warmEpoch++;this.warmOwnsSession=false;this.warmTask=null;
      this.uploadRun++;
      this.token++;
      this.connected = false;
      this.state = null;
      this.account = "";
      this.busy = false;
      this.message = "报告登录会话已清除";
      await this.service.clear();
      this.render();
      return;
    }
    if (this.busy) return;
    const account = this.host?.querySelector<HTMLInputElement>("#report-site-account")?.value.trim() ?? "";
    const password = this.host?.querySelector<HTMLInputElement>("#report-site-password")?.value ?? "";
    const saved = !password && this.savedAccount?.account === account ? this.savedAccount : null;
    if (action === "login" && (!account || (!password && !saved)))
      throw Error("请填写报告系统账号和密码");
    const token = ++this.token;
    this.busy = true;
    this.message = "";
    if (action === "login") {
      this.account = account;
      this.state = null;
      this.connected = false;
    }
    if (action === "login") this.render();
    else this.updateControls();
    const receive = (state: SchoolReportState) => this.receive(state, token);
    try {
      if (action === "login") {
        if (saved) await this.service.connectSaved(saved.id, saved.account, receive);
        else await this.service.connect(account, password, receive);
      }
      else if (action === "refresh") await this.service.refresh(receive);
      else if (action === "previous" || action === "next")
        await this.service.page(action === "next" ? 1 : -1, receive, this.state ? this.state.page + (action === "next" ? 1 : -1) : undefined);
      else await this.service.read(receive);
    } catch (e) {
      if (token === this.token) {
        this.message = (e as Error).message;
        this.notice(this.message);
      }
    } finally {
      if (token === this.token) {
        this.busy = false;
        if (!this.connected) this.render();
        else this.updateControls();
      }
    }
    if (token === this.token) await this.preparePendingUpload();
  }
}
