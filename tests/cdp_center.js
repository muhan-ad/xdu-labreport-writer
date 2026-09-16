// 诊断：弹窗在遮罩层里的居中偏移来源
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

(async () => {
  const page = (await listTargets()).find(t => t.type === 'page' && /index\.html/.test(t.url));
  const ws = await new Promise((res, rej) => { const w = new WebSocket(page.webSocketDebuggerUrl); w.onopen = () => res(w); w.onerror = rej; });
  await send(ws, 'Runtime.enable');
  const ev = async e => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await ev(`document.getElementById('studentModal').classList.add('show')`);
  await wait(600);
  const info = await ev(`(() => {
    const ov = document.getElementById('studentModal');
    const m = ov.querySelector('.modal');
    const o = ov.getBoundingClientRect(), r = m.getBoundingClientRect();
    const cs = getComputedStyle(ov), cm = getComputedStyle(m);
    return { viewportH: window.innerHeight,
             overlay: { top: Math.round(o.top), h: Math.round(o.height), clientH: ov.clientHeight, scrollH: ov.scrollHeight,
                        padding: cs.padding, overflowY: cs.overflowY, alignItems: cs.alignItems, display: cs.display },
             modal: { top: Math.round(r.top), h: Math.round(r.height), margin: cm.margin, transform: cm.transform },
             gaps: { above: Math.round(r.top - o.top), below: Math.round(o.bottom - r.bottom) },
             children: ov.children.length,
             customScrollbar: getComputedStyle(document.documentElement).scrollbarWidth };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  await ev(`document.getElementById('studentModal').classList.remove('show')`);
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
