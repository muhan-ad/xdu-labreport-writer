import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const expectedVersion = JSON.parse(fs.readFileSync('package.json','utf8')).version;
const adb = "E:/tools/app-maker/android-sdk/platform-tools/adb.exe",
  serial = "emulator-5560";
const testPackage = "com.labmaker.app.acceptance";
const run = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const appInForeground=()=>assert.match(run('shell','dumpsys','window'),/mCurrentFocus[^\n]*com\.labmaker\.app/,'Native overlay obscures the app; do not accept screenshots as visual evidence');
const requests = [],
  checks = [];
let mode = "login-alias",
  view = 0,
  inflight = 0,
  maxInflight = 0,
  socket,
  id = 0;
const jobs = new Map();
let scheduleView = 0;
const courseName = "冲击法测量直螺线管磁场实验";
const login =
  '<form><input type="hidden" name="__VIEWSTATE" value="fresh-login"><input name="login1$StuLoginID"><input type="password" name="login1$StuPassword"></form>';
const overview =
  "模拟同学（2500000000）同学 第7周 必须完成的实验项目总学时数为24 每周可选的实验项目总学时数为9 已选实验项目的总学时数为3";
const server = http.createServer((req, res) => {
  inflight++;
  maxInflight = Math.max(maxInflight, inflight);
  res.on("close", () => inflight--);
  let body = "";
  req.on("data", (x) => (body += x));
  req.on("end", () => {
    const form = new URLSearchParams(body);
    requests.push({
      method: req.method,
      path: req.url,
      keys: [...form.keys()],
    });
    const reply = () => {
      if (res.destroyed) return;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.url === "/phyews/" && req.method === "GET" && mode === "login-alias") {
        assert.match(req.headers["user-agent"], /Mozilla\/5\.0/);
        assert.ok(req.headers["user-agent"].endsWith("LabMakerMobile/"+expectedVersion));
        res.writeHead(302, {Location: "/new-official-login.aspx?state=school"});res.end();return;
      }
      if(req.url === "/new-official-login.aspx?state=school") {
        res.writeHead(302, {Location: "/PhyEws/default.aspx?ReturnUrl=%2fphyews%2fstudent%2fstudent.aspx"});res.end();return;
      }
      if (req.url.startsWith("/PhyEws/default.aspx?") || (req.url === "/phyews/" && req.method === "GET")) {
        res.setHeader("Set-Cookie", "school=login; Path=/; HttpOnly");
        res.end(login);
        return;
      }
      if (req.url === "/phyews/" && req.method === "POST") {
        assert.equal(form.get("__VIEWSTATE"), "fresh-login");
        assert.ok(req.headers.cookie?.includes("school=login"));
        assert.equal(form.get("login1$StuLoginID"), "2500000000");
        assert.equal(form.get("login1$StuPassword"), "dummy-school-password");
        res.writeHead(302, {
          "Set-Cookie": "school=authenticated; Path=/; HttpOnly",
          Location: "/PhyEws/student/student.aspx",
        });
        res.end();
        return;
      }
      assert.ok(req.headers.cookie?.includes("school=authenticated"));
      if (req.url.endsWith("student.aspx")) {
        res.setHeader("Content-Type", "text/html; charset=gb18030");
        res.end(fs.readFileSync("tests/fixtures/portal-overview-gb18030.bin"));
      } else if (req.url.endsWith("select.aspx"))
        res.end(
          "实验项目<table><tr>" +
            [
              "1",
              "冲击法测量直螺线管磁场实验（3学时）",
              "7",
              "星期四下午15:55-18:10",
              "2026/10/29",
              "F219",
              "",
              "",
              "",
              "",
            ]
              .map((t) => `<td>${t}</td>`)
              .join("") +
            "</tr></table>",
        );
      else if (req.url.endsWith("del.aspx"))
        res.end(
          "取消<table><tr>" +
            [
              "1",
              "冲击法测量直螺线管磁场实验",
              "7",
              "星期四下午15:55-18:10",
              "3",
              '<input type="radio" name="row" value="rb">',
            ]
              .map((t) => `<td>${t}</td>`)
              .join("") +
            "</tr></table>",
        );
      else if (req.url.endsWith("addexpe.aspx"))
        res.end(
          '<form><select name="ExpeWeekList" id="ExpeWeekList"><option value="7">7</option><option value="8">8</option></select></form>',
        );
      else if (req.url.endsWith("expeinfo.aspx")) {
        if (mode === "metadata-failure") {
          res.writeHead(503);
          res.end("unavailable");
          return;
        }
        res.end(fs.readFileSync("tests/fixtures/course-room-projects.html"));
      } else if (req.url.endsWith("course.aspx") && req.method === "GET") {
        scheduleView++;
        res.end(
          `<form><input type="hidden" name="__VIEWSTATE" value="schedule-${scheduleView}"><select name="plan1$ExpeList"><option value="A1">${courseName} 3学时</option></select></form>`,
        );
      } else if (req.url.endsWith("course.aspx") && req.method === "POST") {
        assert.equal(form.get("__VIEWSTATE"), "schedule-" + scheduleView);
        assert.equal(form.get("__EVENTTARGET"), "plan1$ExpeList");
        assert.equal(form.get("plan1$ExpeList"), "A1");
        if (mode === "metadata-expired") {
          res.writeHead(401);
          res.end("expired");
          return;
        }
        const row = (
          teacher,
          first,
          last,
          parity,
          time = "星期四下午15:55-18:10",
        ) =>
          "<tr>" +
          [time, teacher, first, last, parity, "是"]
            .map((s) => `<td>${s}</td>`)
            .join("") +
          "</tr>";
        res.end(
          "<table><tr><th>上课时间</th><th>上课教师</th><th>起始周</th><th>结束周</th><th>单双周</th><th>是否开课</th></tr>" +
            row("吴兴林／王小芳", 2, 7, "单周") +
            row("模拟教师乙", 8, 14, "") +
            row("张欢", 2, 14, "双周", "星期五晚上18:30-20:45") +
            (mode === "ambiguous" ? row("不确定教师", 2, 7, "单周") : "") +
            "</table>",
        );
      } else if (req.url.endsWith("statsel.aspx") && req.method === "GET") {
        if(mode === "auth-redirect") {
          res.writeHead(302,{Location:"/phyews/default.aspx?ReturnUrl=%2fphyews%2fstudent%2fstatsel.aspx"});res.end();return;
        }
        if (mode === "external") {
          res.writeHead(302, { Location: "https://example.invalid/steal" });
          res.end();
          return;
        }
        view++;
        res.end(
          `<form><input type="hidden" name="__VIEWSTATE" value="query-${view}"><select id="Header2_ExpeWeekList" name="Header2$ExpeWeekList"><option value="7">7</option><option value="8">8</option></select><input type="image" id="Header2_btnSubmit" name="Header2$btnSubmit"></form>`,
        );
      } else if (req.url.endsWith("statsel.aspx") && req.method === "POST") {
        assert.equal(form.get("__VIEWSTATE"), "query-" + view);
        assert.equal(form.get("Header2$btnSubmit.x"), "8");
        if (mode === "expired") {
          res.end(login);
          return;
        }
        const week = form.get("Header2$ExpeWeekList");
        res.end(
          `第 ${mode === "mismatch" ? "99" : week} 周可选<table><tr><td>冲击法测量直螺线管磁场实验（3学时）(35人)</td><td>星期四下午15:55-18:10 (2) 星期五晚上18:30-20:45 (0)</td></tr></table><script>window.schoolScriptExecuted=true</script>`,
        );
      } else {
        res.writeHead(404);
        res.end("missing");
      }
    };
    setTimeout(
      reply,
      mode === "slow" &&
        req.method === "POST" &&
        req.url.endsWith("statsel.aspx")
        ? 1500
        : 40,
    );
  });
});
server.keepAliveTimeout = 600000;
await new Promise((r) => server.listen(58441, "127.0.0.1", r));
async function call(method, params = {}) {
  const next = ++id;
  return new Promise((resolve, reject) => {
    jobs.set(next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const native = (method, args = {}) =>
  evaluate(
    `Capacitor.nativePromise('LabPortal',${JSON.stringify(method)},${JSON.stringify(args)}).then(value=>({ok:true,value}),e=>({ok:false,message:e.message,code:e.code}))`,
  );
async function wait(expression) {
  for (let i = 0; i < 160; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error("Timed out: " + expression);
}
const click = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function loginUI() {
  await evaluate(`location.hash='/portal'`);
  await wait("!!document.querySelector('#portal-account')");
  await evaluate(
    `document.querySelector('#portal-account').value='2500000000';document.querySelector('#portal-password').value='dummy-school-password'`,
  );
  await evaluate("window.dispatchEvent(new Event('focus'))");
  assert.equal(
    await evaluate("document.querySelector('#portal-password').value"),
    "dummy-school-password",
  );
  await click('[data-portal="login"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('已连接学校')",
  );
}
try {
  assert.ok(run("shell","pm","list","packages",testPackage).includes("package:"+testPackage),"隔离验收包未安装");
  run("reverse", "tcp:58441", "tcp:58441");
  run("shell", "am", "force-stop", testPackage);
  run("shell", "am", "start", "-n", testPackage+"/com.labmaker.app.MainActivity");
  for (let i = 0; i < 60; i++) {
    try {
      const pid = run("shell", "pidof", testPackage)
        .trim()
        .split(/\s/)[0];
      run(
        "forward",
        "tcp:9227",
        "localabstract:webview_devtools_remote_" + pid,
      );
      const tabs = await (await fetch("http://127.0.0.1:9227/json")).json();
      socket = new WebSocket(
        tabs.find((t) =>
          t.url.startsWith("https://localhost/"),
        ).webSocketDebuggerUrl,
      );
      await new Promise((r, j) => {
        socket.onopen = r;
        socket.onerror = j;
      });
      break;
    } catch (e) {
      if (i === 59) throw e;
      await pause(500);
    }
  }
  socket.onmessage = (e) => {
    const message = JSON.parse(e.data);
    if (jobs.has(message.id)) {
      const job = jobs.get(message.id);
      jobs.delete(message.id);
      message.error
        ? job.reject(Error(message.error.message))
        : job.resolve(message.result);
    }
  };
  await wait("!!document.querySelector('.app-header')");
  await evaluate("window.__systemNow=Date.now;Date.now=()=>Date.parse('2026-10-28T10:00:00+08:00')");
  assert.equal((await native("request", { operation: "commit" })).ok, false);
  assert.equal(
    (
      await native("request", {
        operation: "weekQuery",
        form: { "btnAdd.x": "8" },
      })
    ).code,
    "FORM",
  );
  assert.equal((await native("useMock", { enabled: true })).ok,true);
  await loginUI();
  await wait("document.querySelector('[data-metadata-kind=selected]')?.textContent.includes('吴兴林') && !document.querySelector('[data-portal=metadata]').disabled");
  assert.ok(
    await evaluate(
      "document.querySelector('#portal-host').innerText.includes('模拟同学')",
    ),
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.portal-next').length"),
    1,
  );
  checks.push(
    "native isolated CookieJar login, fresh ASP.NET state, redirect, identity and overview confirmed",
  );
  await evaluate(
    "window.__card=document.querySelector('[data-course-index]');window.__realNow=Date.now;Date.now=()=>Date.parse('2026-10-29T15:55:00+08:00')+1;window.dispatchEvent(new Event('focus'))",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.portal-next').length"),
    0,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-course-index]')===window.__card",
    ),
    true,
  );
  await evaluate(
    "Date.now=window.__realNow;window.dispatchEvent(new Event('focus'));delete window.__card;delete window.__realNow",
  );
  checks.push("Unlisted official route and ASP.NET ReturnUrl accepted without a per-page allowlist; Android browser identity sent");
  checks.push(
    "GB18030 official text decoded; focus retains login draft and updates future status without rebuilding cards",
  );
  await click('[data-portal="review"]');
  await wait("document.querySelector('#course-review').open");
  assert.ok(
    await evaluate(
      "document.querySelector('#course-review').innerText.includes('吴兴林') && document.querySelector('#course-review').innerText.includes('王小芳')",
    ),
  );
  checks.push(
    "official scoped metadata resolves explicit multi-teacher slot; reviews limited to matching experiment, teacher names plain text",
  );
  await pause(250);appInForeground();fs.writeFileSync(
    "artifacts/verification/portal-teacher-review.png",
    execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
  assert.equal(
    await evaluate("document.querySelector('#course-review a')!==null"),
    false,
  );
  await click('[data-review-close]');
  await click('[data-portal="available"]');
  await wait(
    "document.querySelectorAll('.portal-card').length===2 && !document.querySelector('[data-portal=week]').disabled",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-metadata-kind=slot]').innerText.includes('吴兴林')",
    ),
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-metadata-kind=slot]').innerText.includes('F219')",
    ),
  );
  assert.ok(
    await evaluate(
      "document.querySelectorAll('[data-metadata-kind=slot]')[1].innerText.includes('待核实')",
    ),
  );
  assert.ok(
    await evaluate(
      "document.querySelector('#portal-host').innerText.includes('余量 2 人')",
    ),
  );
  assert.equal(await evaluate("window.schoolScriptExecuted===true"), false);
  const before = requests.length;
  await click('[data-portal="selected"]');
  await click('[data-portal="available"]');
  await pause(300);
  assert.equal(requests.length, before);
  mode = "ambiguous";
  await click('[data-portal="metadata"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('已重新核对')",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-metadata-kind=slot]').innerText.includes('待核实')",
    ),
  );
  mode = "metadata-failure";
  await click('[data-portal="metadata"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('未完整获取')",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-metadata-kind=slot]').innerText.includes('部分信息未完整获取')",
    ),
  );
  mode = "ok";
  await click('[data-portal="metadata"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('已重新核对')",
  );
  checks.push(
    "partial metadata failure and conflicting teacher records stay explicit; retry recovers without changing saved timetable",
  );
  const beforeRooms = requests.filter((r) =>
    r.path.endsWith("expeinfo.aspx"),
  ).length;
  await evaluate(
    "document.querySelector('#portal-week').value='8';document.querySelector('#portal-week').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  await wait(
    "document.querySelector('#portal-status').textContent.includes('已读取官网场次') && !document.querySelector('[data-portal=week]').disabled",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-metadata-kind=slot]').innerText.includes('模拟教师乙')",
    ),
  );
  await click('[data-portal="slot-review"]');
  await wait("document.querySelector('#course-review').open");
  assert.ok(
    await evaluate(
      "document.querySelector('#course-review').innerText.includes('暂无评价')",
    ),
  );
  await click("[data-review-close]");
  await evaluate(
    "document.querySelector('#portal-week').value='7';document.querySelector('#portal-week').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  await wait(
    "document.querySelector('#portal-status').textContent.includes('已读取官网场次') && !document.querySelector('[data-portal=week]').disabled",
  );
  checks.push(
    "week ranges/parity alter teacher matches; unknown teacher has no borrowed review; cached metadata reused across weeks",
  );
  assert.equal(
    requests.filter((r) => r.path.endsWith("expeinfo.aspx")).length,
    beforeRooms,
  );
  checks.push(
    "actual native week query uses form control names, 60-second cache; filled/zero slots retained; official scripts inert",
  );
  mode = "mismatch";
  await click('[data-portal="week"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('周次不匹配')",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.portal-card').length"),
    0,
  );
  checks.push(
    "mismatched official week fails explicitly without presenting stale availability",
  );
  mode = "external";
  await click('[data-portal="week"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('跳转地址未获授权')",
  );
  checks.push(
    "external redirects and selection-form fields rejected before any unauthorized request",
  );
  mode = "slow";
  await click('[data-portal="week"]');
  await pause(150);
  await click('[data-portal="clear"]:not(:disabled)');
  await wait("!!document.querySelector('#portal-account')");
  await pause(1700);
  assert.ok(
    await evaluate(
      "document.querySelector('#portal-status').textContent.includes('不会自动重连')",
    ),
  );
  const count = requests.length;
  await pause(500);
  assert.equal(requests.length, count);
  checks.push(
    "clear during request discards late response, cancels native request and prevents automatic reconnect",
  );
  mode = "ok";
  await loginUI();
  await click('[data-portal="available"]');
  await wait("document.querySelectorAll('.portal-card').length===2");
  await evaluate("document.querySelector('[data-metadata-kind=slot]').scrollIntoView({block:'center'})");
  await pause(250);appInForeground();fs.writeFileSync(
    "artifacts/verification/portal-availability.png",
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
  await pause(200);
  assert.equal(
    await evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  const shot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    "artifacts/verification/portal-small.png",
    Buffer.from(shot.data, "base64"),
  );
  await call("Emulation.clearDeviceMetricsOverride");
  mode = "metadata-expired";
  await click('[data-portal="metadata"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('登录已失效')",
  );
  assert.ok(await evaluate("!!document.querySelector('#portal-account')"));
  mode = "ok";
  await loginUI();
  await click('[data-portal="available"]');
  await wait(
    "document.querySelectorAll('.portal-card').length===2 && !document.querySelector('[data-portal=week]').disabled",
  );
  checks.push(
    "metadata HTTP 401 invalidates the session instead of treating authentication failure as partial teacher data",
  );
  mode = "expired";
  await click('[data-portal="week"]');
  await wait(
    "document.querySelector('#portal-status').textContent.includes('登录已失效')",
  );
  checks.push(
    "expired session returns manual login; narrow layout has no horizontal overflow",
  );
  mode="auth-redirect";
  const expiredRedirect=await native("request",{operation:"weekForm"});
  assert.equal(expiredRedirect.code,"AUTH");
  assert.match(expiredRedirect.message,/登录未生效或会话已失效/);
  checks.push("protected-page ReturnUrl redirects report authentication expiry instead of an unauthorized address");
  assert.equal(maxInflight, 1);
  assert.ok(
    requests.every((r) =>
      [
        "/phyews/",
        "/phyews/default.aspx",
        "/new-official-login.aspx",
        "/phyews/student/student.aspx",
        "/phyews/student/select.aspx",
        "/phyews/student/del.aspx",
        "/phyews/student/addexpe.aspx",
        "/phyews/student/statsel.aspx",
        "/phyews/student/expeinfo.aspx",
        "/phyews/student/course.aspx",
      ].includes(r.path.split("?")[0].toLowerCase()),
    ),
  );
  checks.push(
    "all school requests serialized; native plugin rejects mutation/unknown operations",
  );
  await native("clear");
  await native("useMock", { enabled: false });
  fs.writeFileSync(
    "artifacts/verification/portal-native.json",
    JSON.stringify(
      {
        checks,
        mocked: true,
        realSchoolRequests: 0,
        maxInflight,
        requestCount: requests.length,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (e) {
  console.error(
    await evaluate("document.querySelector('#portal-host')?.innerText").catch(
      () => null,
    ),
  );
  throw e;
} finally {
  socket?.close();
  server.closeAllConnections();
  server.close();
  try {
    run("reverse", "--remove", "tcp:58441");
  } catch {}
}
