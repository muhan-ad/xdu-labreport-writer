// 「请勿点击」效果池验收
//
// 需先启动（隔离用户目录，避免动到本机数据）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
// 用法：node tests/cdp_danger_effects.js [端口，默认 9222] [只跑某个 id]
//
// 检查四类事：
//   1. 确认流程——从「⚠ 请勿点击 ⚠」大按钮开始，必须点满 3 次确认才出效果；
//   2. 千分之一闸门——原神不进随机池，掷骰命中率 ≈ 0.01%；
//   3. 每个效果——跑得完、收得干净（覆盖层/filter/transform/标题栏都复原）、控制台无报错、
//      跑完界面仍可用；顺带记录效果期间的帧间隔；
//   4. 播放过程中的文案——按用户逐条意见删掉的提示不得出现（FORBIDDEN），
//      要求保留/新增的文案必须出现（REQUIRED），并记录它出现的时间点。
'use strict';
const http = require('node:http');
const PORT = Number(process.argv[2] || 9222);
const ONLY = process.argv[3] || '';
const wait = ms => new Promise(r => setTimeout(r, ms));

// 用户明确要求删掉的文案：播放过程中一旦出现即失败
const FORBIDDEN = {
  eruption: ['警告标志喷发中', '10 秒后自动清理'],
  bsod: ['吓到了吧'],
  'self-destruct': ['深呼吸', '再等等', '恭喜，你被吓到了'],
  'formula-storm': ['点一下那些公式试试'],
  'click-counter': ['继续点可以升级', '已无称号可升'],
  'runaway-button': ['按钮会跑', '算了，你点吧', '放弃抵抗'],
  'audio-scale': ['奖励音', '这是你第'],
  'window-shake': ['操作过于危险', '内容替你抖', '窗口已抖动'],
  vanish: ['闪退」特效', '数据一个字没丢'],
  genshin: ['延迟 3ms', '编的', '最高礼遇', '别当真', '比如正在生成实验报告的那个'],
};
// 必须出现的文案：[文案, 是否要求出现在后半程]
const REQUIRED = {
  'self-destruct': [['开玩笑的', false]],
  genshin: [['万分之一', true]],
};

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
  const idle = async () => { for (let i = 0; i < 200; i++) { if (!(await ev('window.dangerEffects.isRunning()'))) return; await wait(250); } };

  const ids = await ev('window.dangerEffects.ids()');
  const list = ONLY ? ids.filter(i => i === ONLY) : ids;
  const bad = [];

  // ── 0. 千分之一彩蛋的闸门 ──
  const rare = await ev(`(() => {
    const odds = window.dangerEffects.RARE_ODDS;
    let pickedRare = 0;
    for (let i = 0; i < 3000; i++) if (window.dangerEffects.pick() === 'genshin') pickedRare++;
    let hits = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) if (window.dangerEffects.rollRare() === 'genshin') hits++;
    return { odds, pickedRare, hits, N, draws: 3000 };
  })()`);
  const rareOk = rare.odds === 0.0001 && rare.pickedRare === 0 && rare.hits > 0;
  console.log('千分之一彩蛋：RARE_ODDS=%s；随机池抽 %d 次命中 %d 次（应 0）；掷骰 %d 次命中 %d 次（%s%%）→ %s\n',
    rare.odds, rare.draws, rare.pickedRare, rare.N, rare.hits, (rare.hits / rare.N * 100).toFixed(3),
    rareOk ? 'OK' : 'FAIL');
  if (!rareOk) bad.push({ id: '(千分之一)', problems: ['闸门或概率不对：' + JSON.stringify(rare)] });

  // ── 1. 确认流程：三次「继续」才出效果 ──
  await idle();
  await ev(`(() => { localStorage.removeItem('dangerClickCount'); localStorage.removeItem('dangerLastEffect');
    document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(400);
  await ev(`(() => { document.getElementById('btnNavDanger').click(); return 1; })()`);
  await wait(300);
  await ev(`(() => { document.getElementById('btnDangerGo').click(); return 1; })()`);
  await wait(380);
  let clicks = 0, started = false;
  const trace = [];
  while (clicks < 6 && !started) {
    clicks += 1;
    await ev(`(() => { document.getElementById('btnDangerProceed').click(); return 1; })()`);
    await wait(350);
    const st = await ev(`(() => ({
      shown: document.getElementById('dangerModal').classList.contains('show'),
      running: window.dangerEffects.isRunning(),
    }))()`);
    trace.push(clicks + (st.shown ? ':弹窗在' : ':弹窗关') + (st.running ? '+效果跑' : ''));
    started = st.running && !st.shown;
  }
  const flowOk = clicks === 3 && started;
  console.log('确认流程：%s → 第 %d 次确认后出效果 %s\n', trace.join(' | '), clicks, flowOk ? 'OK' : 'FAIL（应为第 3 次）');
  if (!flowOk) bad.push({ id: '(确认流程)', problems: ['第 ' + clicks + ' 次确认就出效果'] });
  await ev('window.dangerEffects.cancel()');
  await idle();

  // ── 2. 逐个效果（播放期间采样文案）──
  // 「按钮逃跑」按用户要求"一直躲到被点到"，设计上不会自己结束 —— 单独验证：
  // 造一次靠近鼠标的 mousemove，断言按钮真的跳走了，再中断并检查收尾。
  console.log('效果池共 %d 个，开始逐个验收：\n', ids.length);
  for (const id of list) {
    const errBefore = errors.length;
    const t0 = Date.now();
    await ev(`(() => {
      window.__dxFps = { on: true, times: [] };
      const loop = t => { if (!window.__dxFps.on) return; window.__dxFps.times.push(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      return 1;
    })()`);
    await ev(`window.dangerEffects.run(${JSON.stringify(id)}); 'started'`);
    const samples = [];
    let elapsed = 0;
    let dodgeOk = null, dodgeInfo = null, eruptionInfo = null;
    const maxMs = (id === 'runaway-button') ? 6000 : 40000;
    while (elapsed < maxMs) {
      await wait(250); elapsed += 250;
      const snap = await ev(`(() => ({
        running: window.dangerEffects.isRunning(),
        text: Array.from(document.querySelectorAll('.dx-layer')).map(e => e.innerText || '').join(' ')
          + ' ' + (document.body.innerText || ''),
      }))()`);
      samples.push({ t: elapsed, text: snap.text });
      // 喷发：播放中途（粒子已基本落定）核对粒子数与"互不重叠"
      if (id === 'eruption' && elapsed === 7000) {
        eruptionInfo = await ev(`(() => (window.__dxEruption
          ? { n: window.__dxEruption.parts.length, worst: window.__dxEruption.overlap() }
          : null))()`);
      }
      if (id === 'runaway-button' && elapsed === 1000) {
        // 用 CDP 派发真实的鼠标移动（不是合成 DOM 事件），再看按钮是否瞬移。
        // 按钮带 0.12s 位移过渡，要等动画走完再量。
        const rect = await ev(`(() => {
          const b = document.getElementById('btnDangerGo');
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                   left: b.style.left, top: b.style.top,
                   running: window.dangerEffects.isRunning() };
        })()`);
        dodgeInfo = rect;
        for (let i = 0; i < 4; i++) {
          await send(ws, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: rect.x + i, y: rect.y, button: 'none', clickCount: 0,
          });
          await wait(60);
        }
        await wait(350);
        const after = await ev(`(() => {
          const b = document.getElementById('btnDangerGo');
          return { left: b.style.left, top: b.style.top };
        })()`);
        dodgeOk = rect.running && (after.left !== rect.left || after.top !== rect.top);
      }
      if (!snap.running && elapsed > 500) break;
    }
    if (id === 'runaway-button') await ev('window.dangerEffects.cancel()');
    await wait(400);
    const fps = await ev(`(() => {
      window.__dxFps.on = false;
      const t = window.__dxFps.times;
      if (!t || t.length < 4) return null;
      const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
      return { avg: d.reduce((s, x) => s + x, 0) / d.length, p95: d[Math.floor(d.length * 0.95)] };
    })()`);
    await wait(500);
    const st = await ev(`(() => {
      const root = document.getElementById('app') || document.body;
      return {
        running: window.dangerEffects.isRunning(),
        layers: document.querySelectorAll('.dx-layer').length,
        filter: root.style.filter || '',
        transform: root.style.transform || '',
        titlebar: (document.querySelector('.titlebar-name') || {}).textContent || '',
        brand: (document.querySelector('.brand-title') || {}).textContent || '',
        settingsBtn: !!document.getElementById('btnSettings'),
        guts: (document.body.innerText.match(/咕/g) || []).length,
        cursorNoneLeft: Array.from(document.querySelectorAll('style')).some(s => /cursor:none/.test(s.textContent || '')),
      };
    })()`);
    const newErrs = errors.slice(errBefore);
    const problems = [];
    if (st.running) problems.push('效果没有结束（看门狗异常）');
    if (st.layers) problems.push('残留覆盖层 ' + st.layers + ' 个');
    if (st.filter) problems.push('filter 未复原');
    if (st.transform) problems.push('transform 未复原');
    if (st.titlebar !== '实验搭子') problems.push('标题栏未复原（' + st.titlebar + '）');
    if (st.brand !== '实验报告') problems.push('品牌标题未复原（' + st.brand + '）');
    if (!st.settingsBtn) problems.push('界面元素丢失');
    if (id === 'pigeon' && st.guts > 3) problems.push('咕化没有恢复（正文仍有 ' + st.guts + ' 个咕）');
    if (st.cursorNoneLeft) problems.push('cursor:none 样式残留');
    if (id === 'eruption') {
      if (!eruptionInfo) problems.push('播放期间取不到粒子状态（调试钩子缺失）');
      else {
        if (eruptionInfo.n < 240) problems.push('粒子数偏少（' + eruptionInfo.n + '，要求 260）');
        if (eruptionInfo.worst > 1.5) problems.push('粒子重叠最深 ' + eruptionInfo.worst.toFixed(2) + 'px（要求互不重叠）');
      }
    }
    if (id === 'runaway-button' && dodgeOk === false) {
      problems.push('鼠标靠近时按钮没有躲开（' + JSON.stringify(dodgeInfo) + '）');
    }
    if (newErrs.length) problems.push('控制台报错: ' + newErrs.join(' / ').slice(0, 160));
    for (const word of FORBIDDEN[id] || []) {
      if (samples.some(s => s.text.includes(word))) problems.push('出现了要求删掉的文案：' + word);
    }
    for (const [word, late] of REQUIRED[id] || []) {
      const hit = samples.find(s => s.text.includes(word));
      if (!hit) problems.push('缺少要求的文案：' + word);
      else if (late && hit.t < samples[samples.length - 1].t * 0.6) {
        problems.push('文案「' + word + '」出现太早（第 ' + hit.t + 'ms / 共 ' + samples[samples.length - 1].t + 'ms）');
      }
    }
    const ok = problems.length === 0;
    if (!ok) bad.push({ id, problems });
    const took = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    const fpsTxt = fps ? '  帧间隔 ' + fps.avg.toFixed(1) + 'ms (p95 ' + fps.p95.toFixed(1) + 'ms)' : '';
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + id.padEnd(16) + ' ' + took + 's' + fpsTxt
      + (ok ? '' : '  ← ' + problems.join('；')));
  }

  // ── 3. 跑完还能用 ──
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(400);
  const usable = await ev(`(() => {
    document.getElementById('btnNavDanger').click();
    const p = document.getElementById('paneDanger');
    return p.classList.contains('active') && p.getBoundingClientRect().height > 0;
  })()`);
  console.log('\n跑完全部效果后界面可用：%s', usable ? '是' : '否');
  if (!usable) bad.push({ id: '(界面)', problems: ['跑完效果后设置/彩蛋页不可用'] });

  console.log(bad.length ? '\nFAIL: ' + JSON.stringify(bad, null, 1) : '\nPASS: 确认流程 + 千分之一闸门 + 全部效果（含文案断言）通过');
  ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
