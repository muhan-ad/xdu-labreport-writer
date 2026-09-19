// 设置导航可见性验收（程序化）：11 个导航项都要在可视区内（曾因弹窗固定 560px 高、
// 导航不滚动，把最后一项「请勿点击」裁掉了）。
// 需先启动（隔离用户数据目录）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
// 用法：node tests/cdp_settings_nav.js [端口，默认 9222]
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
  const ev = async e => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(500);

  const before = await ev(`(() => {
    const nav = document.querySelector('.settings-nav');
    const items = [...nav.querySelectorAll('.settings-nav-item')];
    const danger = document.getElementById('btnNavDanger');
    const nb = nav.getBoundingClientRect(), db = danger.getBoundingClientRect();
    return {
      items: items.length,
      navScrollHeight: nav.scrollHeight, navClientHeight: nav.clientHeight,
      overflowY: getComputedStyle(nav).overflowY,
      dangerInside: db.top >= nb.top - 1 && db.bottom <= nb.bottom + 1,
      dangerTitle: danger.textContent.trim(),
      dangerVisible: db.height > 0 && db.bottom <= nb.bottom + 1,
    };
  })()`);
  console.log('展开设置后：', JSON.stringify(before, null, 1));

  // 走真实点击：进「请勿点击」页，检查那个大按钮可见
  await ev(`(() => { document.getElementById('btnNavDanger').click(); return 1; })()`);
  await wait(400);
  const pane = await ev(`(() => {
    const p = document.getElementById('paneDanger');
    const btn = document.getElementById('btnDangerGo');
    const pb = p.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    return {
      paneActive: p.classList.contains('active'),
      paneVisible: p.offsetHeight > 0,
      btnText: btn.textContent.trim().replace(/\\s+/g, ' '),
      btnInsidePane: bb.top >= pb.top - 1 && bb.bottom <= pb.bottom + 1,
      btnRect: [Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height)],
      paneRect: [Math.round(pb.left), Math.round(pb.top), Math.round(pb.width), Math.round(pb.height)],
    };
  })()`);
  console.log('进入请勿点击页：', JSON.stringify(pane, null, 1));

  const ok = before.dangerInside && before.dangerVisible && pane.paneActive && pane.paneVisible && pane.btnInsidePane;
  console.log(ok ? 'PASS: 导航与「请勿点击」按钮均可见' : 'FAIL: 仍被裁切');
  ws.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
