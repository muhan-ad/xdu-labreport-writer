import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { deepseekPreset, tutorialLinks, tutorialSteps } from "../domain/api-tutorial.ts";
import { tutorialProgress } from "../platform/tutorial-progress.ts";

export class APITutorial {
  private step = 0;
  private completed: number[] = [];
  private active = false;
  private serial = 0;
  private busy = false;
  constructor(private sheet: HTMLDialogElement, private notice: (s: string) => void,private preset?:()=>void) {}
  get isOpen() { return this.active; }
  dispose() { this.serial++; this.active = false; }
  async open() {
    const serial = ++this.serial;
    this.active = true;
    this.park();
    const panel = this.sheet.querySelector<HTMLElement>("#ai-tutorial")!;
    this.sheet.querySelector<HTMLElement>("#ai-config-home")!.hidden = true;
    this.sheet.querySelector<HTMLElement>(".report-footer")!.style.display = "none";
    panel.hidden = false; panel.setAttribute("aria-busy", "true"); panel.textContent = "正在读取教程进度…";
    try { this.completed = await tutorialProgress.loadTutorialProgress(); } catch { this.completed = []; this.notice("教程进度未能读取，可重新阅读"); }
    if (serial !== this.serial || !this.active || !this.sheet.open) return;
    panel.removeAttribute("aria-busy");
    this.step = [0, 1, 2, 3].find(n => !this.completed.includes(n)) ?? 3;
    this.active = true;
    this.render();
  }
  close() {
    this.serial++;
    this.park();
    this.active = false;
    this.sheet.querySelector<HTMLElement>("#ai-tutorial")!.hidden = true;
    this.sheet.querySelector<HTMLElement>("#ai-tutorial")!.removeAttribute("aria-busy");
    this.sheet.querySelector<HTMLElement>("#ai-config-home")!.hidden = false;
    this.sheet.querySelector<HTMLElement>(".report-footer")!.style.removeProperty("display");
    this.sheet.querySelector<HTMLElement>("#ai-tutorial-open")?.focus();
  }
  private park() {
    const fields = this.sheet.querySelector("#ai-config-fields"), home = this.sheet.querySelector("#ai-config-home");
    if (fields && home && fields.parentNode !== home) home.append(fields);
  }
  private async save() {
    this.busy = true;
    const panel = this.sheet.querySelector("#ai-tutorial")!;
    panel.setAttribute("aria-busy", "true");
    try { await tutorialProgress.saveTutorialProgress(this.completed); } catch { if(this.active)this.notice("教程进度未能保存，本次仍可继续阅读"); } finally { this.busy = false; panel.removeAttribute("aria-busy"); }
  }
  async action(action: string) {
    if (action === "tutorial-open") return this.open();
    if (!this.active || this.busy) return;
    const serial = this.serial;
    if (action === "tutorial-close") return this.close();
    if (action === "tutorial-reset") { this.completed = []; this.step = 0; await this.save(); if (!this.active || serial !== this.serial) return; }
    else if (action === "tutorial-next") {
      this.completed = [...new Set([...this.completed, this.step])].sort(); await this.save(); if (!this.active || serial !== this.serial) return;
      if (this.step === 3) return this.close();
      this.step++;
    } else if (action === "tutorial-prev") this.step = Math.max(0, this.step - 1);
    else if (/^tutorial-step-[0-3]$/.test(action)) this.step = Number(action.at(-1));
    else if (action === "tutorial-preset") {
      if (this.sheet.querySelector<HTMLFieldSetElement>("#ai-config-fields")!.disabled) return this.notice("配置正在读取，请稍候");
      if(this.preset){this.preset();const key=this.sheet.querySelector<HTMLInputElement>('#ai-key')!;key.classList.add('tutorial-key');key.focus();return;}
      const oldEndpoint=this.sheet.querySelector<HTMLInputElement>('#ai-endpoint')!.value.trim().replace(/\/+$/,'');
      this.sheet.querySelector<HTMLInputElement>("#ai-endpoint")!.value = deepseekPreset.endpoint;
      this.sheet.querySelector<HTMLInputElement>("#ai-model")!.value = deepseekPreset.model;
      const key = this.sheet.querySelector<HTMLInputElement>("#ai-key")!;
      if(oldEndpoint!==deepseekPreset.endpoint)key.value='';
      key.classList.add("tutorial-key"); key.focus();
      this.notice("已填入地址和模型；请核对密钥后测试连接并保存");
      return;
    } else if (action.startsWith("tutorial-link-")) {
      const key = action.slice(14) as keyof typeof tutorialLinks, url = tutorialLinks[key];
      if (!url) return;
      if (Capacitor.isNativePlatform()) await Browser.open({ url, toolbarColor: "#15803d" });
      else window.open(url, "_blank", "noopener,noreferrer");
      return;
    } else return;
    this.render();
  }
  private render() {
    this.park();
    const home = this.sheet.querySelector<HTMLElement>("#ai-config-home")!, panel = this.sheet.querySelector<HTMLElement>("#ai-tutorial")!;
    home.hidden = true; panel.hidden = false;
    this.sheet.querySelector<HTMLElement>(".report-footer")!.style.display = this.step === 3 ? "" : "none";
    const external = (key: keyof typeof tutorialLinks, label: string) => `<button class="button secondary" data-ai="tutorial-link-${key}">${label} ↗</button>`;
    const lessons = [
      `<p class="tutorial-lead">打开 DeepSeek 官网，选择<strong>「API 开放平台」</strong>，然后注册或登录。</p><div class="tutorial-actions">${external("home", "打开 DeepSeek 官网")}${external("platform", "直接打开开放平台")}</div>`,
      `<p class="tutorial-lead">查看<strong> API 可用余额</strong>。余额不足时，按官网提示充值。</p><div class="tutorial-actions">${external("platform", "打开用量与余额")}</div><p>已有可用余额可直接继续；金额与价格以官网为准。</p>`,
      `<p class="tutorial-lead">进入<strong>「API keys」</strong>，创建并复制自己的密钥，留给下一步填写。</p><div class="tutorial-actions">${external("keys", "打开 API keys")}</div><p>密钥不要发到群聊、截图或实验报告中。</p>`,
      `<p>填写自己的 API Key，测试成功后保存。</p><div class="tutorial-reference"><span>API 地址</span><code>${deepseekPreset.endpoint}</code><span>模型名称</span><code>${deepseekPreset.model}</code></div><button class="button secondary" data-ai="tutorial-preset">填入推荐参数</button><div id="tutorial-config-mount"></div><p>“测试连接”会调用一次所配置的模型，可能产生少量费用。</p><details><summary>遇到问题</summary><dl><dt>401 · 认证失败</dt><dd>核对密钥是否完整、仍有效，以及服务地址是否对应。</dd><dt>402 · 余额不足</dt><dd>在开放平台核对 API 余额。</dd><dt>429 · 请求过多</dt><dd>等待后重试，减少同时发起的任务。</dd><dt>连接失败或超时</dt><dd>核对网络与 API 地址。500 / 503 可稍后重试。</dd></dl>${external("errors", "查看官方错误码")}</details>`,
    ];
    panel.innerHTML = `<div class="tutorial-heading"><h3>DeepSeek 配置教程</h3><button class="button secondary" data-ai="tutorial-close">返回配置</button></div><nav class="tutorial-steps" aria-label="教程步骤">${tutorialSteps.map((label, n) => `<button data-ai="tutorial-step-${n}" class="tutorial-step" ${n === this.step ? 'aria-current="step"' : ""}><span>${this.completed.includes(n) ? "✓" : n + 1}</span>${label}</button>`).join("")}</nav><p class="tutorial-progress">已阅读 ${this.completed.length} / 4 步</p><section aria-label="当前步骤"><h3 tabindex="-1" id="tutorial-title">${tutorialSteps[this.step]}</h3>${lessons[this.step]}</section><div class="tutorial-actions tutorial-navigation"><button class="button secondary" data-ai="tutorial-prev" ${this.step === 0 ? "disabled" : ""}>上一步</button><button class="button" data-ai="tutorial-next">${this.step === 3 ? "阅读完成，返回配置" : "我已完成，下一步"}</button></div><div class="tutorial-actions tutorial-sources"><button class="button secondary" data-ai="tutorial-reset">重新阅读</button>${external("docs", "官方文档")}</div>`;
    if (this.step === 3) panel.querySelector("#tutorial-config-mount")!.append(this.sheet.querySelector("#ai-config-fields")!);
    panel.querySelector<HTMLElement>("#tutorial-title")!.focus({ preventScroll: true });
    this.sheet.querySelector(".report-body")!.scrollTop = 0;
  }
}
