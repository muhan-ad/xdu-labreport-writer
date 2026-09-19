// danger-puzzle.js — 「请勿点击」里的解谜彩蛋：请输入管理员姓名
//
// 谜面：请输入管理员姓名。提示：I'll eat my head
// 谜底：Grimwig —— 典出狄更斯《雾都孤儿》里的 Mr. Grimwig，他的口头禅就是
//       "I'll eat my head"（动不动就要吃掉自己的脑袋）。
//
// 判定：归一化后比较（去空格/连字符/点/中英标点、转小写），接受
//        grimwig / mr grimwig / mr.grimwig / muhan 等写法。改谜底只改 ANSWERS 一行。
//
// 解谜成功 → 解锁隐藏的「管理员模式」页（设置左侧导航最后一项），里面有：
//   · 彩蛋播放器：选任意效果立即播放（演示/调试用）
//   · 统计：点击次数、解谜尝试次数、各效果触发次数、解锁时间
//   · 重置彩蛋数据：清空上面这些（会重新藏起管理员页）
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const UNLOCK_KEY = 'dangerAdminUnlocked';
  const TRIES_KEY = 'dangerPuzzleTries';
  const UNLOCK_AT_KEY = 'dangerAdminUnlockedAt';
  // 谜底（归一化后比较）。想换谜底改这里即可。
  const ANSWERS = ['grimwig', 'mrgrimwig', 'muhan', '慕寒'];

  const norm = s => String(s == null ? '' : s)
    .trim().toLowerCase()
    .replace(/[\s_\-·.。，,、'’"“”()（）!！?？:：;；]/g, '');

  const read = (key, dflt = '') => { try { return localStorage.getItem(key) || dflt; } catch (_) { return dflt; } };
  const write = (key, val) => { try { localStorage.setItem(key, val); } catch (_) {} };

  const unlocked = () => read(UNLOCK_KEY) === '1';
  const tries = () => Number(read(TRIES_KEY, '0')) || 0;

  function bumpTries() { const n = tries() + 1; write(TRIES_KEY, String(n)); return n; }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const p = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── 弹窗 ──
  function openPuzzle() {
    if ($('puzzleMsg')) $('puzzleMsg').textContent = '';
    if ($('puzzleInput')) $('puzzleInput').value = '';
    if (unlocked()) {
      if ($('puzzleMsg')) $('puzzleMsg').textContent = '你已经解开了这个谜题。';
    }
    if (typeof openModal === 'function') openModal('puzzleModal');
    setTimeout(() => { const i = $('puzzleInput'); if (i) i.focus(); }, 60);
  }

  function closePuzzle() { if (typeof closeModal === 'function') closeModal('puzzleModal'); }

  function submit() {
    const raw = $('puzzleInput') ? $('puzzleInput').value : '';
    const guess = norm(raw);
    if (!guess) {
      $('puzzleMsg').textContent = '先填个名字吧。';
      return false;
    }
    const n = bumpTries();
    if (ANSWERS.includes(guess)) {
      write(UNLOCK_KEY, '1');
      write(UNLOCK_AT_KEY, String(Date.now()));
      applyUnlock();
      closePuzzle();
      celebrate();
      return true;
    }
    const hints = [
      '不是这个名字。提示就在谜面上：想想"吃掉脑袋"这句话是谁的口头禅。',
      '再想想：这是位小说人物的名字，他把"吃掉我的头"当赌咒语。',
      '去搜索一下「I\'ll eat my head」这句话，会有人告诉你他叫什么。',
    ];
    $('puzzleMsg').textContent = '不对。' + hints[Math.min(n - 1, hints.length - 1)];
    return false;
  }

  // ── 解锁后的管理员页 ──
  function effectList() {
    try {
      if (!window.dangerEffects) return [];
      const ids = window.dangerEffects.ids();
      const names = window.dangerEffects.names();
      return names.map((n, i) => ({ id: ids[i], label: n }));
    } catch (_) { return []; }
  }

  function renderStats() {
    if (!$('adminStats')) return;
    const clicks = Number(read('dangerClickCount', '0')) || 0;
    let counts = {};
    try { counts = JSON.parse(read('dangerEffectCounts', '{}')) || {}; } catch (_) {}
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, n]) => `${id} ×${n}`).join('、');
    $('adminStats').innerHTML = ''
      + `解锁时间：${fmtTime(read(UNLOCK_AT_KEY)) || '（未知）'}<br />`
      + `「请勿点击」累计点击：${clicks} 次　解谜尝试：${tries()} 次<br />`
      + `各效果触发次数：${top || '（还没有记录）'}`;
  }

  function applyUnlock(announce) {
    const nav = $('btnNavAdmin');
    if (nav) nav.hidden = !unlocked();      // 只有解锁后才露面（applyUnlock 也被"重置"和启动时调用）
    const hint = $('puzzleStateHint');
    if (hint) {
      hint.textContent = unlocked()
        ? `已解开（${fmtTime(read(UNLOCK_AT_KEY))}）：设置左侧多了「管理员模式」`
        : '';
    }
    if (!$('adminEffectSelect')) return;
    const list = effectList();
    if (!$('adminEffectSelect').dataset.filled) {
      $('adminEffectSelect').innerHTML = list
        .map(e => `<option value="${e.id}">${e.label}</option>`).join('');
      $('adminEffectSelect').dataset.filled = '1';
    }
    renderStats();
    if (announce) nav && nav.scrollIntoView({ block: 'nearest' });
  }

  function reset() {
    [UNLOCK_KEY, TRIES_KEY, UNLOCK_AT_KEY, 'dangerEffectCounts', 'dangerClickCount', 'dangerLastEffect']
      .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    const nav = $('btnNavAdmin');
    if (nav) nav.hidden = true;
    const hint = $('puzzleStateHint');
    if (hint) hint.textContent = '彩蛋数据已重置（管理员页也藏回去了）。';
    if (typeof switchSettingsPane === 'function') switchSettingsPane('danger');
    renderStats();
  }

  // 解锁庆祝：礼花 + 底部提示条（走效果池里的 unlock，权重 0，不会被随机抽到）
  function celebrate() {
    try {
      if (window.dangerEffects) window.dangerEffects.run('unlock');
    } catch (_) {}
  }

  function bind() {
    const go = $('btnDangerPuzzle');
    if (go) go.onclick = openPuzzle;
    const sub = $('btnPuzzleSubmit');
    if (sub) sub.onclick = submit;
    const cancel = $('btnPuzzleCancel');
    if (cancel) cancel.onclick = closePuzzle;
    const input = $('puzzleInput');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }
    const play = $('btnAdminPlay');
    if (play) {
      play.onclick = () => {
        const sel = $('adminEffectSelect');
        if (sel && sel.value && window.dangerEffects) window.dangerEffects.run(sel.value);
      };
    }
    const resetBtn = $('btnAdminReset');
    if (resetBtn) {
      resetBtn.onclick = async () => {
        const ok = typeof appConfirm === 'function'
          ? await appConfirm('重置彩蛋数据？\n将清空点击次数、解谜记录与效果触发统计，管理员页也会重新藏起来。', { danger: true })
          : true;
        if (ok) reset();
      };
    }
    applyUnlock();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.dangerPuzzle = {
    answers: ANSWERS,          // 隐私性无关紧要，方便自测与改谜底
    normalize: norm,
    open: openPuzzle,
    submit,
    unlocked,
    tries,
    reset,
    applyUnlock,
    renderStats,
  };
})();
