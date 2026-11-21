import assert from "node:assert/strict";
import { openBrowserTest } from "./browser-test-harness.mjs";

const b = await openBrowserTest(process.cwd(),"tests/fixtures/report-account-autofill.ts",'<main id="host"></main>');
const evaluate = b.evaluate;
const field = async () => b.wait("!!document.querySelector('#report-site-account')");
const form = () => evaluate(`[
  document.querySelector('#report-site-account').value,
  document.querySelector('#report-site-password').value,
  document.querySelector('#report-site-password').placeholder,
  document.querySelector('#report-site-password').type
]`);
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
try {
  await evaluate("import('/test.mjs').then(m=>{window.fixture=m.createFixture();fixture.mount();return true})");
  await field();
  assert.deepEqual(await form(),["2500000000","","********","password"]);
  assert.deepEqual(await evaluate("fixture.calls()"),[]);
  assert.doesNotMatch(await evaluate("document.querySelector('#host').textContent"),/选择已保存账号|使用此账号登录|管理本机账号|手动输入的密码/);
  await click("[data-report-site=login]");
  await field();
  assert.deepEqual(await evaluate("fixture.calls()"),[["saved","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","2500000000"]]);

  await evaluate(`(()=>{
    const account=document.querySelector('#report-site-account');
    account.value='2500000002';
    account.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  assert.deepEqual(await form(),["2500000002","","","password"]);
  await click("[data-report-site=login]");
  assert.equal((await evaluate("fixture.calls()")).length,1);
  await evaluate("document.querySelector('#report-site-password').value='dummy-manual'");
  await click("[data-report-site=login]");
  await field();
  assert.deepEqual((await evaluate("fixture.calls()")).at(-1),["manual","2500000002","dummy-manual"]);
  assert.deepEqual(await form(),["2500000000","","********","password"]);

  await evaluate("fixture.preferredAccount()");
  await field();
  assert.deepEqual(await form(),["2500000001","","************","password"]);
  await click("[data-report-site=clear]");
  await b.wait("document.querySelector('#report-site-status')?.textContent.includes('已清除')");
  assert.deepEqual(await form(),["2500000001","","************","password"]);

  await evaluate("fixture.failRead(true);fixture.mount()");
  await b.wait("!!document.querySelector('[data-report-site=check-config]')");
  await evaluate("fixture.failRead(false)");
  await click("[data-report-site=check-config]");
  await field();
  assert.deepEqual(await form(),["2500000001","","************","password"]);
  await evaluate("fixture.clearAccounts()");
  await b.wait("document.querySelector('#host').textContent.includes('完成账号配置')");
  assert.equal(await evaluate("!!document.querySelector('#report-site-password')"),false);
  assert.deepEqual(b.errors,[]);
  console.log("Report login autofill, masking, explicit login, manual override, preferred account, session clear and missing config passed.");
} finally {
  await b.close();
}
