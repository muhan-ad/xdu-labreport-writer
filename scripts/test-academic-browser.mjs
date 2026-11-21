import assert from "node:assert/strict";
import {openBrowserTest} from "./browser-test-harness.mjs";

const b=await openBrowserTest(process.cwd(),"tests/fixtures/academic-ui.ts",'<main id="app"><div id="academic-host"></div></main>');
const click=action=>b.evaluate(`document.querySelector('[data-academic="${action}"]').click()`);
const waitStatus=label=>b.wait(`document.querySelector('[data-academic-status]').textContent.includes(${JSON.stringify(label)})`);

try {
  await b.evaluate("import('/test.mjs').then(m=>{window.fixture=m.createAcademicFixture();return true})");
  await waitStatus("尚未同步");
  assert.equal((await b.evaluate("fixture.state()")).calls,0);
  await click("connect");
  await waitStatus("课表同步完成");
  assert.doesNotMatch(await b.evaluate("document.querySelector('#academic-host').innerText"),/测试课程|A101|205|未安排时间/);
  assert.equal(await b.evaluate("document.querySelectorAll('#academic-host input,#academic-host article').length"),0);

  await b.evaluate("fixture.confirm(false)");
  await click("clear");
  await b.wait("!document.querySelector('[data-academic=clear]').disabled");
  assert.equal((await b.evaluate("fixture.state()")).clears,0);
  await b.evaluate("fixture.confirm(true)");
  await click("clear");
  await waitStatus("已清除");

  await b.evaluate("fixture.fail(true)");
  await click("connect");
  await waitStatus("模拟连接失败");
  await b.evaluate("fixture.fail(false);fixture.pending()");
  await click("connect");
  await b.wait("fixture.state().calls===3");
  await b.evaluate("fixture.leave();fixture.reopen();fixture.late()");
  await b.wait("fixture.state().cancelled.length===1");
  await waitStatus("尚未同步");

  await b.evaluate("fixture.cachedRestart()");
  await waitStatus("请重新同步");
  await b.evaluate("fixture.persistenceFailure()");
  await click("connect");
  await waitStatus("本机保存失败");
  const calls=(await b.evaluate("fixture.state()")).calls;
  await click("retry-save");
  await waitStatus("本机课表已保存");
  assert.equal((await b.evaluate("fixture.state()")).calls,calls);
  assert.equal(await b.evaluate("document.querySelector('[data-academic=retry-save]').hidden"),true);
  for (const width of [320,390,768]) {
    await b.cdp("Emulation.setDeviceMetricsOverride",{width,height:800,deviceScaleFactor:1,mobile:true});
    assert.equal(await b.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
  }
  assert.deepEqual(b.errors,[]);
  console.log("Academic status-only page, explicit sync, clear, late result, stale and save retry passed.");
} finally {
  await b.close();
}
