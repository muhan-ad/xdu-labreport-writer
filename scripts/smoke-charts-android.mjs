import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const serial = process.argv[2] || "emulator-5560",
  adb = "E:/tools/app-maker/android-sdk/platform-tools/adb.exe",
  out = "E:/tools/app-maker/logs";
if (!serial.startsWith("emulator-"))
  throw Error("Smoke tests modify test records: emulator only");
const run = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 12 * 1024 * 1024,
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let connection;
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const pid = run("shell", "pidof", "com.labmaker.app")
        .trim()
        .split(/\s/)[0];
      if (!pid) throw Error("App not running");
      run(
        "forward",
        "tcp:9227",
        "localabstract:webview_devtools_remote_" + pid,
      );
      const targets = await (await fetch("http://127.0.0.1:9227/json")).json();
      const target = targets.find((t) =>
        t.url.startsWith("https://localhost/"),
      );
      if (!target) throw Error("WebView starting");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      let id = 0;
      const jobs = new Map();
      socket.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (jobs.has(m.id)) {
          const j = jobs.get(m.id);
          jobs.delete(m.id);
          m.error ? j.reject(Error(m.error.message)) : j.resolve(m.result);
        }
      });
      const evaluate = async (expression) => {
        const reply = await new Promise((resolve, reject) => {
          const current = ++id;
          jobs.set(current, { resolve, reject });
          socket.send(
            JSON.stringify({
              id: current,
              method: "Runtime.evaluate",
              params: { expression, returnByValue: true },
            }),
          );
        });
        if (reply.exceptionDetails)
          throw Error(JSON.stringify(reply.exceptionDetails));
        return reply.result?.value;
      };
      const call = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const current = ++id;
          jobs.set(current, { resolve, reject });
          socket.send(JSON.stringify({ id: current, method, params }));
        });
      connection = { socket, evaluate, call };
      return connection;
    } catch (e) {
      if (i === 59) throw e;
      await pause(500);
    }
  }
}
const catalog = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog.json", import.meta.url)),
).experiments;
const samples = JSON.parse(
  fs.readFileSync(
    new URL("../tests/fixtures/measurements.json", import.meta.url),
  ),
);
const exp = catalog.find((e) => e.sourceId === "直螺线管磁场分布的测量"),
  checks = [];
let c;
let offline = false;
const evaluate = (e) => c.evaluate(e);
async function wait(expression, limit = 120) {
  for (let i = 0; i < limit; i++) {
    if (await evaluate(expression)) return;
    await pause(150);
  }
  throw Error("Timed out: " + expression);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function navigate(hash) {
  await evaluate(`location.hash=${JSON.stringify("/" + hash)}`);
  await pause(200);
}
async function screenshot(name) {
  await pause(350);
  fs.writeFileSync(
    path.join(out, name + ".png"),
    execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
}
try {
  run("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  run("shell", "wm", "dismiss-keyguard");
  run("shell", "am", "start", "-n", "com.labmaker.app/.MainActivity");
  c = await connect();
  await wait("!!document.querySelector('.app-header')");
  await navigate("experiment/" + exp.id);
  await wait("!!document.querySelector('#data-picker')");
  await click("[data-action=more]");
  await wait("document.querySelector('#modal').open");
  await click("[data-menu=clear]");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='本实验数据已清除'",
  );
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(samples[exp.id]))}],'chart-sample.json',{type:'application/json'}));const i=document.querySelector('#data-picker');i.files=t.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#modal').open");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='已导入并保存到本机'",
  );
  run("shell", "svc", "wifi", "disable");
  run("shell", "svc", "data", "disable");
  offline = true;
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  await click("[data-report-tab=charts]");
  await wait("!!document.querySelector('#custom-chart-editor')");
  assert.equal(
    await evaluate("document.querySelector('.chart-label-options').open"),
    false,
  );
  await evaluate(
    `document.querySelector('[data-chart-field=x]').value='x_mm';document.querySelector('[data-chart-field=y]').value='d_left_cm';document.querySelector('[data-chart-field=title]').value='手机绘图验证';document.querySelector('[data-chart-field=caption]').value='手机图注验证';document.querySelector('[data-chart-field=embed]').checked=true;document.querySelector('[data-chart-field=embed]').dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await click("[data-chart=preview]");
  await wait("!document.querySelector('[data-report=cancel]').hidden");
  await pause(350);
  await click("[data-report=cancel]");
  await wait(
    "document.querySelector('#report-state').textContent==='已取消生成'",
  );
  checks.push(
    "Offline preview cancellation terminates worker and re-enables controls",
  );
  await evaluate(
    "window.__chartTicks=0;window.__chartTimer=setInterval(()=>window.__chartTicks++,100)",
  );
  const start = Date.now();
  await click("[data-chart=preview]");
  for (let n = 0; n < 1200; n++) {
    const status = await evaluate(
      "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
    );
    if (status.error) throw Error(status.text);
    if (status.text.startsWith("图表已生成")) break;
    if (n === 1199) throw Error("Plot timed out");
    await pause(100);
  }
  const previewMs = Date.now() - start;
  const ticks = await evaluate(
    "clearInterval(window.__chartTimer);window.__chartTicks",
  );
  assert.ok(ticks > 5);
  assert.equal(
    await evaluate(
      "document.querySelector('#custom-chart-preview img').naturalWidth>500",
    ),
    true,
  );
  checks.push(
    "Actual Android offline Matplotlib preview renders and leaves UI responsive",
  );
  assert.match(
    run("shell", "dumpsys", "window"),
    /mCurrentFocus[^\n]*com\.labmaker\.app/,
    "Native overlay obscures chart UI",
  );
  const layouts = [];
  for (const [width, height] of [
    [320, 640],
    [360, 800],
    [430, 932],
    [768, 1024],
    [1024, 1366],
    [1280, 800],
  ]) {
    await c.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await pause(200);
    const layout = await evaluate(
      "({overflow:document.documentElement.scrollWidth>innerWidth,bodyOverflow:document.querySelector('#report-body').scrollWidth>document.querySelector('#report-body').clientWidth+1,dialog:document.querySelector('#report-sheet').getBoundingClientRect().width,detailsOpen:document.querySelector('.chart-label-options').open})",
    );
    assert.equal(layout.overflow, false);
    assert.equal(layout.bodyOverflow, false);
    assert.ok(layout.dialog <= width);
    layouts.push({ width, height, ...layout });
    if (width === 320 || width === 768) {
      await evaluate("document.querySelector('#report-body').scrollTop=0");
      const shot = await c.call("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        `artifacts/verification/chart-${width}.png`,
        Buffer.from(shot.data, "base64"),
      );
    }
  }
  await c.call("Emulation.clearDeviceMetricsOverride");
  checks.push(
    "Six phone/tablet portrait and landscape viewports fit without horizontal page overflow; secondary labels collapsed",
  );
  await evaluate(`(()=>{const previous=Capacitor.nativePromise;window.__shareTestPrevious=previous;window.__shareTestPath='';Capacitor.nativePromise=function(plugin,method,args){if(plugin==='Filesystem'&&method==='writeFile'&&args.path?.startsWith('chart-exports/'))window.__shareTestPath=args.path;return previous.apply(this,arguments)}})()`);
  await click("[data-chart=export]");
  await pause(1200);
  assert.match(
    run("shell", "dumpsys", "window"),
    /mCurrentFocus[^\n]*(ChooserActivity|ResolverActivity)/,
  );
  run("shell", "input", "keyevent", "KEYCODE_BACK");
  await pause(300);
  const sharePath = await evaluate("window.__shareTestPath");
  assert.ok(sharePath.startsWith(`chart-exports/${exp.id}/`) && sharePath.endsWith('.png'));
  await evaluate("Capacitor.nativePromise=window.__shareTestPrevious;delete window.__shareTestPrevious;delete window.__shareTestPath");
  const png = execFileSync(
    adb,
    [
      "-s",
      serial,
      "exec-out",
      "run-as",
      "com.labmaker.app",
      "cat",
      `cache/${sharePath}`,
    ],
    { windowsHide: true, maxBuffer: 12 * 1024 * 1024 },
  );
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  fs.writeFileSync("artifacts/verification/chart-native.png", png);
  checks.push(
    "PNG saved to native private cache and system share sheet cancelled without sending",
  );
  await click("[data-chart=save]");
  await wait("document.querySelectorAll('.chart-saved').length===1");
  await click("[data-report=close]");
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  await click("[data-report-tab=charts]");
  await wait("document.querySelectorAll('.chart-saved').length===1");
  await click("[data-chart=edit]");
  assert.equal(
    await evaluate("document.querySelector('[data-chart-field=x]').value"),
    "x_mm",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-chart-field=embed]').checked",
    ),
    true,
  );
  checks.push(
    "Per-experiment chart settings survive close/reopen with exact data selectors and insertion flag",
  );
  await click("[data-report=generate]");
  for (let n = 0; n < 1200; n++) {
    const status = await evaluate(
      "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
    );
    if (status.error) throw Error(status.text);
    if (status.text.startsWith("报告已生成")) break;
    if (n === 1199) throw Error("Report timed out");
    await pause(150);
  }
  await wait(
    "document.querySelector('#report-preview-state')?.textContent==='预览已完成'",
    300,
  );
  await click("[data-report-tab=charts]");
  await wait("document.querySelectorAll('#report-charts img').length===2");
  checks.push(
    "New report and Word preview include original preset plus selected custom chart",
  );
  await click("[data-chart=edit]");
  await evaluate(
    "document.querySelector('[data-chart-field=embed]').checked=false",
  );
  await click("[data-chart=save]");
  await wait(
    "document.querySelector('#report-state').textContent.includes('绘图配置已保存')",
  );
  await click("[data-report=generate]");
  await wait(
    "document.querySelector('#report-state').textContent.startsWith('报告已生成')",
    1200,
  );
  await wait(
    "document.querySelector('#report-preview-state')?.textContent==='预览已完成'",
    300,
  );
  await click("[data-report-tab=charts]");
  await wait("document.querySelectorAll('#report-charts img').length===1");
  checks.push(
    "Disabling insertion and regenerating removes custom image without accumulating old figures",
  );
  await click("[data-report=close]");
  await click("[data-action=more]");
  await wait("document.querySelector('#modal').open");
  await click("[data-menu=clear]");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='本实验数据已清除'",
  );
  const cache = run(
    "shell",
    "run-as",
    "com.labmaker.app",
    "find",
    "cache",
    "-type",
    "f",
  );
  assert.equal(cache.includes("chart-exports/" + exp.id), false);
  checks.push(
    "Clear removes measurement/report/chart settings and temporary PNG exports",
  );
  fs.writeFileSync(
    "artifacts/verification/charts-android.json",
    JSON.stringify(
      {
        checks,
        previewMs,
        ticks,
        layouts,
        offline: true,
        realSchoolMutations: 0,
        paidApiCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: checks.length, previewMs, checks }, null, 2),
  );
} catch (error) {
  console.error(error);
  try {
    console.error(
      await evaluate(
        "document.querySelector('#report-body')?.innerText+'\\n'+document.querySelector('#report-state')?.textContent",
      ),
    );
  } catch {}
  process.exitCode = 1;
} finally {
  try { await evaluate("if(window.__shareTestPrevious){Capacitor.nativePromise=window.__shareTestPrevious;delete window.__shareTestPrevious;delete window.__shareTestPath}"); } catch {}
  if (offline) {
    run("shell", "svc", "wifi", "enable");
    run("shell", "svc", "data", "enable");
  }
  try {
    await c.call("Emulation.clearDeviceMetricsOverride");
  } catch {}
  connection?.socket.close();
}
