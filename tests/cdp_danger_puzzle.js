// 「解谜彩蛋 + 管理员模式」验收
//
// 需先启动（隔离用户目录）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
// 用法：node tests/cdp_danger_puzzle.js [端口，默认 9222]
//
// 断言：
//   1. 初始状态：管理员导航项隐藏、解谜入口在「请勿点击」页；
//   2. 空输入 / 错误姓名 → 拒绝并给出提示，尝试次数 +1；
//   3. 正确姓名（Grimwig 的几种写法，含大小写/空格/前缀）→ 解锁；
//   4. 解锁后：管理员导航项出现、能打开、彩蛋播放器列全了效果、统计里有内容；
//   5. 播放器可用：选一个效果能真的播放；
//   6. 重置：导航项重新隐藏、计数清零。
'use strict';
const http = require('node:http');
const PORT = Number(process.argv[2] || 9222);
const wait = ms => new Promise(r => setTimeout(r, ms));

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list', timeout: 5000 }, res => {
      let b = ''; res.on('data', d => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
let seq = 0;
function send(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return; ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  const page = (await listTargets()).find(t => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) throw new Error('未找到应用页面');
  const ws = await new Promise((res, rej) => { const w = new WebSocket(page.webSocketDebuggerUrl); w.onopen = () => res(w); w.onerror = rej; });
  await send(ws, 'Runtime.enable');
  const errors = [];
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text || 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    }
  });
  const ev = async e => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) throw new Error('页面异常: ' + r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const bad = [];
  const check = (name, ok, detail) => {
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (ok ? '' : '  ← ' + detail));
    if (!ok) bad.push({ name, detail });
  };

  // 0. 干净起点
  await ev(`(() => {
    ['dangerAdminUnlocked','dangerPuzzleTries','dangerAdminUnlockedAt','dangerEffectCounts','dangerClickCount',
     'dangerPuzzleEntry','dangerPuzzleAutoOpened','dangerClickTimes']
      .forEach(k => localStorage.removeItem(k));
    if (window.dangerPuzzle) window.dangerPuzzle.applyUnlock();
    document.getElementById('btnSettings').click();
    return 1;
  })()`);
  await wait(450);
  await ev(`(() => { document.getElementById('btnNavDanger').click(); return 1; })()`);
  await wait(300);

  // 1. 初始状态：解谜入口必须藏着（要 5 分钟内点满 10 次才出现）
  const init = await ev(`(() => ({
    navHidden: document.getElementById('btnNavAdmin').hidden,
    paneExists: !!document.getElementById('paneAdmin'),
    entryHidden: document.getElementById('puzzleSection').hidden,
    entry: !!document.getElementById('btnDangerPuzzle'),
    hintText: document.getElementById('paneDanger').innerText,
    unlocked: window.dangerPuzzle.unlocked(),
    window: window.dangerEffects.clickWindow(),
  }))()`);
  check('初始：管理员项与解谜入口都隐藏（谜面不可见）',
    init.navHidden && init.paneExists && init.entryHidden && init.entry
      && !init.hintText.includes("I'll eat my head") && !init.unlocked,
    JSON.stringify(init).slice(0, 220));

  // 2. 触发计数：9 次不够，第 10 次才露出入口（并能自动弹出谜题）
  for (let i = 1; i <= 9; i++) {
    await ev(`window.dangerEffects.run('pixelate'); 1`);
    await wait(320);
    await ev(`window.dangerEffects.cancel()`);
    await wait(180);
  }
  const nine = await ev(`(() => ({
    window: window.dangerEffects.clickWindow(),
    hidden: document.getElementById('puzzleSection').hidden,
  }))()`);
  check('第 9 次触发：入口仍然藏着', nine.window === 9 && nine.hidden === true, JSON.stringify(nine));

  await ev(`window.dangerEffects.run('pixelate'); 1`);
  await wait(400);
  await ev(`window.dangerEffects.cancel()`);
  await wait(1200);
  const ten = await ev(`(() => ({
    window: window.dangerEffects.clickWindow(),
    revealed: window.dangerPuzzle.entryRevealed(),
    hidden: document.getElementById('puzzleSection').hidden,
    modalShown: document.getElementById('puzzleModal').classList.contains('show'),
    hint: document.getElementById('paneDanger').innerText,
  }))()`);
  check('第 10 次触发：入口出现 + 谜题自动弹出',
    ten.window >= 10 && ten.revealed === true && ten.hidden === false
      && ten.modalShown === true && ten.hint.includes("I'll eat my head"),
    JSON.stringify(ten).slice(0, 220));

  // 3. 弹窗已在眼前，直接用它（下面继续按原流程验证判定）
  const modal = await ev(`(() => ({
    shown: document.getElementById('puzzleModal').classList.contains('show'),
    text: document.getElementById('puzzleModal').innerText.replace(/\\s+/g, ' ').trim(),
  }))()`);
  check('弹窗出现且带谜面与提示',
    modal.shown && modal.text.includes('请输入管理员姓名') && modal.text.includes("I'll eat my head"),
    JSON.stringify(modal).slice(0, 200));

  // 4. 空输入 / 错误答案
  await ev(`(() => { document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
  await wait(200);
  const emptyMsg = await ev(`document.getElementById('puzzleMsg').textContent`);
  check('空输入被拦下', /先填个名字/.test(emptyMsg), emptyMsg);

  for (const wrong of ['admin', '慕寒寒', 'grim']) {
    await ev(`(() => { document.getElementById('puzzleInput').value = ${JSON.stringify(wrong)};
      document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
    await wait(180);
  }
  const wrongState = await ev(`(() => ({
    msg: document.getElementById('puzzleMsg').textContent,
    tries: window.dangerPuzzle.tries(),
    unlocked: window.dangerPuzzle.unlocked(),
  }))()`);
  check('错误答案被拒 + 尝试计数 + 提示升级',
    !wrongState.unlocked && wrongState.tries === 3 && /不对/.test(wrongState.msg),
    JSON.stringify(wrongState));

  // 5. 正确答案的几种写法都能过（先试一个错的写法，再试正确的）
  const variants = ['Mr. Grimwig', 'grimwig', '  GRIMWIG  ', 'mr_grimwig'];
  let unlockOk = true, firstResult = '';
  for (const v of variants) {
    await ev(`(() => { localStorage.removeItem('dangerAdminUnlocked');
      document.getElementById('puzzleInput').value = ${JSON.stringify(v)};
      document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
    await wait(300);
    const ok = await ev(`window.dangerPuzzle.unlocked()`);
    if (!firstResult) firstResult = v + ' → ' + ok;
    if (!ok) unlockOk = false;
  }
  check('正确答案各种写法都能解锁（' + variants.join(' / ') + '）', unlockOk, firstResult);

  // 6. 解锁后的管理员页
  await wait(1200);
  const admin = await ev(`(() => {
    const nav = document.getElementById('btnNavAdmin');
    const sel = document.getElementById('adminEffectSelect');
    return {
      navHidden: nav.hidden,
      options: sel ? sel.options.length : 0,
      stats: (document.getElementById('adminStats') || {}).innerText || '',
    };
  })()`);
  check('解锁后：导航项出现 + 播放器有选项',
    !admin.navHidden && admin.options >= 19, JSON.stringify(admin).slice(0, 200));
  check('统计里有点击与触发记录',
    /累计点击/.test(admin.stats) && /各效果触发次数/.test(admin.stats), admin.stats.slice(0, 160));

  // 7. 播放器能真的播（选 audio，等它跑完）
  await ev(`(() => {
    const sel = document.getElementById('adminEffectSelect');
    sel.value = 'pixelate';
    document.getElementById('btnSettings').click();  // 关掉设置，别挡着
    return 1;
  })()`);
  await wait(300);
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(300);
  await ev(`(() => { document.getElementById('btnAdminPlay').click(); return 1; })()`);
  await wait(600);
  const playing = await ev(`window.dangerEffects.isRunning()`);
  check('播放器能触发效果（pixelate）', playing === true, 'isRunning=' + playing);
  for (let i = 0; i < 40 && await ev(`window.dangerEffects.isRunning()`); i++) await wait(250);
  await wait(500);
  const after = await ev(`(() => ({ layers: document.querySelectorAll('.dx-layer').length,
    filter: (document.getElementById('app') || document.body).style.filter || '' }))()`);
  check('效果收尾干净', after.layers === 0 && after.filter === '', JSON.stringify(after));

  // 8. 重置
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(350);
  await ev(`(() => { document.getElementById('btnNavAdmin').click(); return 1; })()`);
  await wait(250);
  await ev(`(() => { document.getElementById('btnAdminReset').click(); return 1; })()`);
  await wait(500);
  // 应用用的是自己的确认弹窗（不是 window.confirm）：点它的"确定"
  const confirmShown = await ev(`document.getElementById('confirmModal').classList.contains('show')`);
  if (confirmShown) {
    await ev(`(() => { document.getElementById('btnConfirmOk').click(); return 1; })()`);
  }
  await wait(700);
  const reset = await ev(`(() => ({
    navHidden: document.getElementById('btnNavAdmin').hidden,
    entryHidden: document.getElementById('puzzleSection').hidden,
    unlocked: window.dangerPuzzle.unlocked(),
    tries: Number(localStorage.getItem('dangerPuzzleTries') || 0),
    clicks: Number(localStorage.getItem('dangerClickCount') || 0),
    window: window.dangerEffects.clickWindow(),
  }))()`);
  check('重置（走确认弹窗）：管理员项与解谜入口都藏回、计数清零',
    reset.navHidden && reset.entryHidden && !reset.unlocked && reset.tries === 0
      && reset.clicks === 0 && reset.window === 0, JSON.stringify(reset));

  console.log('\n页面控制台错误：%d %s', errors.length, errors.slice(0, 3).join(' | '));
  if (errors.length) bad.push({ name: '(控制台)', detail: errors.slice(0, 3).join(' | ') });
  console.log(bad.length ? '\nFAIL: ' + JSON.stringify(bad, null, 1) : '\nPASS: 解谜彩蛋与管理员模式全部通过');
  ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
