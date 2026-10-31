import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const adb = "E:/tools/app-maker/android-sdk/platform-tools/adb.exe",
  serial = "emulator-5560";
const run = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [],
  requests = [];
let mode = "ok",
  socket,
  sequence = 0;
const jobs = new Map();
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (x) => (body += x));
  req.on("end", () => {
    requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    const reply = () => {
      if (res.destroyed) return;
      if (mode === "unauthorized") {
        res.writeHead(401);
        res.end("do not echo secrets");
        return;
      }
      if (mode === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:58440/stolen" });
        res.end();
        return;
      }
      const content =
        mode === "empty"
          ? ""
          : mode === "ocr"
            ? JSON.stringify({
                data: { M_mH: 72.3 },
                warnings: { M_mH: "模拟识别，请核对" },
              })
            : mode === "quiz"
              ? JSON.stringify({
                  answers: [
                    "磁通量变化引起感应电动势，瞬态电流通过电流计产生偏转。",
                  ],
                })
              : mode === "polish"
                ? "磁通量发生变化时，探测线圈中产生感应电动势；电流计的偏转可反映通过的电荷量。"
                : "OK";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    };
    if (mode === "slow") setTimeout(reply, 1500);
    else reply();
  });
});
// Report generation can take > 10 seconds between mock calls. Keep the mock
// connection alive; automatic retries are deliberately disabled in the app.
server.keepAliveTimeout = 600000;
server.headersTimeout = 610000;
await new Promise((r) => server.listen(58440, "127.0.0.1", r));
function call(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const native = (method, args) =>
  evaluate(
    `Capacitor.nativePromise('LabAI',${JSON.stringify(method)},${JSON.stringify(args)}).then(value=>({ok:true,value}),e=>({ok:false,message:e.message,code:e.code}))`,
  );
async function wait(expression) {
  for (let i = 0; i < 120; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error("Timed out " + expression);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
const key = "dummy-mobile-ai-key-not-real-72f52";
try {
  run("reverse", "tcp:58440", "tcp:58440");
  run("logcat", "-c");
  for (let i = 0; i < 60; i++) {
    try {
      const pid = run("shell", "pidof", "com.labmaker.app")
        .trim()
        .split(/\s/)[0];
      run(
        "forward",
        "tcp:9227",
        "localabstract:webview_devtools_remote_" + pid,
      );
      const targets = await (await fetch("http://127.0.0.1:9227/json")).json();
      const target = targets.find((t) =>
        t.url.startsWith("https://localhost/"),
      );
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        socket.addEventListener("open", r, { once: true });
        socket.addEventListener("error", j, { once: true });
      });
      break;
    } catch (e) {
      if (i === 59) throw e;
      await pause(500);
    }
  }
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (jobs.has(m.id)) {
      const j = jobs.get(m.id);
      jobs.delete(m.id);
      m.error ? j.reject(Error(m.error.message)) : j.resolve(m.result);
    }
  });
  await wait("!!document.querySelector('.app-header')");
  assert.equal(
    (
      await native("configure", {
        slot: "chat",
        endpoint: "http://192.168.1.10",
        model: "test",
        key,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await native("configure", {
        slot: "chat",
        endpoint: "https://example.com?key=bad",
        model: "test",
        key,
      })
    ).ok,
    false,
  );
  let r = await native("configure", {
    slot: "chat",
    endpoint: "http://127.0.0.1:58440",
    model: "mock-model",
    key,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  r = await native("status", { slot: "chat" });
  assert.equal(r.value.hasKey, true);
  assert.equal(JSON.stringify(r).includes(key), false);
  assert.equal(
    (
      await native("configure", {
        slot: "chat",
        endpoint: "https://api.deepseek.com",
        model: "test",
        key: "",
      })
    ).ok,
    false,
  );
  checks.push(
    "encrypted config, redacted status, endpoint validation and key/address binding",
  );
  const request = () =>
    native("complete", {
      slot: "chat",
      id: crypto.randomUUID(),
      messages: [{ role: "user", content: "mock test" }],
    });
  r = await request();
  assert.equal(r.value.text, "OK");
  assert.equal(requests.at(-1).path, "/chat/completions");
  assert.equal(requests.at(-1).authorization, "Bearer " + key);
  mode = "unauthorized";
  r = await request();
  assert.equal(r.code, "HTTP_401");
  assert.match(r.message, /密钥/);
  mode = "empty";
  r = await request();
  assert.equal(r.code, "EMPTY");
  mode = "redirect";
  const count = requests.length;
  r = await request();
  assert.equal(r.code, "HTTP_302");
  assert.equal(requests.length, count + 1);
  checks.push(
    "native completion, 401 reason, empty response, redirect not followed",
  );
  mode = "slow";
  await evaluate(
    "window.aiPending=Capacitor.nativePromise('LabAI','complete',{slot:'chat',id:'cancel-test-123',messages:[{role:'user',content:'test'}]}).then(()=>({ok:true}),e=>({ok:false,code:e.code}));true",
  );
  await pause(100);
  await native("cancel", { id: "cancel-test-123" });
  r = await evaluate("window.aiPending");
  assert.equal(r.code, "CANCELLED");
  await evaluate(
    "window.aiPending=Capacitor.nativePromise('LabAI','complete',{slot:'chat',id:'stale-test-123',messages:[{role:'user',content:'test'}]}).then(()=>({ok:true}),e=>({ok:false,code:e.code}));true",
  );
  await pause(100);
  await native("configure", {
    slot: "chat",
    endpoint: "http://127.0.0.1:58440",
    model: "changed",
    key: "",
  });
  r = await evaluate("window.aiPending");
  assert.equal(r.code, "CANCELLED");
  checks.push("manual cancel and stale request rejected after config change");
  const encrypted = run(
    "shell",
    "run-as",
    "com.labmaker.app",
    "cat",
    "shared_prefs/ai-v1.xml",
  );
  assert.equal(encrypted.includes(key), false);
  assert.equal(encrypted.includes("mock-model"), false);
  const logs = run("logcat", "-d");
  assert.equal(logs.includes(key), false);
  checks.push(
    "private preferences and native logs contain no plaintext dummy key",
  );
  await evaluate("location.hash='/settings'");
  await wait("!!document.querySelector('[data-action=\"ai-config\"]')");
  await click('[data-action="ai-config"]');
  await wait(
    "document.querySelector('#ai-key-state').textContent.includes('已加密保存')",
  );
  assert.equal(await evaluate("document.querySelector('#ai-key').value"), "");
  fs.writeFileSync(
    "artifacts/verification/ai-config.png",
    execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
  await click('[data-ai="close"]');
  const catalog = JSON.parse(
    fs.readFileSync("src/data/catalog.json"),
  ).experiments;
  const exp = catalog.find((e) => e.name.includes("直螺线管"));
  const fixture = JSON.parse(
    fs.readFileSync("tests/fixtures/measurements.json"),
  )[exp.id];
  const picture = fs
    .readFileSync("artifacts/report-tests/local-photo.png")
    .toString("base64");
  await native("configure", {
    slot: "vision",
    endpoint: "http://127.0.0.1:58440",
    model: "mock-vision",
    key,
  });
  await evaluate(`location.hash='/experiment/${exp.id}'`);
  await wait("!!document.querySelector('#data-picker')");
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(fixture))}],'data.json',{type:'application/json'}));const input=document.querySelector('#data-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#modal').open");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='已导入并保存到本机'",
  );
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob('${picture}'),c=>c.charCodeAt(0))],'photo.png',{type:'image/png'}));const input=document.querySelector('#photo-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#toast').textContent==='原始照片已保存'");
  mode = "ocr";
  await click('[data-action="ocr"]');
  await click('[data-ai="recognize"]');
  await wait("!!document.querySelector('[data-ocr-key]')");
  assert.equal(
    await evaluate("document.querySelector('[data-ocr-key]').checked"),
    false,
  );
  assert.ok(
    requests
      .at(-1)
      .body.messages[1].content[1].image_url.url.startsWith(
        "data:image/jpeg;base64,",
      ),
  );
  await click("[data-ocr-key]");
  await click('[data-ai="apply"]');
  await wait("!document.querySelector('#ai-sheet').open");
  assert.equal(
    await evaluate("document.querySelector('input[data-key=\"M_mH\"]').value"),
    String(fixture.M_mH),
  );
  await click('[data-action="ocr"]');
  await click('[data-ai="recognize"]');
  await wait("!!document.querySelector('[data-ocr-key]')");
  await click("[data-ocr-key]");
  await click("#ocr-empty");
  await click('[data-ai="apply"]');
  await wait("!document.querySelector('#ai-sheet').open");
  assert.equal(
    await evaluate("document.querySelector('input[data-key=\"M_mH\"]').value"),
    "72.3",
  );
  checks.push(
    "actual stored photo resized and sent, uncertain field opt-in, only-empty preserves, explicit overwrite saves",
  );
  // Restore official sample for report checks.
  await evaluate(
    `(()=>{const input=document.querySelector('input[data-key="M_mH"]');input.value=${JSON.stringify(String(fixture.M_mH))};input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click("#open-report");
  await wait("document.querySelector('#report-sheet').open");
  await click('[data-report-tab="ai"]');
  mode = "quiz";
  await evaluate(
    "document.querySelector('#ai-questions').value='简述冲击法测量磁场的原理。'",
  );
  await click('[data-report="ai-quiz"]');
  await wait("!!document.querySelector('#ai-result-text')");
  await click('[data-report="ai-import"]');
  await wait(
    "document.querySelector('#report-state').textContent.includes('已保存到本实验')",
  );
  await click('[data-report="generate"]');
  for (let i = 0; i < 1600; i++) {
    const state = await evaluate(
      "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
    );
    if (state.error) throw Error(state.text);
    if (state.text.startsWith("报告已生成")) break;
    if (i === 1599) throw Error("Report timeout");
    await pause(100);
  }
  await click('[data-report-tab="ai"]');
  mode = "polish";
  await evaluate("document.querySelector('#ai-section').value='实验原理'");
  await click('[data-report="ai-polish"]');
  await wait("!!document.querySelector('#ai-result-text')");
  await click('[data-report="ai-import"]');
  await wait(
    "document.querySelector('#report-state').textContent.includes('已保存到本实验')",
  );
  await click('[data-report="generate"]');
  for (let i = 0; i < 1600; i++) {
    const state = await evaluate(
      "({text:document.querySelector('#report-state').textContent,error:document.querySelector('#report-state').classList.contains('error')})",
    );
    if (state.error) throw Error(state.text);
    if (state.text.startsWith("报告已生成")) break;
    if (i === 1599) throw Error("Report timeout");
    await pause(100);
  }
  // Inspect actual generated DOCX, not just UI messages.
  const metadataRaw = run(
    "shell",
    "run-as",
    "com.labmaker.app",
    "cat",
    `files/lab-maker/v1/report-${exp.id}-a.json`,
  );
  const envelope = JSON.parse(metadataRaw);
  fs.writeFileSync(
    "artifacts/verification/ai-report-metadata.json",
    metadataRaw,
  );
  const saved = envelope.value ?? envelope.data ?? envelope.payload;
  if (!saved)
    throw Error("Inspect report envelope format: " + Object.keys(envelope));
  const docx = execFileSync(
    adb,
    [
      "-s",
      serial,
      "exec-out",
      "run-as",
      "com.labmaker.app",
      "cat",
      `files/lab-maker/v1/reports/${exp.id}/${saved.generation}/report.docx`,
    ],
    { windowsHide: true, maxBuffer: 24 * 1024 * 1024 },
  );
  fs.writeFileSync("artifacts/verification/ai-generated-report.docx", docx);
  const verified = execFileSync(
    "E:/apps/xdu-labreport-writer-master/python-runtime/python.exe",
    [
      "-c",
      `from zipfile import ZipFile
from xml.etree import ElementTree as E
with ZipFile('artifacts/verification/ai-generated-report.docx') as z:r=E.fromstring(z.read('word/document.xml'))
t=''.join(r.itertext())
for s in ['简述冲击法测量磁场的原理。','磁通量变化引起感应电动势，瞬态电流通过电流计产生偏转。','磁通量发生变化时，探测线圈中产生感应电动势；电流计的偏转可反映通过的电荷量。']:assert t.count(s)==1,(s,t.count(s))
assert len(r.findall('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath'))>0
print('Verified quiz, answer, polished section exactly once; editable formulas retained')`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.match(verified, /Verified/);
  checks.push(
    "custom question and chapter polish explicitly imported and regenerated on-device",
  );
  await evaluate(
    `(()=>{const input=document.querySelector('input[data-key="M_mH"]');input.value='71.3';input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click('[data-report="generate"]');
  await wait(
    "document.querySelector('#report-state').textContent.includes('旧 AI 内容不可用于新报告')",
  );
  await evaluate(
    `(()=>{const input=document.querySelector('input[data-key="M_mH"]');input.value=${JSON.stringify(String(fixture.M_mH))};input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  checks.push(
    "measurement changes block stale AI imports before report generation",
  );
  await click('[data-report-tab="ai"]');
  fs.writeFileSync(
    "artifacts/verification/ai-report.png",
    execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 640,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(300);
  assert.equal(
    await evaluate(
      'document.querySelector("#report-sheet").scrollWidth<=document.querySelector("#report-sheet").clientWidth',
    ),
    true,
  );
  const shot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    "artifacts/verification/ai-report-small.png",
    Buffer.from(shot.data, "base64"),
  );
  await call("Emulation.clearDeviceMetricsOverride", {});
  await click('[data-report="close"]');
  await native("clear", { slot: "vision" });
  mode = "ok";
  await native("clear", { slot: "chat" });
  assert.equal((await native("status", { slot: "chat" })).value.hasKey, false);
  checks.push("green native config UI, no secret echo, explicit clear");
  fs.writeFileSync(
    "artifacts/verification/ai-native.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        mocked: true,
        realPaidCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  fs.writeFileSync(
    "artifacts/verification/ai-failure.json",
    JSON.stringify(
      {
        error: String(error),
        state: await evaluate(
          'document.querySelector("#report-sheet")?.innerText',
        ).catch(() => null),
        requests: requests.map((r) => ({ path: r.path, model: r.body.model })),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  socket?.close();
  server.closeAllConnections();
  server.close();
  run("reverse", "--remove", "tcp:58440");
}
