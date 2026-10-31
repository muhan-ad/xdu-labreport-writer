import { ReportUploadConfirm } from "./report-upload-confirm.ts";
import {SavedAccountPicker} from './school-accounts.ts';
import {schoolAccounts} from '../platform/school-accounts.ts';
import type {SavedSchoolAccount} from '../domain/school-accounts.ts';
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
  private accountPicker=new SavedAccountPicker(schoolAccounts,'report',account=>this.action('login-saved',account),text=>{this.message=text;this.render();});
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
  ) {this.service=service??new SchoolReports();}

  leave() {
    this.accountPicker.leave();const password=this.host?.querySelector<HTMLInputElement>('#report-site-password');if(password)password.value='';
    this.confirmation.close();
    this.uploadRun++;
    this.host = null;
    this.token++;
    this.busy = !!this.warmTask;
  }
  mount(host: HTMLElement, experimentId?: string) {
    this.leave();
    this.host = host;
    this.pendingExperiment = experimentId || null;
    this.render();
    const mountedToken = this.token;
    host.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-report-site]",
      );
      if (button && !button.disabled)
        void this.action(button.dataset.reportSite!).catch((e) => {
          if (mountedToken !== this.token || !this.host) return;
          this.message = e.message;
          this.render();
        });
    });
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
    finally{if(epoch===this.warmEpoch){this.warmOwnsSession=false;this.warmTask=null;this.busy=false;this.render();if(this.host&&this.connected&&this.pendingExperiment){const id=this.pendingExperiment;this.pendingExperiment=null;void this.automaticUpload(id).catch(error=>{this.message=(error as Error).message;this.render();});}}}})();
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
      if (action === "refresh") button.disabled = this.busy;
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
  private render() {
    if (!this.host) return;
    this.accountPicker.leave();
    const state = this.state;
    this.host.innerHTML = `<section class="panel"><div class="portal-title"><h2>实验报告提交</h2><button class="button secondary compact" data-report-site="clear">清除报告会话</button></div>${this.connected ? `<p>报告账号 ${esc(this.account)}</p><div class="ai-inline"><button class="button secondary compact" data-report-site="refresh" ${this.busy ? "disabled" : ""}>刷新状态</button><a class="button secondary compact" href="#/portal">返回选课</a></div>` : this.busy ? "" : `<label class="ai-field">报告系统账号<input id="report-site-account" inputmode="numeric" autocomplete="off" maxlength="30" value="${esc(this.account)}"></label><label class="ai-field">密码<input id="report-site-password" type="password" autocomplete="off" maxlength="200"></label><button class="button" data-report-site="login">登录报告系统</button>`}<p id="report-site-status" role="status">${esc(this.message || (this.busy ? "正在读取报告系统…" : "手动输入的密码仅用于本次登录。"))}</p></section>${this.connected && state ? `<section id="report-site-list" class="school-report-list">${state.rows.map((row, i) => `<article class="panel school-report-card" data-report-row="${i}"><div class="school-report-week">${esc(row.week)}<small>教学周</small></div><div><h3>${esc(row.name)}</h3><p>${esc(row.time)}</p></div><div class="school-report-grade"><span class="muted">成绩 / 状态</span><div data-report-grade="${i}">${this.grade(row)}</div><button class="button compact" data-report-site="upload-${i}" ${this.busy || row.score !== null || (!row.canUpload && row.uploadKnown !== false) ? "disabled" : ""}>上传报告</button></div></article>`).join("") || '<section class="panel">官网当前没有报告记录。</section>'}</section><div class="ai-inline"><button class="button secondary compact" data-report-site="previous" ${this.busy || state.page <= 1 ? "disabled" : ""}>上一页</button><span>第 ${state.page} / ${state.pages} 页</span><button class="button secondary compact" data-report-site="next" ${this.busy || state.page >= state.pages ? "disabled" : ""}>下一页</button></div>` : ""}`;
    if(!this.connected&&!this.busy){const picker=document.createElement('div');picker.className='saved-account-tools';this.host.querySelector('#report-site-status')!.before(picker);this.accountPicker.mount(picker);}
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
  private async automaticUpload(id: string) {
    const token = this.token;
    const receive = (s: SchoolReportState) => {
      if (token !== this.token || !this.host) throw Error("报告页面已变化");
      this.receive(s, token);
    };
    const exp = this.experiments.find((e) => e.id === id);
    if (!exp) throw Error("实验标识无效");
    this.busy = true;
    this.updateControls();
    let row: SchoolReportRow;
    try {
      row = await uniqueReportRow(
        exp.name,
        () => this.service.read(receive),
        (direction) => this.service.page(direction, receive),
      );
    } finally {
      this.busy = false;
      this.updateControls();
    }
    await this.chooseReport(row, exp);
  }
  private async action(action: string,saved?:SavedSchoolAccount) {
    if (this.isSaving) {
      this.notice("报告正在提交并回读，请稍候");
      return;
    }
    if (action.startsWith("upload-") && !this.busy) {
      const row = this.state?.rows[Number(action.slice(7))];
      if (row) {
        this.busy = true;
        this.updateControls();
        try {
          await this.chooseReport(row);
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
    if(action==='login-saved'&&(!saved||saved.system!=='report'||saved.locked))throw Error('请选择可用的报告账号');
    const account = saved?.account||
      this.host
        ?.querySelector<HTMLInputElement>("#report-site-account")
        ?.value.trim() || this.account;
    const password = saved?'':
      this.host?.querySelector<HTMLInputElement>("#report-site-password")
        ?.value || "";
    if (action === "login" && (!account || !password))
      throw Error("请填写报告系统账号和密码");
    const token = ++this.token;
    this.busy = true;
    this.message = "";
    if (action === "login"||action==='login-saved') {
      this.account = account;
      this.state = null;
      this.connected = false;
    }
    if (action === "login"||action==='login-saved') this.render();
    else this.updateControls();
    const receive = (state: SchoolReportState) => this.receive(state, token);
    try {
      if (action === "login")
        await this.service.connect(account, password, receive);
      else if(action==='login-saved')await this.service.connectSaved(saved!.id,account,receive);
      else if (action === "refresh") await this.service.refresh(receive);
      else if (action === "previous" || action === "next")
        await this.service.page(action === "next" ? 1 : -1, receive);
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
    if (token === this.token && this.connected && this.pendingExperiment) {
      const id = this.pendingExperiment;
      this.pendingExperiment = null;
      await this.automaticUpload(id);
    }
  }
}
