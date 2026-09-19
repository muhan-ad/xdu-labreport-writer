// danger-puzzle.js — 「请勿点击」里的解谜彩蛋：一张便条 → 档案室
//
// 流线：
//   ① 五分钟内连续触发十次彩蛋（见 danger-effects.js 的 noteTriggerTime()）→ 「请勿点击」页
//      里冒出「🔒 解谜」区块，并自动把便条推到眼前；
//   ② 便条上是一道题：请输入管理员姓名。提示：I'll eat my head。便条下半张被"糊住"了，
//      按住鼠标蹭一蹭（把他的头吃掉 = 擦掉上层）会露出线索：
//      「《雾都孤儿》里那位总说要吃掉自己脑袋的老先生。」→ 写下 Grimwig；
//   ③ 答对 → 进入【档案室】页面：管理员档案 + 你的解谜记录 + 彩蛋手册（收集进度）+ 留言。
//
// 谜底：Grimwig —— 狄更斯《雾都孤儿》里的 Mr. Grimwig，口头禅就是 "I'll eat my head"。
// 判定：归一化后比较（去空格/连字符/点/中英标点、转小写），改谜底只改 ANSWERS 一行。
//
// 记录（全部只存本机 localStorage，不上传）：
//   dangerPuzzleSolvedAt / dangerPuzzleTries / dangerPuzzleScratchPct / dangerPuzzleNoteReads
//   dangerClickCount / dangerClickTimes / dangerEffectCounts / dangerGuestbook
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const ENTRY_KEY = 'dangerPuzzleEntry';
  const AUTO_OPENED_KEY = 'dangerPuzzleAutoOpened';
  const SOLVED_KEY = 'dangerPuzzleSolvedAt';
  const TRIES_KEY = 'dangerPuzzleTries';
  const SCRATCH_KEY = 'dangerPuzzleScratchPct';
  const READS_KEY = 'dangerPuzzleNoteReads';
  const GUEST_KEY = 'dangerGuestbook';
  // 谜底（归一化后比较）。想换谜底改这里即可。
  const ANSWERS = ['grimwig', 'mrgrimwig', 'muhan', '慕寒'];
  // 档案（这个人是谁）——只在档案室里展示，不参与判定
  const PROFILE = {
    name: 'Grimwig',
    aka: 'Mr. Grimwig',
    lines: [
      ['身份', '秋荻文学社社长 · 武协管理者之一'],
      ['出处', '狄更斯《雾都孤儿》'],
      ['口头禅', '“I’ll eat my head.”'],
    ],
    quote: '凡是他说要吃掉脑袋的事，最后都没发生 —— 除了这次被你点出来了。',
  };

  const norm = s => String(s == null ? '' : s)
    .trim().toLowerCase()
    .replace(/[\s_\-·.。，,、'’"“”()（）!！?？:：;；]/g, '');
  const read = (k, d = '') => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const num = (k, d = 0) => {
    const raw = read(k, '');
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) ? n : d;
  };

  const solved = () => !!read(SOLVED_KEY);
  const entryRevealed = () => read(ENTRY_KEY) === '1';
  const tries = () => num(TRIES_KEY, 0);

  const fmtTime = ts => {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    const p = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtDur = ms => {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  };
  const toast = (t, d, ms) => { try { if (typeof showToast === 'function') showToast('warning', t, d, ms); } catch (_) {} };

  // ── 刮刮卡：擦掉上层（"把他的头吃掉"），露出下面的线索 ──
  const scratch = { ready: false, pct: 0, cells: null, cols: 0, rows: 0, drawing: false };
  function initScratch() {
    const cv = $('scratchCanvas');
    const wrap = $('scratchWrap');
    if (!cv || !wrap) return;
    const w = wrap.clientWidth || 420, h = wrap.clientHeight || 96;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = '100%'; cv.style.height = '100%';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#c9c2b4';                       // "糊住的头"：一层带纹理的灰纸
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${120 + Math.random() * 80 | 0},${115 + Math.random() * 70 | 0},${100 + Math.random() * 60 | 0},.5)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 9, 2 + Math.random() * 4);
    }
    ctx.fillStyle = 'rgba(60,52,40,.75)';
    ctx.font = '600 13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText('把头吃掉 →', 14, h / 2 + 5);
    ctx.globalCompositeOperation = 'destination-out';
    scratch.cols = Math.max(1, Math.ceil(w / 14));
    scratch.rows = Math.max(1, Math.ceil(h / 14));
    scratch.cells = new Uint8Array(scratch.cols * scratch.rows);
    scratch.pct = 0;
    scratch.ready = true;
  }
  function scratchAt(clientX, clientY) {
    const cv = $('scratchCanvas');
    if (!cv || !scratch.ready) return;
    const r = cv.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < -20 || y < -20 || x > r.width + 20 || y > r.height + 20) return;
    const ctx = cv.getContext('2d');
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    const c = Math.min(scratch.cols - 1, Math.max(0, Math.floor(x / 14)));
    const rr = Math.min(scratch.rows - 1, Math.max(0, Math.floor(y / 14)));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cc = c + dx, rrr = rr + dy;
        if (cc < 0 || rrr < 0 || cc >= scratch.cols || rrr >= scratch.rows) continue;
        scratch.cells[rrr * scratch.cols + cc] = 1;
      }
    }
    let hit = 0;
    for (let i = 0; i < scratch.cells.length; i++) hit += scratch.cells[i];
    scratch.pct = Math.round(hit / scratch.cells.length * 100);
    if (scratch.pct > num(SCRATCH_KEY, 0)) write(SCRATCH_KEY, String(scratch.pct));
    if (scratch.pct >= 55) {
      const tip = $('scratchTip');
      if (tip) tip.textContent = `露出来了（你吃掉了 ${scratch.pct}% 的脑袋）—— 写下他的名字。`;
    }
  }
  function bindScratch() {
    const cv = $('scratchCanvas');
    if (!cv) return;
    cv.addEventListener('mousedown', e => { scratch.drawing = true; scratchAt(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mouseup', () => { scratch.drawing = false; });
    cv.addEventListener('mousemove', e => { if (scratch.drawing) scratchAt(e.clientX, e.clientY); });
    cv.addEventListener('mouseleave', () => { scratch.drawing = false; });
    cv.addEventListener('touchstart', e => { scratch.drawing = true; const t = e.touches[0]; scratchAt(t.clientX, t.clientY); }, { passive: true });
    cv.addEventListener('touchmove', e => { if (!scratch.drawing) return; const t = e.touches[0]; scratchAt(t.clientX, t.clientY); }, { passive: true });
    cv.addEventListener('touchend', () => { scratch.drawing = false; });
  }

  // ── 便条 ──
  function openNote() {
    if ($('puzzleMsg')) $('puzzleMsg').textContent = '';
    if ($('puzzleInput')) $('puzzleInput').value = '';
    write(READS_KEY, String(num(READS_KEY, 0) + 1));
    if (typeof openModal === 'function') openModal('puzzleModal');
    setTimeout(() => {
      initScratch();
      const i = $('puzzleInput');
      if (i) i.focus();
    }, 80);
  }
  const closeNote = () => { if (typeof closeModal === 'function') closeModal('puzzleModal'); };

  function submit() {
    const guess = norm($('puzzleInput') ? $('puzzleInput').value : '');
    if (!guess) { $('puzzleMsg').textContent = '先写个名字吧 —— 便条下半张就是线索。'; return false; }
    const n = tries() + 1;
    write(TRIES_KEY, String(n));
    if (ANSWERS.includes(guess)) {
      if (!solved()) write(SOLVED_KEY, String(Date.now()));
      closeNote();
      openRecords();
      celebrate();
      return true;
    }
    const hints = [
      '不是这个名字。便条上那句 I\'ll eat my head 是线索 —— 想想谁把它当口头禅。',
      '再想想：这是位小说人物，动不动就拿"吃掉我的脑袋"起誓。',
      '提示到这儿：那句话出自狄更斯的《雾都孤儿》，去搜一下它是谁的口头禅。',
    ];
    $('puzzleMsg').textContent = '不对。' + hints[Math.min(n - 1, hints.length - 1)];
    return false;
  }

  // ── 档案室 ──
  function renderAdminCard() {
    const el = $('adminCard');
    if (!el) return;
    el.innerHTML = ''
      + '<div class="records-avatar">⚔️📖</div>'
      + `<div class="records-name">${PROFILE.name}<span class="records-aka">（${PROFILE.aka}）</span></div>`
      + '<div class="records-lines">'
      + PROFILE.lines.map(([k, v]) => `<div><span class="records-k">${k}</span>${v}</div>`).join('')
      + '</div>'
      + `<div class="records-quote">${PROFILE.quote}</div>`;
  }

  function renderSolveRecords() {
    const el = $('solveRecords');
    if (!el) return;
    let times = [];
    try { times = JSON.parse(read('dangerClickTimes', '[]')) || []; } catch (_) {}
    const solvedAt = num(SOLVED_KEY, 0);
    const firstTrigger = times.length ? Math.min(...times) : 0;
    const span = solvedAt && firstTrigger ? fmtDur(solvedAt - firstTrigger) : '—';
    el.innerHTML = ''
      + `<div><span class="records-k">首次解开</span>${fmtTime(solvedAt)}</div>`
      + `<div><span class="records-k">从头到尾用了</span>${span}（从这一轮第一次触发彩蛋算起）</div>`
      + `<div><span class="records-k">解谜尝试</span>${tries()} 次　·　便条翻开 ${num(READS_KEY, 0)} 次</div>`
      + `<div><span class="records-k">吃掉的脑袋</span>${num(SCRATCH_KEY, 0)}%（刮开比例）</div>`
      + `<div><span class="records-k">「请勿点击」累计</span>${num('dangerClickCount', 0)} 次　·　近 5 分钟 `
      + `${window.dangerEffects ? window.dangerEffects.clickWindow() : 0} 次</div>`;
  }

  function renderHandbook() {
    const el = $('eggHandbook');
    if (!el || !window.dangerEffects) return;
    let counts = {};
    try { counts = JSON.parse(read('dangerEffectCounts', '{}')) || {}; } catch (_) {}
    const ids = window.dangerEffects.ids();
    const names = window.dangerEffects.names();          // 'id: 中文名'
    const seen = ids.filter(id => counts[id] > 0).length;
    if ($('handbookCount')) $('handbookCount').textContent = `　已点亮 ${seen}/${ids.length}`;
    el.innerHTML = ids.map((id, i) => {
      const label = String(names[i] || id).split(': ')[1] || id;
      const n = Number(counts[id]) || 0;
      return `<span class="handbook-item${n ? ' on' : ''}" title="${id}">${n ? '✦' : '·'} ${label}${n > 1 ? ' ×' + n : ''}</span>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderGuestbook() {
    const el = $('guestbookList');
    if (!el) return;
    let list = [];
    try { list = JSON.parse(read(GUEST_KEY, '[]')) || []; } catch (_) {}
    if (!list.length) { el.innerHTML = '<div class="guest-empty">还没有人留下字 —— 你是第一个摸到这儿的。</div>'; return; }
    el.innerHTML = list.slice().reverse().map(g =>
      `<div class="guest-row"><span class="guest-who">${escapeHtml(g.who || '无名')}</span>`
      + `<span class="guest-time">${fmtTime(g.t)}</span><div class="guest-text">${escapeHtml(g.text)}</div></div>`
    ).join('');
  }

  function postGuestbook() {
    const inp = $('guestbookInput');
    const text = ((inp && inp.value) || '').trim();
    if (!text) { toast('还没写字', '写一句再留下吧', 2200); return false; }
    let who = '无名';
    try {
      if (typeof loadStudentInfo === 'function') {
        const s = loadStudentInfo() || {};
        who = s.name || s.id || '无名';
      }
    } catch (_) {}
    let list = [];
    try { list = JSON.parse(read(GUEST_KEY, '[]')) || []; } catch (_) {}
    list.push({ t: Date.now(), who, text: text.slice(0, 80) });
    write(GUEST_KEY, JSON.stringify(list.slice(-50)));
    if (inp) inp.value = '';
    renderGuestbook();
    toast('已记下', '这句话留在这台电脑上了', 2400);
    return true;
  }

  function openRecords() {
    renderAdminCard();
    renderSolveRecords();
    renderHandbook();
    renderGuestbook();
    if ($('btnRecords')) $('btnRecords').hidden = false;
    if (typeof openModal === 'function') openModal('recordsModal');
  }
  const closeRecords = () => { if (typeof closeModal === 'function') closeModal('recordsModal'); };

  // ── 入口（五分钟内 10 次才露出来）──
  function showEntry(auto) {
    const sec = $('puzzleSection');
    if (sec) sec.hidden = false;
    if (auto && read(AUTO_OPENED_KEY) !== '1') {
      write(AUTO_OPENED_KEY, '1');
      setTimeout(() => openNote(), 700);
    }
  }
  function applyEntryState() {
    if (entryRevealed()) showEntry(false);
    const hint = $('puzzleStateHint');
    if (hint) {
      if (solved()) hint.textContent = `已解开（${fmtTime(num(SOLVED_KEY, 0))}）—— 档案室随时可以再进。`;
      else if (entryRevealed()) hint.textContent = '入口是你自己点出来的 —— 谜底和这个软件的主人有关。';
      else hint.textContent = '';
    }
    if (solved() && $('btnRecords')) $('btnRecords').hidden = false;
  }

  // 通关庆祝：礼花 + 底部提示条（效果池里的 unlock，权重 0，不会被随机抽到）
  function celebrate() { try { if (window.dangerEffects) window.dangerEffects.run('unlock'); } catch (_) {} }

  function bind() {
    const set = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    set('btnDangerPuzzle', openNote);
    set('btnPuzzleSubmit', submit);
    set('btnPuzzleCancel', closeNote);
    set('btnNoteClose', closeNote);
    set('btnRecords', openRecords);
    set('btnRecordsClose', closeRecords);
    set('btnGuestbookPost', postGuestbook);
    set('btnNoteReplay', () => { closeRecords(); setTimeout(openNote, 250); });
    const input = $('puzzleInput');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const gb = $('guestbookInput');
    if (gb) gb.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); postGuestbook(); } });
    bindScratch();

    document.addEventListener('danger:puzzle-entry', () => {
      showEntry(true);
      if (!solved()) toast('你成功了', '连续点击已达标：便条出现了', 3600);
    });
    applyEntryState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.dangerPuzzle = {
    answers: ANSWERS, profile: PROFILE,
    normalize: norm,
    open: openNote, submit, close: closeNote,
    openRecords, closeRecords,
    postGuestbook, renderGuestbook, renderHandbook, renderSolveRecords,
    solved, tries, entryRevealed, showEntry, applyEntryState,
    scratchState: () => ({ ready: scratch.ready, pct: scratch.pct }),
  };
})();
