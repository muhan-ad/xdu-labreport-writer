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
      connection = { socket, evaluate };
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
const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../tests/fixtures/measurements.json", import.meta.url),
  ),
);
const photos =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const checks = [];
let c;
const evaluate = (expression) => c.evaluate(expression);
async function wait(expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(expression)) return;
    await pause(150);
  }
  throw Error("Timed out: " + expression);
}
async function navigate(hash) {
  await evaluate(`location.hash=${JSON.stringify("/" + hash)}`);
  await pause(150);
}
async function fill(selector, value) {
  await evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function capture(name) {
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
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  await click("[data-category=all]");
  await fill("#search", "");
  await wait("document.querySelectorAll('.experiment-card').length===28");
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await capture("base-home");
  checks.push("28 offline experiments; no page overflow");
  await click('[data-category="mechanics"]');
  assert.equal(
    await evaluate("document.querySelectorAll('.experiment-card').length"),
    4,
  );
  await fill("#search", "刚体");
  assert.equal(
    await evaluate("document.querySelectorAll('.experiment-card').length"),
    1,
  );
  checks.push("category and search intersection");
  const gravity = catalog.find((e) =>
    e.schema.groups.some((g) => g.fields.some((f) => f.displayTranspose)),
  );
  await navigate("experiment/" + gravity.id);
  await wait("!!document.querySelector('.table-scroll')");
  const trans = gravity.schema.groups
    .flatMap((g) => g.fields)
    .find((f) => f.displayTranspose);
  assert.equal(
    await evaluate(
      `document.querySelector('#field-${trans.key} tbody').children.length`,
    ),
    8,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('#field-${trans.key} input[data-row="8"][data-col="7"]').length`,
    ),
    1,
  );
  checks.push("gravity transposed 8 by 9 view retains original indexes");
  const e = catalog.find((e) =>
    e.schema.groups.some((g) => g.fields.some((f) => f.type === "science")),
  );
  await navigate("experiment/" + e.id);
  await wait("!!document.querySelector('[data-part=mantissa]')");
  const sc = e.schema.groups
    .flatMap((g) => g.fields)
    .find((f) => f.type === "science");
  await fill(`[data-key="${sc.key}"][data-part="mantissa"]`, "2.7");
  await fill(`[data-key="${sc.key}"][data-part="exponent"]`, "-9");
  const scalar = e.schema.groups
    .flatMap((g) => g.fields)
    .find((f) => f.type === "number");
  await fill(`[data-key="${scalar.key}"]`, "0");
  await wait(
    "document.querySelector('#save-state').textContent==='已保存到本机'",
  );
  await capture("base-editor");
  await click('[data-action="validate"]');
  await wait("document.querySelector('#modal').open");
  assert.match(
    await evaluate("document.querySelector('#modal').textContent"),
    /检查/,
  );
  run("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait("!document.querySelector('#modal').open");
  checks.push(
    "science notation, zero input, validation and Android back closes dialog",
  );
  await navigate("profile");
  await wait("!!document.querySelector('[data-profile=name]')");
  await fill('[data-profile="name"]', "本地测试");
  await fill('[data-profile="studentId"]', "001234");
  await wait(
    "document.querySelector('#profile-save-state').textContent==='已保存到本机'",
  );
  c.socket.close();
  run("shell", "am", "force-stop", "com.labmaker.app");
  run("shell", "am", "start", "-n", "com.labmaker.app/.MainActivity");
  c = await connect();
  await wait("!!document.querySelector('.app-header')");
  await navigate("profile");
  await wait("!!document.querySelector('[data-profile=name]')");
  assert.equal(
    await evaluate("document.querySelector('[data-profile=studentId]').value"),
    "001234",
  );
  await navigate("experiment/" + e.id);
  await wait("!!document.querySelector('[data-part=mantissa]')");
  assert.equal(
    await evaluate(
      `document.querySelector('[data-key="${scalar.key}"]').value`,
    ),
    "0",
  );
  assert.equal(
    await evaluate("document.querySelector('[data-part=exponent]').value"),
    "-9",
  );
  checks.push(
    "native private-file persistence across process restart; student ID retains leading zeros",
  );
  // Exercise the native photo storage and WebView local-file output, without invoking any account or service.
  await evaluate(
    `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(photos)}),c=>c.charCodeAt(0));const t=new DataTransfer();t.items.add(new File([bytes],'local-test.png',{type:'image/png'}));const input=document.querySelector('#photo-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("!!document.querySelector('#photo-preview img')");
  assert.match(
    await evaluate("document.querySelector('#photo-preview img').src"),
    /_capacitor_file_/,
  );
  await wait("document.querySelector('#photo-preview img').complete");
  assert.equal(
    await evaluate("document.querySelector('#photo-preview img').naturalWidth"),
    1,
  );
  checks.push("photo signature, native storage, local image display");
  // Import through the actual file-change handler and confirm before replacing measurements.
  await evaluate(
    `(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(fixture[e.id]))}],'sample.json',{type:'application/json'}));const input=document.querySelector('#data-picker');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait("document.querySelector('#modal').open");
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='已导入并保存到本机'",
  );
  await click("[data-action=validate]");
  await wait("document.querySelector('#modal').open");
  assert.match(
    await evaluate("document.querySelector('#modal-title').textContent"),
    /填写完整/,
  );
  await click("[data-dialog-confirm]");
  await click("[data-action=more]");
  await wait("document.querySelector('#modal').open");
  await click("[data-menu=export]");
  await pause(1200);
  assert.match(run("shell", "dumpsys", "window"), /mCurrentFocus[^\n]*(ChooserActivity|ResolverActivity)/, "native share sheet has focus");
  const exported = JSON.parse(
    run(
      "shell",
      "run-as",
      "com.labmaker.app",
      "cat",
      "cache/exports/" + e.name + "-测量数据.json",
    ),
  );
  assert.equal(exported.experiment, e.sourceId);
  assert.equal(exported.student.studentId, "001234");
  assert.ok(exported.data[sc.key] > 0);
  run("shell", "input", "keyevent", "KEYCODE_BACK");
  await pause(300);
  checks.push(
    "JSON import confirmation and full validation; native export file and share sheet cancelled without sending",
  );
  // Draft input may be incomplete; it must survive restart without disappearing from the catalog.
  await fill(`[data-key="${scalar.key}"]`, "1e-");
  await wait(
    "document.querySelector('#save-state').textContent==='已保存到本机'",
  );
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  await click('[data-category="all"]');
  await fill("#search", "");
  assert.equal(
    await evaluate("document.querySelectorAll('.experiment-card').length"),
    28,
  );
  checks.push(
    "invalid partial numeric draft is saved without hiding experiment",
  );
  await navigate("experiment/" + e.id);
  await wait("!!document.querySelector('[data-part=mantissa]')");
  await click('[data-action="more"]');
  await wait("document.querySelector('#modal').open");
  await click('[data-menu="clear"]');
  await wait(
    "document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent.includes('清除')",
  );
  await click("[data-dialog-confirm]");
  await wait(
    "document.querySelector('#toast').textContent==='本实验数据已清除'",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-key="${scalar.key}"]').value`,
    ),
    "",
  );
  assert.equal(
    await evaluate("document.querySelector('#photo-preview img')"),
    null,
  );
  await navigate("profile");
  await wait("!!document.querySelector('[data-profile=name]')");
  assert.equal(
    await evaluate("document.querySelector('[data-profile=studentId]').value"),
    "001234",
  );
  checks.push(
    "clear removes raw photo and measurement snapshots while retaining profile",
  );
  const dynamic = catalog.find((e) =>
      e.schema.groups.some((g) => g.fields.some((f) => f.pairedMatrix)),
    ),
    f = dynamic.schema.groups
      .flatMap((g) => g.fields)
      .find((f) => f.pairedMatrix);
  await navigate("experiment/" + dynamic.id);
  await wait(`!!document.querySelector('#field-${f.key}')`);
  const n = await evaluate(
    `document.querySelectorAll('#field-${f.key} input').length`,
  );
  await evaluate(
    `document.querySelector('#field-${f.key}').closest('details').open=true`,
  );
  await click(`[data-resize="${f.key}"][data-delta="1"]`);
  await wait(
    `document.querySelectorAll('#field-${f.key} input').length===${n + 1}`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('#field-${f.pairedMatrix} tbody tr').querySelectorAll('input').length`,
    ),
    n + 1,
  );
  await click(`[data-resize="${f.key}"][data-delta="-1"]`);
  await wait(
    `document.querySelectorAll('#field-${f.key} input').length===${n}`,
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await capture("base-matrix");
  checks.push(
    "variable measurement points resize paired matrix; long table scroll stays inside page",
  );
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  await capture("base-home-final");
  // Render each real experiment schema and check every input exists at its data index.
  for (const item of catalog) {
    await navigate("experiment/" + item.id);
    await wait("!!document.querySelector('#measurement-form')");
    const expected = item.schema.groups.flatMap((g) => g.fields).length;
    assert.equal(
      await evaluate("document.querySelectorAll('.field').length"),
      expected,
      item.name,
    );
    assert.equal(
      await evaluate("document.documentElement.scrollWidth<=innerWidth"),
      true,
      item.name,
    );
  }
  checks.push(
    "all 28 experiment forms render without horizontal page overflow",
  );
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  const hit = await evaluate(
    "(()=>{const r=document.querySelector('[data-category=mechanics]').getBoundingClientRect();return {x:(r.x+r.width/2)*devicePixelRatio,y:(r.y+r.height/2)*devicePixelRatio+128}})()",
  );
  run(
    "shell",
    "input",
    "tap",
    String(Math.round(hit.x)),
    String(Math.round(hit.y)),
  );
  await wait("document.querySelectorAll('.experiment-card').length===4");
  checks.push("real Android touch selects category");
  run("shell", "wm", "size", "900x1800");
  await pause(600);
  await navigate("experiment/" + dynamic.id);
  await wait("!!document.querySelector('.table-scroll')");
  await evaluate(
    "document.querySelector('.table-scroll').closest('details').open=true;document.querySelector('.table-scroll').scrollIntoView({block:'center'})",
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await capture("base-small-matrix");
  checks.push("small 343 CSS-pixel window with scrollable measurement table");
  run("shell", "wm", "size", "reset");
  await pause(300);
  await navigate("home");
  await wait("!!document.querySelector('#search')");
  await click("[data-category=all]");
  await capture("base-home-final");
  const result = {
    result: "PASS",
    serial,
    api: run("shell", "getprop", "ro.build.version.sdk").trim(),
    checks,
    limitations: [
      "No physical phone tested",
      "Native system photo picker and share destination not exercised",
      "Report generation covered by report suites; no official-system login, upload or paid API calls",
    ],
  };
  fs.writeFileSync(
    path.join(out, "base-android-smoke.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  try {
    await capture("base-failure");
    console.error(await evaluate("document.body.innerText"));
  } catch {}
} finally {
  connection?.socket.close();
  try {
    run("shell", "wm", "size", "reset");
  } catch {}
  try {
    run("forward", "--remove", "tcp:9227");
  } catch {}
}
