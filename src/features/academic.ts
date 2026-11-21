import type { AcademicResult } from "../domain/academic.ts";
import type { AcademicPort } from "../platform/academic.ts";

const statusLabels: Record<AcademicResult["status"], string> = {
  disconnected: "尚未同步教务课表",
  reading: "正在读取教务课表…",
  fresh: "课表同步完成",
  incomplete: "课表读取不完整，请重新同步",
  stale: "课表状态待核实，请重新同步",
};

export class AcademicView {
  private host: HTMLElement | null = null;
  private token = 0;
  private id = "";
  private account = "";
  private busy = false;
  private canRetrySave = false;

  constructor(private port: AcademicPort, private confirm: () => Promise<boolean>) {}

  mount(host: HTMLElement, account = "") {
    this.leave();
    this.host = host;
    this.account = account;
    this.canRetrySave = false;
    host.innerHTML = `<section class="panel">
      <p>在官网窗口完成统一认证，再点“读取课表”。</p>
      <div class="ai-inline">
        <button class="button" data-academic="connect">登录并同步课表</button>
        <button class="button secondary" data-academic="clear">清除教务会话</button>
      </div>
      <p data-academic-status role="status"></p>
      <button class="button secondary" data-academic="retry-save" hidden>重试本机保存</button>
    </section>`;
    host.onclick = event => {
      const action = (event.target as Element).closest<HTMLElement>("[data-academic]")?.dataset.academic;
      if (action) void this.action(action);
    };
    this.showStatus("尚未同步教务课表");
    if (this.account) void this.load();
  }

  refreshAfterWarmup(account:string){
    if(this.host&&this.account===account&&!this.busy)void this.load();
  }

  leave() {
    this.token++;
    if (this.id) void this.port.cancel(this.id).catch(() => {});
    this.id = "";
    this.busy = false;
    if (this.host) this.host.onclick = null;
    this.host = null;
  }

  private showStatus(text: string, warning = false) {
    const node = this.host?.querySelector("[data-academic-status]");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("ocr-warning", warning);
  }

  private apply(result: AcademicResult) {
    this.canRetrySave = !!result.cacheWarning && !!this.port.retrySave;
    this.showStatus(result.cacheWarning ?? statusLabels[result.status], !!result.cacheWarning || result.status === "incomplete" || result.status === "stale");
  }

  private controls() {
    this.host?.querySelectorAll<HTMLButtonElement>("[data-academic]").forEach(button => {
      button.disabled = this.busy;
      if (button.dataset.academic === "retry-save") button.hidden = !this.canRetrySave;
    });
  }

  private async load() {
    const token = ++this.token;
    this.busy = true;
    this.controls();
    this.showStatus("正在读取本机课表…");
    try {
      const result = await this.port.status(this.account);
      if (token === this.token) this.apply(result);
    } catch (error) {
      if (token === this.token) this.showStatus((error as Error).message, true);
    } finally {
      if (token === this.token) {
        this.busy = false;
        this.controls();
      }
    }
  }

  private async action(action: string) {
    if (this.busy || !this.host) return;
    if (action !== "connect" && !/^\d{5,20}$/.test(this.account)) {
      this.showStatus("请先登录并同步课表", true);
      return;
    }
    const token = ++this.token, owner = this.account;
    this.busy = true;
    this.controls();
    try {
      if (action === "retry-save") {
        if (!this.port.retrySave) throw Error("请重新同步以重试保存");
        await this.port.retrySave(owner);
        if (token !== this.token) return;
        this.canRetrySave = false;
        this.showStatus("本机课表已保存");
      } else if (action === "clear") {
        if (!await this.confirm() || token !== this.token) return;
        await this.port.clear(owner);
        if (token !== this.token) return;
        this.canRetrySave = false;
        this.showStatus("已清除教务会话和当前课表");
      } else if (action === "connect") {
        this.id = crypto.randomUUID();
        this.showStatus("请在官网窗口完成认证并读取课表");
        const result = await this.port.connect(owner, this.id);
        if (token !== this.token) return;
        this.account = result.snapshot?.account ?? this.account;
        this.apply(result);
      }
    } catch (error) {
      if (token === this.token) this.showStatus((error as Error).message, true);
    } finally {
      if (token === this.token) {
        this.id = "";
        this.busy = false;
        this.controls();
      }
    }
  }
}
