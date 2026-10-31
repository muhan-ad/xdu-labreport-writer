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
      socket.addEventListener("close", () => {
        for (const j of jobs.values())
          j.reject(Error("WebView connection closed"));
        jobs.clear();
      });
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
const output = new URL(
  "../artifacts/report-tests/android-corpus/",
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
let c,
  offline = false;
const results = [];
const evaluate = (e) => c.evaluate(e);
async function wait(expression, limit = 200) {
  for (let i = 0; i < limit; i++) {
    if (await evaluate(expression)) return;
    await pause(150);
  }
  throw Error("Timeout " + expression);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function navigate(hash) {
  await evaluate(`location.hash=${JSON.stringify("/" + hash)}`);
  await pause(150);
}
try {
  run("shell", "am", "start", "-n", "com.labmaker.app/.MainActivity");
  c = await connect();
  await wait("!!document.querySelector('.app-header')");
  await navigate("profile");
  await wait("!!document.querySelector('[data-profile=name]')");
  for (const [key, value] of Object.entries({
    name: "移动端验证",
    studentId: "001234",
    className: "测试班",
  }))
    await evaluate(
      `(()=>{const input=document.querySelector('[data-profile=${key}]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await wait(
    "document.querySelector('#profile-save-state').textContent==='已保存到本机'",
  );
  run("shell", "svc", "wifi", "disable");
  run("shell", "svc", "data", "disable");
  offline = true;
  for (const exp of catalog) {
    const began = Date.now();
    try {
      await navigate("experiment/" + exp.id);
      await wait("!!document.querySelector('#data-picker')");
      await evaluate(
        `(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(samples[exp.id]))}],'sample.json',{type:'application/json'}));const input=document.querySelector('#data-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait("document.querySelector('#modal').open");
      await click("[data-dialog-confirm]");
      await wait(
        "document.querySelector('#toast').textContent==='已导入并保存到本机'",
      );
      await evaluate(
        "document.querySelector('#experiment-date').value='2026-10-22';document.querySelector('#experiment-date').dispatchEvent(new Event('input',{bubbles:true}))",
      );
      await click("#open-report");
      await wait("document.querySelector('#report-sheet').open");
      // Restore a deterministic chapter selection, including all sections. Quiz wording may vary by design.
      await evaluate(
        "document.querySelectorAll('[data-section]').forEach(input=>{input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});document.querySelectorAll('[data-variant]').forEach(input=>{input.value='0';input.dispatchEvent(new Event('change',{bubbles:true}));})",
      );
      await click("[data-report=generate]");
      for (let i = 0; i < 1200; i++) {
        const state = await evaluate(
          "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
        );
        if (state.error) throw Error(state.text);
        if (state.text.startsWith("报告已生成")) break;
        if (i === 1199) throw Error("Generation timeout");
        await pause(150);
      }
      await wait(
        "document.querySelector('#report-preview-state')?.textContent==='预览已完成'",
        400,
      );
      const metadata = JSON.parse(
        run(
          "shell",
          "run-as",
          "com.labmaker.app",
          "cat",
          "files/lab-maker/v1/report-" + exp.id + "-b.json",
        ),
      ).payload;
      const frames = (await c.call("Page.getFrameTree")).frameTree.childFrames;
      const frame = frames.find((f) =>
        f.frame.url.includes("/preview/index.html"),
      );
      const world = await c.call("Page.createIsolatedWorld", {
        frameId: frame.frame.id,
        worldName: "corpus-read",
      });
      const rendered = await c.call("Runtime.evaluate", {
        expression:
          "({math:document.querySelectorAll('math').length,text:document.body.innerText})",
        contextId: world.executionContextId,
        returnByValue: true,
      });
      assert.equal(
        rendered.result.value.math,
        metadata.formulaCount,
        "Every editable equation must appear in preview",
      );
      assert.ok(rendered.result.value.text.includes("移动端验证"));
      const docx = execFileSync(
        adb,
        [
          "-s",
          serial,
          "exec-out",
          "run-as",
          "com.labmaker.app",
          "cat",
          `files/lab-maker/v1/reports/${exp.id}/${metadata.generation}/report.docx`,
        ],
        { windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
      );
      assert.equal(docx[0], 0x50);
      fs.writeFileSync(new URL(exp.id + ".docx", output), docx);
      await click("[data-report-tab=charts]");
      if (metadata.charts.length) {
        await wait(
          `document.querySelectorAll('#report-charts img').length===${metadata.charts.length}`,
        );
        await wait(
          "Array.from(document.querySelectorAll('#report-charts img')).every(i=>i.complete&&i.naturalWidth>0)",
        );
      }
      await click("[data-report=close]");
      results.push({
        id: exp.id,
        name: exp.name,
        result: "PASS",
        elapsedMs: Date.now() - began,
        bytes: docx.length,
        formulaCount: metadata.formulaCount,
        renderedMath: rendered.result.value.math,
        charts: metadata.charts.length,
      });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      results.push({
        id: exp.id,
        name: exp.name,
        result: "FAIL",
        error: String(error),
      });
      console.error(JSON.stringify(results.at(-1)));
      try {
        await click("[data-report=close]");
      } catch {}
    }
    fs.writeFileSync(
      new URL("results.json", output),
      JSON.stringify({ version: "0.2.0", offline: true, results }, null, 2),
    );
  }
  assert.equal(results.length, 28);
  assert.ok(
    results.every((r) => r.result === "PASS"),
    "Android report corpus has failures",
  );
  console.log("All 28 Android offline reports and previews passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (offline) {
    run("shell", "svc", "wifi", "enable");
    run("shell", "svc", "data", "enable");
  }
  connection?.socket.close();
  try {
    run("forward", "--remove", "tcp:9227");
  } catch {}
}
