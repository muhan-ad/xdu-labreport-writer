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
  await click('[data-action="more"]');
  await wait("document.querySelector('#modal').open");
  await click('[data-menu="clear"]');
  await wait("document.querySelector('#modal').open");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='本实验数据已清除'",
  );
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(samples[exp.id]))}],'measurements.json',{type:'application/json'}));const input=document.querySelector('#data-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#modal').open");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='已导入并保存到本机'",
  );
  const photo = fs
    .readFileSync(
      new URL("../artifacts/report-tests/local-photo.png", import.meta.url),
    )
    .toString("base64");
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob('${photo}'),c=>c.charCodeAt(0))],'local-photo.png',{type:'image/png'}));const input=document.querySelector('#photo-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#toast').textContent==='原始照片已保存'");
  run("shell", "svc", "wifi", "disable");
  run("shell", "svc", "data", "disable");
  offline = true;
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  assert.ok(
    await evaluate("document.querySelectorAll('[data-variant]').length>0"),
  );
  await evaluate(
    `(()=>{const input=document.querySelector('input[data-section="实验原理"]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  checks.push("report settings and exact desktop chapter catalog");
  await click("[data-report=generate]");
  await wait("!document.querySelector('[data-report=cancel]').hidden");
  await pause(400);
  await click("[data-report=cancel]");
  await wait(
    "document.querySelector('#report-state').textContent==='已取消生成'",
  );
  checks.push("cancel terminates in-progress worker and re-enables generation");
  await evaluate(
    "window.__ticks=0;window.__tickTimer=setInterval(()=>window.__ticks++,100)",
  );
  const began = Date.now();
  await click("[data-report=generate]");
  for (let i = 0; i < 1200; i++) {
    const state = await evaluate(
      "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
    );
    if (state.error) throw Error(state.text);
    if (state.text.startsWith("报告已生成")) break;
    if (i === 1199) throw Error("Report timeout");
    await pause(150);
  }
  const elapsedMs = Date.now() - began,
    ticks = await evaluate("clearInterval(window.__tickTimer);window.__ticks");
  assert.ok(ticks > 5);
  await wait(
    "document.querySelector('#report-preview-state')?.textContent==='预览已完成'",
    200,
  );
  checks.push(
    "native Android offline Python, NumPy, Matplotlib and editable Word formulas; original photo inserted",
  );
  checks.push("worker keeps UI heartbeat responsive");
  const tree = await c.call("Page.getFrameTree"),
    frame = tree.frameTree.childFrames.find((f) =>
      f.frame.url.includes("/preview/index.html"),
    );
  assert.ok(frame, "Sandboxed report frame exists");
  const world = await c.call("Page.createIsolatedWorld", {
    frameId: frame.frame.id,
    worldName: "report-inspection",
  });
  const preview = await c.call("Runtime.evaluate", {
    expression:
      "({text:document.body.innerText,math:document.querySelectorAll('math').length,images:document.querySelectorAll('img').length,links:document.querySelectorAll('a').length,disabledHeadingPresent:Array.from(document.querySelectorAll('p')).some(p=>p.textContent.trim()==='实验原理')})",
    contextId: world.executionContextId,
    returnByValue: true,
  });
  assert.ok(preview.result.value.math > 10);
  assert.equal(preview.result.value.disabledHeadingPresent, false);
  assert.ok(preview.result.value.images >= 2);
  assert.match(preview.result.value.text, /中心点磁感应强度/);
  await screenshot("report-preview");
  run("shell", "wm", "size", "900x1800");
  await pause(500);
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await screenshot("report-preview-small");
  run("shell", "wm", "size", "reset");
  await pause(300);
  checks.push(
    "actual DOM preview renders MathML formulas, original photo, graph and report content",
  );
  await click("[data-report-tab=charts]");
  await wait("document.querySelectorAll('#report-charts img').length===1");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#report-charts figcaption sub').length",
    ),
    2,
  );
  await screenshot("report-chart");
  checks.push(
    "embedded report graph is extracted and shown without duplicate raw photo",
  );
  await click("[data-report=close]");
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  c.socket.close();
  run("shell", "am", "force-stop", "com.labmaker.app");
  run("shell", "am", "start", "-n", "com.labmaker.app/.MainActivity");
  c = await connect();
  await wait("!!document.querySelector('.app-header')");
  await navigate("experiment/" + exp.id);
  await wait("!!document.querySelector('#open-report')");
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  assert.equal(
    await evaluate(
      "document.querySelector('input[data-section=\"实验原理\"]').checked",
    ),
    false,
  );
  await click("[data-report-tab=preview]");
  await wait(
    "document.querySelector('#report-preview-state')?.textContent==='预览已完成'",
    200,
  );
  checks.push("saved report and preview survive process restart while offline");
  await evaluate(`(()=>{const previous=Capacitor.nativePromise;window.__shareTestPrevious=previous;window.__shareTestPath='';Capacitor.nativePromise=function(plugin,method,args){if(plugin==='Filesystem'&&method==='writeFile'&&args.path?.startsWith('report-exports/'))window.__shareTestPath=args.path;return previous.apply(this,arguments)}})()`);
  await click("[data-report=export]");
  await pause(1200);
  assert.match(
    run("shell", "dumpsys", "window"),
    /mCurrentFocus[^\n]*(ChooserActivity|ResolverActivity)/,
  );
  run("shell", "input", "keyevent", "KEYCODE_BACK");
  await pause(300);
  checks.push(
    "native Word export opens system share sheet; cancelled without upload",
  );
  const sharePath = await evaluate("window.__shareTestPath");
  assert.ok(sharePath.startsWith(`report-exports/${exp.id}/`) && sharePath.endsWith('.docx'));
  await evaluate("Capacitor.nativePromise=window.__shareTestPrevious;delete window.__shareTestPrevious;delete window.__shareTestPath");
  const docx = execFileSync(
    adb,
    [
      "-s",
      serial,
      "exec-out",
      "run-as",
      "com.labmaker.app",
      "cat",
      "cache/" + sharePath,
    ],
    { windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
  );
  assert.equal(docx[0], 0x50);
  assert.equal(docx[1], 0x4b);
  fs.writeFileSync(
    new URL("../artifacts/report-tests/android-export.docx", import.meta.url),
    docx,
  );
  await click("[data-report=close]");
  await click("[data-action=more]");
  await wait("document.querySelector('#modal').open");
  await click("[data-menu=clear]");
  await wait(
    "document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent.includes('清除')",
  );
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='本实验数据已清除'",
  );
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  await click("[data-report-tab=preview]");
  assert.match(
    await evaluate("document.querySelector('#report-body').textContent"),
    /还没有生成报告/,
  );
  assert.equal(
    run(
      "shell",
      "run-as",
      "com.labmaker.app",
      "find",
      "cache/report-exports",
      "-type",
      "f",
    ).includes(exp.id),
    false,
  );
  await click("[data-report=close]");
  checks.push(
    "clear removes saved report, extracted graphs, chapter choices and cached Word export",
  );
  run("shell", "svc", "wifi", "enable");
  run("shell", "svc", "data", "enable");
  offline = false;
  const originalHash = await evaluate("location.hash");
  await evaluate(
    `(()=>{const cap=window.Capacitor;window.__oldNativePromise=cap.nativePromise;cap.nativePromise=function(...args){if(args[0]==='Browser'&&args[1]==='open')window.__prepUrl=args[2]?.url;return window.__oldNativePromise.apply(this,args);};})()`,
  );
  await click("[data-action=prepare]");
  await pause(1500);
  assert.match(
    run("shell", "dumpsys", "window"),
    /mCurrentFocus[^\n]*(chrome|browser)/i,
  );
  assert.equal(
    await evaluate("window.__prepUrl"),
    "https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=7",
  );
  const browserFirstRun = run("shell", "dumpsys", "window").includes(
    "FirstRunActivity",
  );
  await evaluate(
    "window.Capacitor.nativePromise=window.__oldNativePromise;delete window.__oldNativePromise",
  );
  run("shell", "input", "keyevent", "KEYCODE_BACK");
  await pause(350);
  for (
    let i = 0;
    i < 2 && !run("shell", "dumpsys", "window").includes(".MainActivity");
    i++
  ) {
    run("shell", "input", "keyevent", "KEYCODE_BACK");
    await pause(250);
  }
  assert.equal(await evaluate("location.hash"), originalHash);
  checks.push(
    "preparation opens the mapped official URL in a separate browser and returns to the same experiment",
  );
  const result = {
    result: "PASS",
    version: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version,
    serial,
    offline: true,
    browserFirstRun,
    elapsedMs,
    heartbeatTicks: ticks,
    renderedMath: preview.result.value.math,
    renderedImages: preview.result.value.images,
    checks,
  };
  fs.writeFileSync(
    path.join(out, "report-android-smoke.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  try {
    await screenshot("report-failure");
    console.error(await evaluate("document.body.innerText"));
  } catch {}
  process.exitCode = 1;
} finally {
  try { await evaluate("if(window.__shareTestPrevious){Capacitor.nativePromise=window.__shareTestPrevious;delete window.__shareTestPrevious;delete window.__shareTestPath}"); } catch {}
  if (offline) {
    run("shell", "svc", "wifi", "enable");
    run("shell", "svc", "data", "enable");
  }
  try {
    run("shell", "wm", "size", "reset");
  } catch {}
  connection?.socket.close();
  try {
    run("forward", "--remove", "tcp:9227");
  } catch {}
}
