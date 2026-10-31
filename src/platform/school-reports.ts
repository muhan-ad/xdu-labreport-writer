import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  parseSchoolReports,
  applyReportRecognition,
  type SchoolReportState,
  type SchoolReportRow,
} from "../domain/report-status.ts";
export interface PreparedReportUpload {
  ticket: string;
  fileName: string;
  size: number;
  sha256: string;
  previewPath: string;
  expiresIn: number;
  row: SchoolReportRow;
}
interface ReportNative {
  prepareUpload(v: Record<string, unknown>): Promise<PreparedReportUpload>;
  discardUpload(v: { ticket: string }): Promise<void>;
  commitUpload(v: {
    ticket: string;
    confirmed: boolean;
  }): Promise<{
    message: string;
    verified: boolean;
    submitted: boolean;
    state: unknown;
  }>;
  openUploadPreview(v: { ticket: string }): Promise<void>;
  start(): Promise<void>;
  sessionStatus(): Promise<{active:boolean;account:string}>;
  clear(): Promise<void>;
  read(): Promise<unknown>;
  login(v: { account: string; password: string }): Promise<unknown>;
  loginSaved(v:{id:string;account:string}):Promise<unknown>;
  page(v: { direction: number }): Promise<unknown>;
  refresh(): Promise<unknown>;
  recognize(v: { image: string }): Promise<unknown>;
}
const native = registerPlugin<ReportNative>("LabReportPortal");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class SchoolReports {
  prepareUpload(v: Record<string, unknown>) {
    this.platform();
    return native.prepareUpload(v);
  }
  discardUpload(ticket: string) {
    return native.discardUpload({ ticket });
  }
  openUploadPreview(ticket: string) {
    return native.openUploadPreview({ ticket });
  }
  async commitUpload(ticket: string) {
    const result = await native.commitUpload({ ticket, confirmed: true });
    return { ...result, state: parseSchoolReports(result.state) };
  }
  private generation = 0;
  private recognized = new Map<string, unknown>();
  private images = new Map<string, Promise<unknown>>();
  private check(g: number) {
    if (g !== this.generation) throw Error("报告会话已清除，旧结果已丢弃");
  }
  private platform() {
    if (Capacitor.getPlatform() !== "android")
      throw Error("报告网站目前已接入 Android，iOS 正在迁移");
  }
  invalidate() {
    this.generation++;
    this.images.clear();
    this.recognized.clear();
  }
  async clear() {
    this.invalidate();
    this.platform();
    await native.clear();
  }
  async restoreActive(update:(s:SchoolReportState)=>void,onAccount:(account:string)=>void){
    this.platform();const g=++this.generation;const status=await native.sessionStatus();this.check(g);
    if(!status||typeof status.active!=='boolean'||typeof status.account!=='string'||(status.active&&!/^\d{6,30}$/.test(status.account)))throw Error('报告会话状态未能核实');
    if(!status.active)return null;onAccount(status.account);
    await this.waitForList(g,Date.now()+45000,update);return status.account;
  }
  async connect(
    account: string,
    password: string,
    update: (s: SchoolReportState) => void,
  ) {
    return this.connectWith(account,password,update);
  }
  async connectSaved(id:string,account:string,update:(s:SchoolReportState)=>void){
    if(!/^[a-f0-9-]{36}$/.test(id))throw Error('保存账号标识无效');return this.connectWith(account,'',update,id);
  }
  private async connectWith(account:string,password:string,update:(s:SchoolReportState)=>void,savedId?:string){
    this.platform();
    if (!/^\d{6,30}$/.test(account) || (!savedId&&!password) || password.length > 200)
      throw Error("请填写报告系统账号密码");
    const g = ++this.generation;
    this.images.clear();
    this.recognized.clear();
    await native.start();
    this.check(g);
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const state = parseSchoolReports(await native.read());
      this.check(g);
      update(state);
      if (state.phase === "needs_login") {
        const result = parseSchoolReports(
          await (savedId?native.loginSaved({id:savedId,account}):native.login({ account, password })),
        );
        this.check(g);
        if (result.phase === "error")
          throw Error(result.message || "官网登录框无法匹配");
        return this.waitForList(g, deadline, update);
      }
      if (state.phase === "error")
        throw Error(state.message || "报告网站响应异常");
      await delay(500);
      this.check(g);
    }
    throw Error("报告系统连接超时，请检查校园网后重试");
  }
  private async waitForList(
    g: number,
    deadline: number,
    update: (s: SchoolReportState) => void,
  ): Promise<SchoolReportState> {
    while (Date.now() < deadline) {
      const state = await this.read(update, g);
      this.check(g);
      if (
        state.phase === "ready" &&
        !state.rows.some((r) => r.imageState === "loading")
      )
        return state;
      if (
        ["login_failed", "expired", "error", "needs_login"].includes(
          state.phase,
        )
      )
        throw Error(state.message || "报告登录未成功，请核对账号密码");
      await delay(500);
      this.check(g);
    }
    throw Error("报告列表读取超时，可刷新重试");
  }
  async read(update: (s: SchoolReportState) => void, g = this.generation) {
    this.platform();
    const state = parseSchoolReports(await native.read());
    this.check(g);
    state.rows = state.rows.map((row) =>
      this.recognized.has(row.gradeImage)
        ? applyReportRecognition(row, this.recognized.get(row.gradeImage))
        : row,
    );
    update(state);
    for (let i = 0; i < state.rows.length; i++) {
      const row = state.rows[i];
      if (row.gradeText || !row.gradeImage) continue;
      let job = this.images.get(row.gradeImage);
      if (!job) {
        if (this.images.size >= 200) {
          this.images.clear();
          this.recognized.clear();
        }
        job = native.recognize({ image: row.gradeImage });
        this.images.set(row.gradeImage, job);
      }
      const result = await job;
      this.check(g);
      this.recognized.set(row.gradeImage, result);
      state.rows[i] = applyReportRecognition(row, result);
      update({ ...state, rows: [...state.rows] });
    }
    return state;
  }
  async refresh(update: (s: SchoolReportState) => void) {
    const g = this.generation;
    this.images.clear();
    this.recognized.clear();
    await native.refresh();
    this.check(g);
    return this.waitForList(g, Date.now() + 45000, update);
  }
  async page(direction: number, update: (s: SchoolReportState) => void) {
    const g = this.generation;
    const state = parseSchoolReports(await native.page({ direction }));
    this.check(g);
    if (state.phase === "error") throw Error(state.message);
    return this.waitForList(g, Date.now() + 45000, update);
  }
}
