// 识别弹窗 UI 对齐验收（程序化）：node tests/cdp_recog.js
// 需先启动：dist/win-unpacked/实验搭子.exe --remote-debugging-port=9222
'use strict';
const http = require('node:http');
const wait = ms => new Promise(r => setTimeout(r, ms));

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path: '/json/list', timeout: 5000 }, res => {
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

const MEASURE = `(() => {
  const modal = document.querySelector('#recognizeModal .modal');
  const footer = document.querySelector('#recognizeModal .modal-footer');
  const drop = document.getElementById('recogDrop');
  const cs = el => el ? getComputedStyle(el) : null;
  const box = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) }; };
  const onlyEmpty = document.querySelector('.recog-only-empty');
  const applyBtn = document.getElementById('btnApplyRecognize');
  const badge = s => { const e = document.querySelector('.recog-badge.' + s); const c = cs(e); return c ? c.backgroundColor + ' / ' + c.color : null; };
  return {
    modalSize: box(modal),
    footerJustify: cs(footer).justifyContent,
    footerLeftFirst: Math.round(onlyEmpty.getBoundingClientRect().left) < Math.round(applyBtn.getBoundingClientRect().left),
    drop: { padding: cs(drop).padding, background: cs(drop).backgroundColor, borderColor: cs(drop).borderColor, borderStyle: cs(drop).borderStyle },
    dropSvgSize: (() => { const s = drop.querySelector('svg'); return s ? box(s).w + 'x' + box(s).h : null; })(),
    loadingText: (() => { const c = cs(document.getElementById('recogLoadingText')); return c.fontSize + ' / ' + c.color; })(),
    summaryText: (() => { const c = cs(document.getElementById('recogSummary')); return c.fontSize + ' / ' + c.color; })(),
    badges: { ok: badge('ok'), warn: badge('warn'), fail: badge('fail') },
    vars: (() => { const r = getComputedStyle(document.documentElement);
      return { accent: r.getPropertyValue('--accent').trim(), successLight: r.getPropertyValue('--success-light').trim(),
               warningLight: r.getPropertyValue('--warning-light').trim(), dangerLight: r.getPropertyValue('--danger-light').trim(),
               textSecondary: r.getPropertyValue('--text-secondary').trim(), cardHover: r.getPropertyValue('--card-hover').trim() }; })()
  };
})()`;

(async () => {
  const page = (await listTargets()).find(t => t.type === 'page' && /index\.html/.test(t.url));
  const ws = await new Promise((res, rej) => { const w = new WebSocket(page.webSocketDebuggerUrl); w.onopen = () => res(w); w.onerror = rej; });
  await send(ws, 'Runtime.enable');
  const ev = async e => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  // 打开识别弹窗（直接显示遮罩，不依赖是否选了实验）
  await ev(`(() => { document.getElementById('recognizeModal').classList.add('show'); return 1; })()`);
  await wait(500);
  const m = await ev(MEASURE);
  console.log(JSON.stringify(m, null, 1));
  // hover 拖拽区，检查边框是否变绿
  const r = await ev(`(() => { const d = document.getElementById('recogDrop').getBoundingClientRect(); return { x: Math.round(d.left + d.width/2), y: Math.round(d.top + d.height/2) }; })()`);
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await wait(250);
  const hover = await ev(`(() => { const c = getComputedStyle(document.getElementById('recogDrop')); return c.borderColor + ' / ' + c.backgroundColor; })()`);
  console.log('hover 拖拽区:', hover);
  await ev(`(() => { document.getElementById('recognizeModal').classList.remove('show'); return 1; })()`);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
