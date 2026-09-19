// 「解谜彩蛋 → 档案室」验收
//
// 需先启动（隔离用户目录）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
// 用法：node tests/cdp_danger_puzzle.js [端口，默认 9222]
//
// 断言：
//   1. 初始：解谜入口隐藏（谜面不可见）；
//   2. 触发计数：第 9 次仍藏着，第 10 次入口出现 + 便条自动弹出；
//   3. 便条：能刮开（CDP 真实鼠标拖动 → 刮开比例上升、线索露出）；
//   4. 判定：空输入/错误答案被拒并给递进提示；Grimwig 的带前缀写法也能过；
//   5. 档案室：管理员档案（姓名/身份/出处/口头禅）+ 解谜记录 + 彩蛋手册 + 留言；
//   6. 留言：写一条 → 出现在列表里，重开档案室仍在；
//   7. 「再看一遍便条」可用；重开后记录仍在（不是一次性的）。
'use strict';
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
  // 先还原并居中窗口（最小化时画布尺寸/焦点都会异常）
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'center-window.ps1')], { encoding: 'utf8', timeout: 20000 });
    console.log('窗口居中：' + out.trim());
  } catch (e) { console.log('窗口居中失败（继续）'); }
  await wait(600);

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
    ['dangerPuzzleEntry','dangerPuzzleAutoOpened','dangerPuzzleSolvedAt','dangerPuzzleTries',
     'dangerPuzzleScratchPct','dangerPuzzleNoteReads','dangerGuestbook','dangerEffectCounts',
     'dangerClickCount','dangerClickTimes','dangerAdminUnlocked','dangerAdminUnlockedAt']
      .forEach(k => localStorage.removeItem(k));
    if (window.dangerPuzzle) window.dangerPuzzle.applyEntryState();
    document.getElementById('btnSettings').click();
    return 1;
  })()`);
  await wait(450);
  await ev(`(() => { document.getElementById('btnNavDanger').click(); return 1; })()`);
  await wait(300);

  // 1. 初始
  const init = await ev(`(() => ({
    entryHidden: document.getElementById('puzzleSection').hidden,
    paneDangerText: document.getElementById('paneDanger').innerText,
    recordsBtnHidden: document.getElementById('btnRecords').hidden,
  }))()`);
  check('初始：解谜入口隐藏、谜面不可见、档案室按钮未出现',
    init.entryHidden && !init.paneDangerText.includes("I'll eat my head") && init.recordsBtnHidden,
    JSON.stringify(init).slice(0, 200));

  // 2. 触发计数：9 次不够，第 10 次入口出现 + 便条自动弹出
  for (let i = 1; i <= 9; i++) {
    await ev(`window.dangerEffects.run('pixelate'); 1`);
    await wait(300);
    await ev(`window.dangerEffects.cancel()`);
    await wait(160);
  }
  const nine = await ev(`(() => ({ n: window.dangerEffects.clickWindow(),
    hidden: document.getElementById('puzzleSection').hidden }))()`);
  check('第 9 次触发：入口仍藏着', nine.n === 9 && nine.hidden === true, JSON.stringify(nine));

  await ev(`window.dangerEffects.run('pixelate'); 1`);
  await wait(400);
  await ev(`window.dangerEffects.cancel()`);
  await wait(1400);
  const ten = await ev(`(() => ({
    n: window.dangerEffects.clickWindow(),
    hidden: document.getElementById('puzzleSection').hidden,
    noteShown: document.getElementById('puzzleModal').classList.contains('show'),
    noteText: document.getElementById('puzzleModal').innerText.replace(/\\s+/g, ' '),
  }))()`);
  check('第 10 次触发：入口出现 + 便条自动弹出（含谜面与提示）',
    ten.n >= 10 && ten.hidden === false && ten.noteShown
      && ten.noteText.includes('请输入管理员姓名') && ten.noteText.includes("I'll eat my head"),
    JSON.stringify(ten).slice(0, 240));

  // 3. 刮开便条（CDP 真实鼠标拖动）
  const box = await ev(`(() => { const r = document.getElementById('scratchCanvas').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x + 6, y: box.y + Math.round(box.h / 2), button: 'left', clickCount: 1,
  });
  for (let i = 0; i <= 14; i++) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left',
      x: Math.round(box.x + 6 + (box.w - 12) * i / 14),
      y: Math.round(box.y + 12 + (box.h - 24) * ((i % 3) / 2)),
    });
    await wait(30);
  }
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x + box.w - 6, y: box.y + Math.round(box.h / 2), button: 'left', clickCount: 1,
  });
  await wait(300);
  const scr = await ev(`(() => ({
    pct: window.dangerPuzzle.scratchState().pct,
    stored: Number(localStorage.getItem('dangerPuzzleScratchPct') || 0),
    reveal: document.getElementById('scratchReveal').textContent,
  }))()`);
  check('刮开便条：刮开比例上升、线索露出（' + scr.pct + '%）',
    scr.pct >= 25 && scr.stored >= 25 && /雾都孤儿/.test(scr.reveal), JSON.stringify(scr).slice(0, 200));

  // 4. 判定
  await ev(`(() => { document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
  await wait(200);
  const emptyMsg = await ev(`document.getElementById('puzzleMsg').textContent`);
  check('空输入被拦下', /先写个名字/.test(emptyMsg), emptyMsg);

  for (const wrong of ['admin', 'Grimwigg', '慕寒寒']) {
    await ev(`(() => { document.getElementById('puzzleInput').value = ${JSON.stringify(wrong)};
      document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
    await wait(180);
  }
  const wrongState = await ev(`(() => ({ msg: document.getElementById('puzzleMsg').textContent,
    tries: window.dangerPuzzle.tries(), solved: window.dangerPuzzle.solved() }))()`);
  check('错误答案被拒 + 尝试计数 + 提示递进',
    !wrongState.solved && wrongState.tries === 3 && /不对/.test(wrongState.msg), JSON.stringify(wrongState));

  await ev(`(() => { document.getElementById('puzzleInput').value = 'Mr. GRIMWIG';
    document.getElementById('btnPuzzleSubmit').click(); return 1; })()`);
  await wait(1500);
  const solvedState = await ev(`(() => ({
    solved: window.dangerPuzzle.solved(),
    recordsShown: document.getElementById('recordsModal').classList.contains('show'),
    noteClosed: !document.getElementById('puzzleModal').classList.contains('show'),
    recordsBtnHidden: document.getElementById('btnRecords').hidden,
  }))()`);
  check('答对：便条关闭 + 档案室打开 + 「打开档案室」按钮常驻',
    solvedState.solved && solvedState.recordsShown && solvedState.noteClosed && !solvedState.recordsBtnHidden,
    JSON.stringify(solvedState));

  // 5. 档案室内容
  const rec = await ev(`(() => ({
    card: document.getElementById('adminCard').innerText.replace(/\\s+/g, ' '),
    solve: document.getElementById('solveRecords').innerText.replace(/\\s+/g, ' '),
    count: document.getElementById('handbookCount').textContent,
    items: document.querySelectorAll('#eggHandbook .handbook-item').length,
    on: document.querySelectorAll('#eggHandbook .handbook-item.on').length,
  }))()`);
  check('档案：姓名/身份/出处/口头禅都在',
    /Grimwig/.test(rec.card) && /秋荻文学社社长/.test(rec.card) && /武协/.test(rec.card)
      && /雾都孤儿/.test(rec.card) && /eat my head/.test(rec.card),
    rec.card.slice(0, 220));
  check('解谜记录：解开时间/用时/尝试/刮开比例',
    /首次解开/.test(rec.solve) && /从头到尾用了/.test(rec.solve) && /吃掉/.test(rec.solve),
    rec.solve.slice(0, 220));
  check('彩蛋手册：列出全部效果并显示点亮进度（' + String(rec.count).trim() + '）',
    rec.items >= 20 && rec.on >= 1 && /已点亮/.test(rec.count),
    JSON.stringify({ items: rec.items, on: rec.on, count: rec.count }));

  // 6. 留言
  await ev(`(() => { document.getElementById('guestbookInput').value = '到此一游，文武双全。';
    document.getElementById('btnGuestbookPost').click(); return 1; })()`);
  await wait(400);
  const gb1 = await ev(`document.getElementById('guestbookList').innerText.replace(/\\s+/g, ' ')`);
  check('留言：写进去后出现在列表里', /到此一游/.test(gb1), gb1.slice(0, 160));

  // 7. 「再看一遍便条」+ 重开档案室
  await ev(`(() => { document.getElementById('btnNoteReplay').click(); return 1; })()`);
  await wait(800);
  const replay = await ev(`(() => ({
    noteShown: document.getElementById('puzzleModal').classList.contains('show'),
    recordsClosed: !document.getElementById('recordsModal').classList.contains('show'),
    reads: Number(localStorage.getItem('dangerPuzzleNoteReads') || 0),
  }))()`);
  check('再看一遍便条：便条重开、档案室收起、翻开次数 +1',
    replay.noteShown && replay.recordsClosed && replay.reads === 2, JSON.stringify(replay));

  await ev(`(() => { window.dangerPuzzle.close(); window.dangerPuzzle.openRecords(); return 1; })()`);
  await wait(700);
  const again = await ev(`(() => ({
    card: document.getElementById('adminCard').innerText.length,
    guest: document.getElementById('guestbookList').innerText.replace(/\\s+/g, ' '),
    solved: window.dangerPuzzle.solved(),
  }))()`);
  check('重开档案室：档案与留言都还在（不是一次性的）',
    again.card > 40 && /到此一游/.test(again.guest) && again.solved, JSON.stringify(again).slice(0, 200));

  console.log('\n页面控制台错误：%d %s', errors.length, errors.slice(0, 3).join(' | '));
  if (errors.length) bad.push({ name: '(控制台)', detail: errors.slice(0, 3).join(' | ') });
  console.log(bad.length ? '\nFAIL: ' + JSON.stringify(bad, null, 1) : '\nPASS: 解谜（便条 + 刮卡）与档案室全部通过');
  ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
