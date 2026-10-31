import type { PreparedReportUpload } from "../platform/school-reports.ts";
import type { SavedReport } from "../domain/reports.ts";
import { stagedReportBytes } from "../platform/reports.ts";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class ReportUploadConfirm {
  private dialog = document.createElement("dialog");
  private prepared: PreparedReportUpload | null = null;
  private frame: HTMLIFrameElement | null = null;
  private bytes: Uint8Array | null = null;
  private frameReady = false;
  private token = "";
  private run = 0;
  private committing = false;
  private previewing = false;
  private expires = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private commit: (p: PreparedReportUpload) => Promise<void>,
    private discard: (ticket: string) => Promise<void>,
    private external: (ticket: string) => Promise<void>,
    private notice: (s: string) => void,
  ) {
    this.dialog.id = "report-upload-confirm";
    this.dialog.className = "modal school-upload-confirm";
    document.body.append(this.dialog);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>(
        "[data-upload-confirm]",
      );
      if (!button || button.disabled) return;
      const action = button.dataset.uploadConfirm;
      if (action === "cancel") this.close();
      if (action === "preview")
        void this.preview().catch((e) => this.message(e.message));
      if (action === "external" && this.prepared)
        void this.external(this.prepared.ticket).catch((e) =>
          this.message(e.message),
        );
      if (
        action === "continue" &&
        this.prepared &&
        !this.committing &&
        !this.previewing &&
        performance.now() < this.expires
      ) {
        const p = this.prepared;
        this.committing = true;
        clearTimeout(this.timer);
        this.controls();
        void this.commit(p)
          .then(() => this.close(true))
          .catch((e) => {
            this.message(e.message);
            this.expires = 0;
          })
          .finally(() => {
            this.committing = false;
            this.controls();
          });
      }
    });
    window.addEventListener("message", (e) => {
      if (e.source !== this.frame?.contentWindow) return;
      if (e.data?.type === "report-preview-ready") {
        this.frameReady = true;
        this.send();
      }
      if (
        e.data?.type === "report-preview-result" &&
        e.data.token === this.token
      )
        this.message(
          e.data.ok
            ? "预览已就绪"
            : String(e.data.message || "预览未完成，可外部打开核对"),
        );
    });
  }
  get isOpen() {
    return this.dialog.open;
  }
  get isSaving() {
    return this.committing;
  }
  show(prepared: PreparedReportUpload, report: SavedReport) {
    this.close(true);
    this.prepared = prepared;
    this.expires = performance.now() + prepared.expiresIn * 1000;
    this.dialog.innerHTML = `<div class="modal-heading"><h2>是否上传这份报告？</h2><button class="icon-button" data-upload-confirm="cancel" aria-label="取消上传">×</button></div><div class="modal-body"><div class="upload-summary"><h3>${esc(prepared.row.name)}</h3><p>官网：第 ${esc(prepared.row.week)} 周 · ${esc(prepared.row.time)}</p><p>本机：${esc(report.snapshot.profile.name)} · ${esc(report.snapshot.profile.studentId)} · ${esc(report.snapshot.record.date)}</p><p>${esc(prepared.fileName)} · ${(prepared.size / 1024 / 1024).toFixed(2)} MB</p></div><p id="upload-preview-status" role="status"></p><div id="upload-report-preview"></div></div><div class="modal-actions"><button class="button secondary" data-upload-confirm="cancel">取消</button><button class="button secondary" data-upload-confirm="preview">预览</button><button class="button secondary" data-upload-confirm="external">外部打开</button><button class="button" data-upload-confirm="continue">继续上传</button></div>`;
    this.dialog.showModal();
    this.controls();
    this.timer = setTimeout(
      () => {
        this.message("确认已过期，请取消后重新准备");
        this.controls();
      },
      prepared.expiresIn * 1000 + 10,
    );
  }
  close(force = false) {
    if (this.committing && !force) {
      this.notice("报告正在提交并回读，请稍候");
      return;
    }
    const p = this.prepared;
    this.prepared = null;
    this.previewing = false;
    this.run++;
    this.bytes = null;
    this.frame = null;
    this.frameReady = false;
    clearTimeout(this.timer);
    if (this.dialog.open) this.dialog.close();
    this.dialog.querySelector("#upload-report-preview")?.replaceChildren();
    if (p) void this.discard(p.ticket).catch(() => {});
  }
  private message(s: string) {
    const node = this.dialog.querySelector("#upload-preview-status");
    if (node) node.textContent = s;
  }
  private controls() {
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-upload-confirm]")
      .forEach((b) => {
        b.disabled =
          this.committing ||
          (this.previewing && (b.dataset.uploadConfirm === "continue" || b.dataset.uploadConfirm === "preview")) ||
          (b.dataset.uploadConfirm === "continue" &&
            (!this.prepared || performance.now() >= this.expires));
      });
  }
  private async preview() {
    const prepared = this.prepared;
    if (!prepared || this.previewing) return;
    const run = ++this.run;
    this.previewing = true;this.controls();
    try { await this.loadPreview(prepared,run); }
    finally { if (run === this.run && prepared === this.prepared) {this.previewing=false;this.controls();} }
  }
  private async loadPreview(prepared: PreparedReportUpload, run: number) {
    if (prepared.size > 32 * 1024 * 1024) {
      this.message("报告超过 32 MB，请用“外部打开”核对");
      return;
    }
    this.message("正在加载待上传报告…");
    const target = this.dialog.querySelector("#upload-report-preview")!;
    target.replaceChildren();
    this.frame = document.createElement("iframe");
    this.frame.id = "upload-preview-frame";
    this.frame.title = "待上传实验报告";
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.referrerPolicy = "no-referrer";
    this.frameReady = false;
    target.append(this.frame);
    this.frame.src = "/preview/index.html";
    let bytes: Uint8Array;
    try {
      bytes = await stagedReportBytes(prepared.previewPath);
    } catch {
      if (run !== this.run || prepared !== this.prepared) return;
      this.expires = 0;clearTimeout(this.timer);this.controls();
      throw Error("预览文件无法读取，请取消并重新准备");
    }
    if (run !== this.run || prepared !== this.prepared) return;
    if (bytes.length !== prepared.size) {
      this.expires = 0;clearTimeout(this.timer);this.controls();
      throw Error("预览文件长度已变化，请取消并重新准备");
    }
    let hash: string;
    try {
      hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer))]
        .map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      if (run !== this.run || prepared !== this.prepared) return;
      this.expires = 0;clearTimeout(this.timer);this.controls();
      throw Error("预览文件无法校验，请取消并重新准备");
    }
    if (run !== this.run || prepared !== this.prepared) return;
    if (hash !== prepared.sha256) {
      this.expires = 0;clearTimeout(this.timer);this.controls();
      throw Error("预览文件校验失败，请取消并重新准备");
    }
    this.bytes = bytes;
    this.send();
  }
  private send() {
    if (!this.bytes || !this.frameReady || !this.frame) return;
    this.token = crypto.randomUUID();
    const bytes = this.bytes;
    this.bytes = null;
    this.frame.contentWindow?.postMessage(
      { type: "report-preview", bytes: bytes.buffer, token: this.token },
      "*",
      [bytes.buffer],
    );
  }
}
