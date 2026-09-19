// 「请勿点击」效果池验收：逐个跑一遍，检查每个效果都能自己收干净
//
// 需先启动（隔离用户目录，避免动到本机数据）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
// 用法：node tests/cdp_danger_effects.js [端口，默认 9222] [只跑某个 id]
//
// 每个效果断言三件事：
//   1. 跑得完（看门狗没被触发、没有 JS 异常）；
//   2. 收得干净（.dx-layer 全部移除、body 的 filter/transform 复原、标题栏文字复原）；
//   3. 界面还能用（设置按钮还在、能正常点开设置）。
'use strict';
const http = require('node:http');
const PORT = Number(process.argv[2] || 9222);
const ONLY = process.argv[3] || '';
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
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  const ids = await ev(`window.dangerEffects.ids()`);
  const list = ONLY ? ids.filter(i => i === ONLY) : ids;
  const bad = [];

  // ── 0. 千分之一彩蛋的闸门：原神不进随机池；掷骰子命中率应 ≈ 0.1% ──
  const rare = await ev(`(() => {
    const odds = window.dangerEffects.RARE_ODDS;
    let pickedRare = 0;
    for (let i = 0; i < 3000; i++) if (window.dangerEffects.pick() === 'genshin') pickedRare++;
    let hits = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (window.dangerEffects.rollRare() === 'genshin') hits++;
    return { odds, pickedRare, hits, N, draws: 3000 };
  })()`);
  const rate = (rare.hits / rare.N * 100).toFixed(3);
  const rareOk = rare.odds === 0.001 && rare.pickedRare === 0 && rare.hits > 0;
  console.log('千分之一彩蛋：RARE_ODDS=%s；随机池抽 %d 次命中 %d 次（应 0）；掷骰 %d 次命中 %d 次（%s%%）→ %s\n',
    rare.odds, rare.draws, rare.pickedRare, rare.N, rare.hits, rate, rareOk ? 'OK' : 'FAIL');
  if (!rareOk) bad.push({ id: '(千分之一)', problems: ['闸门或概率不对：' + JSON.stringify(rare)] });

  // ── 先验证"要走完三步确认才出效果"（曾经的误解来源：测试直接调 run() 会绕过 UI）──
  await ev(`(() => { localStorage.removeItem('dangerClickCount'); return 1; })()`);
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(350);
  await ev(`(() => { document.getElementById('btnNavDanger').click(); return 1; })()`);
  await wait(250);
  await ev(`(() => { document.getElementById('btnDangerGo').click(); return 1; })()`);
  await wait(350);
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
    started = st.running && !st.shown;      // 只有"弹窗关了且效果在跑"才算真的触发
  }
  const flowOk = clicks === 3 && started;
  console.log('真实点击路径：%s → 第 %d 次确认后出效果 %s', trace.join(' | '), clicks,
    flowOk ? 'OK' : 'FAIL（应为第 3 次）');
  if (!flowOk) bad.push({ id: '(确认流程)', problems: ['第 ' + clicks + ' 次确认就出效果'] });
  await ev(`window.dangerEffects.cancel()`);
  // 等上一步触发的效果彻底收尾，否则后面的 run() 会被"已有效果在跑"挡掉（误判成失败）
  for (let i = 0; i < 40 && await ev(`window.dangerEffects.isRunning()`); i++) await wait(250);

  console.log('效果池共 %d 个，开始逐个验收：\n', ids.length);
  for (const id of list) {
    const errBefore = errors.length;
    const t0 = Date.now();
    // 帧率探针：看效果期间主线程有没有被压住（喷发曾经每帧 fillText emoji，卡到掉帧）
    await ev(`(() => {
      window.__dxFps = { on: true, times: [] };
      const loop = t => { if (!window.__dxFps.on) return; window.__dxFps.times.push(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      return 1;
    })()`);
    const accepted = await ev(`window.dangerEffects.run(${JSON.stringify(id)}).then(() => 'done').then(v => window.dangerEffects.isRunning() ? 'busy' : v)`);
    if (accepted === 'busy') {
      // 上一个效果还没收尾：等它结束再重试一次（别把"忙"误判成"没结束"）
      for (let i = 0; i < 40 && await ev(`window.dangerEffects.isRunning()`); i++) await wait(250);
      await ev(`window.dangerEffects.run(${JSON.stringify(id)}).then(() => 'done')`);
    }
    const fps = await ev(`(() => {
      window.__dxFps.on = false;
      const t = window.__dxFps.times;
      if (!t || t.length < 4) return null;
      const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
      return { frames: t.length, avg: d.reduce((s, x) => s + x, 0) / d.length,
               p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] };
    })()`);
    // 等本效果自己的清理与 Toast 收尾
    await wait(400);
    const st = await ev(`(() => {
      const root = document.getElementById('app') || document.body;
      const cs = getComputedStyle(root);
      return {
        running: window.dangerEffects.isRunning(),
        layers: document.querySelectorAll('.dx-layer').length,
        filter: root.style.filter || '',
        transform: root.style.transform || '',
        titlebar: (document.querySelector('.titlebar-name') || {}).textContent || '',
        brand: (document.querySelector('.brand-title') || {}).textContent || '',
        settingsBtn: !!document.getElementById('btnSettings'),
        clickCount: Number(localStorage.getItem('dangerClickCount') || 0),
      };
    })()`);
    const newErrs = errors.slice(errBefore);
    const problems = [];
    if (st.running) problems.push('效果没有结束（看门狗异常）');
    if (st.layers) problems.push(`残留覆盖层 ${st.layers} 个`);
    if (st.filter) problems.push('filter 未复原');
    if (st.transform) problems.push('transform 未复原');
    if (st.titlebar !== '实验搭子') problems.push(`标题栏未复原（${st.titlebar}）`);
    if (st.brand !== '实验报告') problems.push(`品牌标题未复原（${st.brand}）`);
    if (!st.settingsBtn) problems.push('界面元素丢失');
    if (newErrs.length) problems.push('控制台报错: ' + newErrs.join(' / ').slice(0, 160));
    const ok = problems.length === 0;
    if (!ok) bad.push({ id, problems });
    const took = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
    const fpsTxt = fps ? `  平均帧间隔 ${fps.avg.toFixed(1)}ms（≈${(1000 / fps.avg).toFixed(0)}fps）p95 ${fps.p95.toFixed(1)}ms` : '';
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(16)} ${took}s${fpsTxt}${ok ? '' : '  ← ' + problems.join('；')}`);
  }

  // 效果跑完后界面仍然可用：能开设置、能进「请勿点击」页
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(400);
  const usable = await ev(`(() => {
    document.getElementById('btnNavDanger').click();
    const p = document.getElementById('paneDanger');
    const r = p.getBoundingClientRect();
    return p.classList.contains('active') && r.height > 0;
  })()`);
  console.log('\n跑完全部效果后界面可用：%s', usable ? '是' : '否');
  if (!usable) bad.push({ id: '(界面)', problems: ['跑完效果后设置/彩蛋页不可用'] });

  console.log(bad.length ? '\nFAIL: ' + JSON.stringify(bad, null, 1) : '\nPASS: 所有效果都能跑完并自行复原');
  ws.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
