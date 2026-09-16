// 布局诊断：读取设置弹窗内距/滚动与其它弹窗居中的真实几何数据
// 用法：先启动 dist/win-unpacked/实验搭子.exe --remote-debugging-port=9222，再 node tests/cdp_measure.js
'use strict';
const http = require('node:http');

const PORT = process.env.CDP_PORT || 9222;

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json/list', timeout: 5000 }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

let seq = 0;
function send(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMsg);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const targets = await listTargets();
  const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url)) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('未找到页面目标');
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(page.webSocketDebuggerUrl);
    w.onopen = () => resolve(w);
    w.onerror = e => reject(new Error('WS 连接失败: ' + (e.message || e.type)));
  });
  const evaluate = async expression => {
    const r = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };

  await send(ws, 'Runtime.enable');

  // 1) 设置弹窗：内距 + 各页滚动能力
  await evaluate(`document.getElementById('btnAiConfig').click()`);
  await new Promise(r => setTimeout(r, 500));
  await evaluate(`document.getElementById('btnNavAi').click()`);
  await evaluate(`document.getElementById('btnOpenApiConfig').click()`);
  await new Promise(r => setTimeout(r, 300));

  const geo = await evaluate(`(() => {
    const body = document.querySelector('#settingsModal .modal-body');
    const nav = document.querySelector('.settings-nav').getBoundingClientRect();
    const panes = document.querySelector('.settings-panes');
    const pr = panes.getBoundingClientRect();
    const modal = document.querySelector('#settingsModal .modal').getBoundingClientRect();
    return { bodyPadding: getComputedStyle(body).padding,
             navLeftInset: Math.round(nav.left - modal.left),
             panesRightInset: Math.round(modal.right - pr.right),
             panesHeight: panes.clientHeight, contentHeight: panes.scrollHeight,
             scrollNeeded: panes.scrollHeight - panes.clientHeight };
  })()`);
  console.log('设置弹窗几何:', JSON.stringify(geo));

  const users = ['btnNavSkills', 'btnNavCustomVariants', 'btnNavReports', 'btnNavHelp',
    'btnNavUpdate', 'paneFeedbackX', 'paneDevelopX', 'btnNavNotice', 'btnNavDanger'];
  const ids = ['btnNavSkills', 'btnNavCustomVariants', 'btnNavReports', 'btnNavHelp',
    'btnNavUpdate', 'btnNavFeedback', 'btnNavDevelop', 'btnNavNotice', 'btnNavDanger'];
  for (const id of ids) {
    await evaluate(`(() => { const b = document.getElementById('${id}'); if (b) b.click(); return 1; })()`);
    await new Promise(r => setTimeout(r, 220));
    const m = await evaluate(`(() => {
      const p = document.querySelector('.settings-panes');
      const max = p.scrollHeight - p.clientHeight;
      p.scrollTop = 99999;
      const reached = Math.round(p.scrollTop);
      const pane = document.querySelector('.settings-pane.active');
      const els = Array.from(pane.querySelectorAll('button, input, select, textarea, li, .form-hint'))
        .filter(el => el.offsetParent !== null && el.getBoundingClientRect().height > 0);
      const last = els[els.length - 1];
      const pr = p.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      const res = { pane: pane.id, maxScroll: max, scrolledTo: reached,
                    lastId: last.id || last.tagName, visibleAtBottom: lr.bottom <= pr.bottom + 1 };
      p.scrollTop = 0;
      return res;
    })()`);
    console.log('  ' + JSON.stringify(m));
  }

  // 2) 其它弹窗：居中与是否在视口内
  await evaluate(`document.getElementById('btnCloseSettings').click()`);
  await new Promise(r => setTimeout(r, 300));
  for (const id of ['studentModal', 'updateModal', 'recognizeModal']) {
    const m = await evaluate(`(() => {
      const ov = document.getElementById('${id}');
      if (!ov) return { id: '${id}', missing: true };
      ov.classList.add('show');
      const r = ov.querySelector('.modal').getBoundingClientRect();
      const above = Math.round(r.top), below = Math.round(innerHeight - r.bottom);
      const out = { id: '${id}', topGap: above, bottomGap: below, centered: Math.abs(above - below) <= 8,
                    insideViewport: r.top >= -1 && r.bottom <= innerHeight + 1, scrollable: ov.scrollHeight > ov.clientHeight };
      ov.classList.remove('show');
      return out;
    })()`);
    console.log('弹窗:', JSON.stringify(m));
    await new Promise(r => setTimeout(r, 200));
  }

  ws.close();
}

main().catch(e => { console.error('诊断失败:', e.message); process.exit(1); });
