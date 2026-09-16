// 感谢声明页 UI 验收（程序化）：node tests/cdp_thanks.js [调试端口，默认 9222]
// 需先启动（隔离用户数据目录，避免影响本机已有数据）：
//   npx electron . --remote-debugging-port=9222 --user-data-dir=<临时目录>
//   打包态验证：dist/win-unpacked/实验搭子.exe --remote-debugging-port=9223 --user-data-dir=<临时目录>
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
  if (!page) throw new Error('未找到应用页面，请先启动：npx electron . --remote-debugging-port=9222');
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

  // 走真实点击路径：设置 → 感谢声明
  await ev(`(() => { document.getElementById('btnSettings').click(); return 1; })()`);
  await wait(400);
  await ev(`(() => { document.getElementById('btnNavThanks').click(); return 1; })()`);
  await wait(600);

  const out = await ev(`(() => {
    const cs = el => el ? getComputedStyle(el) : null;
    const top = el => el ? Math.round(el.getBoundingClientRect().top) : null;
    const pane = document.getElementById('paneThanks');
    const rows = [...document.querySelectorAll('#thanksList .thanks-row')];
    return {
      设置弹窗已打开: document.getElementById('settingsModal').classList.contains('show'),
      感谢声明面板可见: !!pane && pane.classList.contains('active') && pane.getBoundingClientRect().height > 0,
      请勿点击面板已收起: !document.getElementById('paneDanger').classList.contains('active'),
      导航项激活: document.getElementById('btnNavThanks').classList.contains('active'),
      导航顺序_感谢声明在请勿点击上方: top(document.getElementById('btnNavThanks')) < top(document.getElementById('btnNavDanger')),
      导航顺序_感谢声明在必读公告下方: top(document.getElementById('btnNavThanks')) > top(document.getElementById('btnNavNotice')),
      标题: (pane.querySelector('h4') || {}).textContent,
      条数: rows.length,
      首行: rows[0] ? rows[0].textContent : null,
      全部行: rows.map(r => r.textContent),
      名字样式: rows[0] ? cs(rows[0].querySelector('.thanks-name')).fontWeight : null,
      贡献颜色: rows[0] ? cs(rows[0].querySelector('.thanks-work')).color : null,
      分隔符: rows[0] ? rows[0].querySelector('.thanks-sep').textContent + ' ' + cs(rows[0].querySelector('.thanks-sep')).color : null,
      名单底色: cs(document.getElementById('thanksList')).backgroundColor,
      导航颜色: cs(document.getElementById('btnNavThanks')).color,
      空态文案: (document.querySelector('#thanksList .thanks-empty') || {}).textContent || null
    };
  })()`);
  console.log(JSON.stringify(out, null, 1));

  // 返回其它页再回来：懒加载可重复执行、不残留
  await ev(`(() => { document.getElementById('btnNavAi').click(); return 1; })()`);
  await wait(200);
  await ev(`(() => { document.getElementById('btnNavThanks').click(); return 1; })()`);
  await wait(400);
  const again = await ev(`document.querySelectorAll('#thanksList .thanks-row').length`);
  console.log('二次进入条数:', again);
  await ev(`(() => { document.getElementById('settingsModal').classList.remove('show'); return 1; })()`);
  console.log('页面异常:', errors.length ? errors : '（无）');
  ws.close();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
