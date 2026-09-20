// danger-effects.js — 「请勿点击」彩蛋的效果池
//
// 三级确认通过后从这里随机抽一个效果执行。三条纪律（改这个文件时请守住）：
//   1. 不碰用户数据：不写 data.json / 报告 / 用户实验目录，唯一会落的只有点击计数
//      （localStorage.dangerClickCount，用于「手贱计数器」的称号）；
//   2. 一定能恢复：每个效果自带 maxMs 看门狗，超时或被 Esc / 点击中断后由 runner
//      统一清理 DOM、停音频、复原窗口标题与位置 —— 不允许出现"卡在特效里出不来"；
//   3. 不真关窗口、不真退出：涉及窗口的效果（抖动 / 闪退 / 假未响应）只在主进程
//      做 hide / setBounds / setTitle，且主进程侧 try/finally 保证复原。
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

  // ── 通用覆盖层 ──
  function makeLayer(opts = {}) {
    const el = document.createElement('div');
    el.className = 'dx-layer' + (opts.className ? ' ' + opts.className : '');
    el.style.cssText = 'position:fixed;inset:0;z-index:4600;' + (opts.css || '');
    // 默认不挡鼠标（大多数效果只是视觉）；需要点击的传 pointer: true
    el.style.pointerEvents = opts.pointer === true ? 'auto' : 'none';
    document.body.appendChild(el);
    return el;
  }

  // ⚠ 精灵（矢量绘制，不用 emoji 字体）：喷发效果每帧只做 drawImage，开销几乎为零
  function makeWarnSprite(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const s = size, pad = s * 0.07;
    g.beginPath();
    g.moveTo(s / 2, pad);
    g.lineTo(s - pad, s - pad);
    g.lineTo(pad, s - pad);
    g.closePath();
    g.fillStyle = '#f5b301';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(1.6, s * 0.075);
    g.strokeStyle = '#2b2b2b';
    g.stroke();
    g.fillStyle = '#2b2b2b';
    g.fillRect(s / 2 - s * 0.045, s * 0.32, s * 0.09, s * 0.33);
    g.beginPath();
    g.arc(s / 2, s * 0.775, s * 0.055, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function card(layer, html, css) {    const box = document.createElement('div');
    box.className = 'dx-card';
    box.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
      + 'background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.28);'
      + 'padding:26px 30px;text-align:center;font-size:15px;color:#1f2430;max-width:78vw;'
      + (css || '');
    box.innerHTML = html;
    layer.appendChild(box);
    return box;
  }

  const DANMAKU = [
    '别点了', '手贱', '已记录（假的）', '开发者看着呢', '又在点', '这按钮有毒',
    '你的数据好着呢', '再点就 ±∞ 了', 'u=±手贱', '建议复习有效数字',
    '实验搭子：已截图', '咚咚咚', '停手吧朋友', '这已经是第 N 次了',
    '⚠ 高危操作 ⚠', '咕咕咕', '老师在看', '你被记录在案了',
  ];
  const TITLES = n => (n >= 50 ? '手贱宗师' : n >= 10 ? '手贱学徒' : n >= 3 ? '谨慎的手' : '新手上路');

  function bumpClickCount() {
    try {
      const n = Number(localStorage.getItem('dangerClickCount') || 0) + 1;
      localStorage.setItem('dangerClickCount', String(n));
      return n;
    } catch (_) { return 1; }
  }

  // ── 效果池 ──────────────────────────────────────────────
  const POOL = [
    // 稀有彩蛋：不进随机池（权重 0 且 rare 标记），由 runDangerEffect 单独掷骰子触发。
    // 纯动画：不联网、不下载、不写任何文件 —— 末尾会自己说明"什么都没下载"。
    {
      id: 'genshin', name: '原神启动（百分之一）', weight: 0, rare: true, maxMs: 26000,
      async run(h) {
        const el = h.layer({
          pointer: false,
          css: 'background:radial-gradient(circle at 50% 30%,#1b2233 0%,#0c1018 70%);display:flex;'
            + 'align-items:center;justify-content:center;color:#fff;font-family:system-ui,sans-serif',
        });
        const box = document.createElement('div');
        box.style.cssText = 'width:470px;max-width:82vw';
        box.innerHTML = `
          <div style="font-size:12.5px;color:#8b93a7;margin-bottom:8px">检测到连续点击「请勿点击」，已自动为你启动：</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;margin-bottom:16px;
                      background:linear-gradient(90deg,#8fd3ff,#b39dff,#8fd3ff);-webkit-background-clip:text;
                      background-clip:text;color:transparent">原  神</div>
          <div style="height:10px;background:#222a3a;border-radius:5px;overflow:hidden">
            <div id="gxBar" style="width:0;height:100%;background:linear-gradient(90deg,#5aa9ff,#7c5cff);transition:width .3s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#9aa3b5;margin-top:8px">
            <span id="gxPct">0%</span><span id="gxSpeed">0.0 MB/s</span>
          </div>
          <div id="gxLog" style="font-family:Consolas,monospace;font-size:12px;color:#7f8ba3;
                                 margin-top:12px;line-height:1.95;height:132px"></div>
`;
        el.appendChild(box);
        const bar = box.querySelector('#gxBar');
        const pct = box.querySelector('#gxPct');
        const spd = box.querySelector('#gxSpeed');
        const log = box.querySelector('#gxLog');
        const line = txt => {
          const d = document.createElement('div');
          d.textContent = txt;
          log.appendChild(d);
          log.scrollTop = log.scrollHeight;
        };

        line('> 正在解析下载地址 …');
        await h.sleep(700);
        line('> 已连接 cdn.不存在的网站');
        await h.sleep(600);

        // 真实磁盘检查：挑最空的盘、判断装不装得下（只读容量，不写任何文件）
        line('> 正在挑选安装位置 …');
        await h.sleep(500);
        let drives = [];
        try {
          const r = await window.labAPI.dangerDiskSpace();
          if (r && r.ok) drives = r.drives || [];
        } catch (_) { /* 取不到就跳过这一步 */ }
        const NEED_GB = 92.4;
        let aborted = false;
        if (drives.length) {
          const top = drives[0];
          line('> 扫描磁盘：' + drives.map(d => `${d.drive} 剩 ${d.freeGB}GB`).join('，'));
          await h.sleep(600);
          line(`> 选定最空的 ${top.drive}（剩 ${top.freeGB} GB），需要 ${NEED_GB} GB`);
          await h.sleep(600);
          if (top.freeGB < NEED_GB) {
            aborted = true;
            line(`> ✗ 已放弃下载：${top.drive} 装不下（差 ${(NEED_GB - top.freeGB).toFixed(1)} GB）`);
            await h.sleep(700);
            line('> 这是本次彩蛋里唯一一句真话 —— 磁盘是真的，判断是真的。');
          } else {
            line(`> ✓ 空间足够（剩 ${top.freeGB} GB ≥ ${NEED_GB} GB），按计划开始下载 …`);
          }
        } else {
          line('> 读不到磁盘信息，跳过空间检查（继续演）');
        }
        await h.sleep(600);

        // 进度条：前段慢（"92GB 呢"），中段提速，最后卡在 87% 演一下
        const steps = [
          [2, 1.2, '> 包体大小：92.4 GB（含全部语音包与过场动画）'],
          [9, 8.6, '> 已连接加速节点：23.5 MB/s'],
          [21, 19.8, '> 剩余时间：约 118 小时 43 分'],
          [38, 24.1, '> ⚠ 顺手提醒：别把游戏装系统盘，装满了 C 盘连报告都存不下'],
          [55, 31.6, '> 建议关闭其它占带宽的程序'],
          [74, 42.9, '> 已下载 68.1 GB … 你家路由器开始冒烟了'],
          [87, 0.4, '> 速度骤降：0.4 MB/s（运营商表示这不归它管）'],
        ];
        for (const [p, s, txt] of steps) {
          if (h.cancelled()) return;
          bar.style.width = p + '%';
          pct.textContent = p + '%';
          spd.textContent = s.toFixed(1) + ' MB/s';
          line(txt);
          await h.sleep(aborted ? 320 : 900);        // 已放弃下载的话，后面只快速过一遍
        }
        await h.sleep(600);
        line(aborted ? '> 安装包已丢弃 …' : '> 下载完成，正在解压 …');
        await h.sleep(700);
        line(aborted ? '> 未写入任何文件' : '> 解压失败：磁盘空间不足');
        await h.sleep(700);
        bar.style.width = '100%';
        pct.textContent = '100%';
        spd.textContent = '0.0 MB/s';
        log.innerHTML = '<div style="color:#8fd3ff">玩笑到此为止 😄 什么都没下载。</div>'
          + '<div style="color:#7f8ba3">一个字节流量都没用，磁盘一个文件都没动'
          + (drives.length ? `（刚才读到的 ${drives[0].drive} 剩余空间是真数据，其它都是演的）` : '')
          + '。</div>';
        // 想真下就自己点 —— 打开的是官方页面，下载由用户发起（不替用户静默下载 90GB）
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline';
        btn.textContent = '真去官网下载';
        btn.style.cssText = 'margin-top:14px';
        btn.onclick = async () => {
          try { await window.labAPI.openExternal('https://ys.mihoyo.com/'); } catch (_) {}
        };
        log.appendChild(btn);
        const tip = document.createElement('div');
        tip.style.cssText = 'color:#5f6a80;font-size:11.5px;margin-top:8px';
        tip.textContent = '想玩游戏的话 —— 先把实验报告写完。';
        log.appendChild(tip);
        // 用户要求：这句放到最后才出现（原来是固定显示在开头）
        const rare = document.createElement('div');
        rare.style.cssText = 'color:#5f6a80;font-size:11.5px;margin-top:6px';
        rare.textContent = '（百分之一才会出现的彩蛋 · 祝你好运）';
        log.appendChild(rare);
        await h.sleep(3600);
      },
    },
    // 经典保留项目：第一次点击永远是它（见 renderer.js 的 pickDangerEffect）
    {
      id: 'audio', name: '经典音频（保留节目）', weight: 1, maxMs: 8000,
      async run(h) {
        // 这个效果只出声，不出任何文字提示（用户明确要求）
        try {
          const r = await window.labAPI.readAudioFile();
          if (!r.ok) throw new Error(r.error);
          const a = new Audio(`data:${r.mime};base64,${r.data}`);
          h.onCleanup(() => { try { a.pause(); } catch (_) {} });
          await a.play();
          await new Promise(res => { a.onended = res; a.onerror = res; });
        } catch (e) { console.error('[danger] 音频播放失败：' + e.message); }
      },
    },
    {
      id: 'eruption', name: '重力喷发警告', weight: 3, maxMs: 14000,
      async run(h) {
        const cv = h.layer({ pointer: false });
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:100%;height:100%;display:block';
        cv.appendChild(canvas);
        // DPI 上限收到 1.5：再高只是徒增每帧像素量（4K 屏上 dpr=2 会变成 2000 万像素/帧）
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const W = window.innerWidth, H = window.innerHeight;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // ⚠ 预渲染成精灵：之前每帧对每个粒子 fillText('⚠')，emoji 字体回退+排版极慢，
        // 260 个粒子直接把主线程压满（表现就是"卡"）。改成矢量画一次、之后只 drawImage。
        const sprite = makeWarnSprite(72);

        // 从窗口底部中央（"窗口里"）喷出，受重力下落，落地弹跳并堆积
        const parts = [];
        const N = 260, G = 2100;                     // 按用户要求：数量再多一些
        const born0 = performance.now();
        for (let i = 0; i < N; i++) {
          const ang = rnd(-1.32, -0.28);            // 向上扇形
          const sp = rnd(760, 1900);
          parts.push({
            x: W / 2 + rnd(-70, 70), y: H - 10,
            vx: Math.cos(ang) * sp * rnd(0.5, 1), vy: Math.sin(ang) * sp,
            size: rnd(18, 42), rot: rnd(-0.4, 0.4), vr: rnd(-4, 4),
            born: born0 + i * 3,
          });
        }
        let raf = 0, last = performance.now(), frozen = false;
        const stop = { v: false };
        h.onCleanup(() => { stop.v = true; cancelAnimationFrame(raf); });
        // ── 互不重叠（用户要求）──
        // 260 个粒子挤在一个喷口里，逐对检查是 O(n²)≈34k 对/帧且两轮松弛根本推不开（实测还差 7px）。
        // 改成网格宽相位 + 多轮松弛：每格 64px（略大于最大直径），只跟邻格比，于是可以多跑几轮。
        const CELL = 64;
        const hash = (cx, cy) => cx * 8191 + cy;
        let pid = 0;
        for (const p of parts) p.id = pid++;
        const buildGrid = () => {
          const g = new Map();
          for (const p of parts) {
            const k = hash(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
            let b = g.get(k);
            if (!b) { b = []; g.set(k, b); }
            b.push(p);
          }
          return g;
        };
        const relax = (passes, now, ignoreSleep = false) => {
          for (let pass = 0; pass < passes; pass++) {
            const grid = buildGrid();
            for (const p of parts) {
              if (now < p.born) continue;
              const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
              const rp = p.size * 0.5;
              for (let gx = cx - 1; gx <= cx + 1; gx++) {
                for (let gy = cy - 1; gy <= cy + 1; gy++) {
                  const bucket = grid.get(hash(gx, gy));
                  if (!bucket) continue;
                  for (const q of bucket) {
                    if (q.id <= p.id || now < q.born) continue;   // 每对只处理一次
                    let dx = q.x - p.x, dy = q.y - p.y;
                    const minD = rp + q.size * 0.5;
                    let d2 = dx * dx + dy * dy;
                    if (d2 >= minD * minD) continue;
                    let d = Math.sqrt(d2);
                    if (d < 1e-3) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
                    const nx = dx / d, ny = dy / d, depth = minD - d;
                    if (depth > 0.5) { p.touch = true; q.touch = true; }
                    // 睡着的粒子当"墙"：只推醒着的那个；压实阶段（ignoreSleep）人人可动
                    let wp = 0.5, wq = 0.5;
                    if (!ignoreSleep) {
                      if (p.sleep && !q.sleep) { wp = 0; wq = 1; }
                      else if (q.sleep && !p.sleep) { wp = 1; wq = 0; }
                    }
                    p.x -= nx * depth * wp; p.y -= ny * depth * wp;
                    q.x += nx * depth * wq; q.y += ny * depth * wq;
                    if (!p.sleep && !q.sleep) {
                      const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
                      if (rel < 0) {
                        p.vx += nx * rel * 0.5; p.vy += ny * rel * 0.5;
                        q.vx -= nx * rel * 0.5; q.vy -= ny * rel * 0.5;
                      }
                    }
                  }
                }
              }
            }
          }
        };
        const clampAll = now => {
          for (const p of parts) {
            if (now < p.born) continue;
            const r = p.size * 0.5;
            if (p.x < r) p.x = r; else if (p.x > W - r) p.x = W - r;
            if (p.y > H - r) p.y = H - r;
          }
        };
        // 一次性压实：所有粒子都可动，反复推挤到几乎零重叠（只在静止后跑一次，几百轮也就几毫秒）
        const packAll = now => {
          for (let it = 0; it < 300; it++) { relax(1, now, true); clampAll(now); }
          relax(30, now, true);
          clampAll(now);
        };
        const worstOverlap = now => {
          const grid = buildGrid();
          let worst = 0;
          for (const p of parts) {
            if (now < p.born) continue;
            const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
            const rp = p.size * 0.5;
            for (let gx = cx - 1; gx <= cx + 1; gx++) {
              for (let gy = cy - 1; gy <= cy + 1; gy++) {
                const bucket = grid.get(hash(gx, gy));
                if (!bucket) continue;
                for (const q of bucket) {
                  if (q.id <= p.id || now < q.born) continue;
                  const d = Math.hypot(q.x - p.x, q.y - p.y);
                  const over = (rp + q.size * 0.5) - d;
                  if (over > worst) worst = over;
                }
              }
            }
          }
          return worst;
        };
        // 供验收脚本核对「粒子数」与「互不重叠」：只读暴露，效果结束即删除
        window.__dxEruption = { parts, overlap: () => worstOverlap(performance.now()) };
        h.onCleanup(() => { delete window.__dxEruption; });
        // 窗口被拖动时，⚠ 要跟着"甩"：按窗口位移给粒子加惯性冲量（用户要求）
        let winX = window.screenX, winY = window.screenY;
        let lastWake = performance.now();            // 上次"被唤醒"的时间：静止 4.2 秒后压实冻结
        const step = now => {
          if (stop.v) return;
          const dt = Math.min(0.032, (now - last) / 1000); last = now;
          // 惯性：窗口这一帧移动了多少，粒子就反向被"甩"多少（取负号 = 惯性滞后），
          // 系数 2.2 是手感值：拖快了明显荡，慢慢拖几乎无感
          // 窗口最小化时 screenX/screenY 是 -16000 这类哨兵值，直接算位移会得到巨大的假冲量
          // （恢复窗口时会把粒子甩飞），所以这里先判断：最小化/隐藏就当作没动。
          const hidden = document.hidden || window.screenX <= -10000 || window.screenY <= -10000;
          let dwx = 0, dwy = 0;
          if (!hidden) {
            dwx = (window.screenX - winX) * 2.2;
            dwy = (window.screenY - winY) * 2.2;
            const LIM = 400;                      // 单帧位移超过这个数不可能是"拖窗口"
            if (Math.abs(dwx) > LIM || Math.abs(dwy) > LIM) { dwx = 0; dwy = 0; }
          }
          winX = window.screenX; winY = window.screenY;
          ctx.clearRect(0, 0, W, H);
          let moving = 0;
          if (dwx || dwy) {                          // 窗口一动，全部叫醒（惯性会带着它们晃）
            lastWake = now;
            for (const p of parts) { p.sleep = false; p.still = 0; }
          }
          for (const p of parts) {
            if (now < p.born) { moving += 1; continue; }
            if (p.sleep) continue;                   // 睡着了就不再积分（堆才会真正静止）
            p.vy += G * dt;
            if (dwx || dwy) { p.vx -= dwx; p.vy -= dwy; }
            p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            if (p.y > H - p.size * 0.5) {           // 触底：弹跳 + 摩擦，最终堆在底部
              p.y = H - p.size * 0.5;
              p.vy *= -0.42; p.vx *= 0.72; p.vr *= 0.6;
              if (Math.abs(p.vy) < 40) { p.vy = 0; p.vx *= 0.5; p.vr = 0; }
            }
            if (p.x < p.size * 0.5) { p.x = p.size * 0.5; p.vx = Math.abs(p.vx) * 0.7; }
            if (p.x > W - p.size * 0.5) { p.x = W - p.size * 0.5; p.vx = -Math.abs(p.vx) * 0.7; }
            const cap = 2600;                       // 惯性冲量别把粒子甩飞
            if (p.vx > cap) p.vx = cap; else if (p.vx < -cap) p.vx = -cap;
            if (p.vy > cap) p.vy = cap; else if (p.vy < -cap) p.vy = -cap;
            // 阻尼 + 入睡：堆里松弛的冲量会一直互相"喂"能量，不睡的话 10 秒后还在抖
            p.vx *= 0.985; p.vy *= 0.985; p.vr *= 0.98;
            if (Math.hypot(p.vx, p.vy) < 26) p.still = (p.still || 0) + 1; else p.still = 0;
            if (p.still > 10) { p.sleep = true; p.vx = 0; p.vy = 0; p.vr = 0; }
            if (Math.abs(p.vx) > 4 || Math.abs(p.vy) > 4 || Math.abs(p.vr) > 0.05) moving += 1;
          }
          relax(4, now);                            // 分离：4 轮松弛（网格宽相位，够便宜）
          // 接触阻尼：被下面粒子托住的那个，重力每帧还在往上加速度，不衰减就会越压越深
          for (const p of parts) {
            if (now < p.born) continue;
            if (p.touch) { p.vx *= 0.55; p.vy *= 0.55; p.vr *= 0.6; p.touch = false; }
          }
          clampAll(now);
          for (const p of parts) {
            if (now < p.born) continue;
            const c = Math.cos(p.rot), s = Math.sin(p.rot), w = p.size, hh = p.size;
            ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * p.x, dpr * p.y);
            ctx.drawImage(sprite, -w / 2, -hh / 2, w, hh);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // 落定 4.2 秒后：整体压实到零重叠并冻结画面（之后不再逐帧积分，画面是干净的）
          // 窗口一动就唤醒（惯性带它们晃），晃完再自动压实一次
          if (now - lastWake > 4200) {
            packAll(now);
            frozen = true;
            return;
          }
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        await h.sleep(9000);                        // 不再出提示条（用户要求）
        if (!frozen) { /* 还在动也无妨，下面直接淡出 */ }
        cv.style.transition = 'opacity .9s'; cv.style.opacity = '0';
        await h.sleep(900);
      },
    },
    {
      id: 'bsod', name: '假蓝屏', weight: 3, maxMs: 8000,
      async run(h) {
        const el = h.layer({ pointer: false, css: 'background:#0b5ed7;color:#fff;display:flex;align-items:center;justify-content:center;font-family:"Segoe UI",system-ui,sans-serif;' });
        el.innerHTML = `
          <div style="max-width:640px;line-height:1.7">
            <div style="font-size:88px;line-height:1">:(</div>
            <div style="font-size:22px;margin:16px 0 10px">你的实验报告已被退回</div>
            <div style="font-size:15px;opacity:.92">原因：数据太离谱（g = 9.8 亿 m/s²，不确定度 ±200%）</div>
            <div style="font-size:15px;opacity:.92;margin-top:6px">错误代码：PHYS_LAB_0x00HANDJIAN</div>
            <div style="font-size:13px;opacity:.75;margin-top:22px">正在收集错误信息… 3%</div>
          </div>`;
        await h.sleep(3200);
        el.remove();          // 用户要求：不放"吓到了吧"的收尾卡片，蓝屏结束就回到界面
      },
    },
    {
      id: 'self-destruct', name: '倒计时自毁', weight: 3, maxMs: 18000,
      async run(h) {
        const el = h.layer({ pointer: false, css: 'background:rgba(12,14,20,.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;' });
        const num = document.createElement('div');
        num.style.cssText = 'font-size:120px;font-weight:800;color:#ff5a5a;font-variant-numeric:tabular-nums';
        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:19px;margin-top:8px;opacity:.95';
        el.append(num, txt);      // 用户要求：不再显示那两行小字旁白
        for (let i = 10; i > 0; i--) {
          if (h.cancelled()) return;
          num.textContent = String(i);
          txt.textContent = '秒后删除本机全部实验报告与数据';
          await h.sleep(900);
        }
        num.textContent = '0';
        txt.textContent = '删除失败：权限不足（借口）';
        await h.sleep(500);
        el.innerHTML = '';
        const boom = document.createElement('canvas');
        boom.style.cssText = 'width:100%;height:100%;display:block';
        el.appendChild(boom);
        el.style.background = 'rgba(12,14,20,.92)';
        const dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
        boom.width = W * dpr; boom.height = H * dpr;
        const c = boom.getContext('2d'); c.scale(dpr, dpr);
        const conf = Array.from({ length: 220 }, () => ({
          x: W / 2, y: H / 2, vx: rnd(-620, 620), vy: rnd(-900, -120),
          s: rnd(4, 11), col: `hsl(${rnd(0, 360)},85%,60%)`, rot: rnd(0, 6.28), vr: rnd(-8, 8),
        }));
        let raf = 0; const t0 = performance.now();
        const stop = { v: false };
        h.onCleanup(() => { stop.v = true; cancelAnimationFrame(raf); });
        const step = now => {
          if (stop.v) return;
          const dt = 1 / 60;
          c.clearRect(0, 0, W, H);
          for (const p of conf) {
            p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.col;
            c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore();
          }
          if (now - t0 > 2400) return;   // 礼花放完就停，剩下的时间静置（结论文案改用底部提示条）
          raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        h.caption('开玩笑的', 3000);      // 用户要求：结尾用灰黑长圆底部提示条
        await h.sleep(3600);
      },
    },
    {
      id: 'pixelate', name: '画面糊了', weight: 3, maxMs: 6000,
      async run(h) {
        const root = $('app') || document.body;
        root.style.transition = 'filter .25s';
        root.style.filter = 'blur(5px) contrast(1.15) saturate(1.4)';
        h.onCleanup(() => { root.style.filter = ''; root.style.transition = ''; });
        await h.sleep(2400);
      },
    },
    {
      id: 'mirror', name: '镜像世界', weight: 2, maxMs: 6000,
      async run(h) {
        const root = $('app') || document.body;
        root.style.transition = 'transform .35s';
        root.style.transform = 'scaleX(-1)';
        h.onCleanup(() => { root.style.transform = ''; root.style.transition = ''; });
        h.caption('镜像世界：左右反了，数据没反', 2600);
        await h.sleep(5000);          // 用户要求：时间长一点（原 2.6 秒）
      },
    },
    {
      id: 'danmaku', name: '弹幕攻击', weight: 3, maxMs: 9000,
      async run(h) {
        const el = h.layer({ pointer: false, css: 'overflow:hidden' });
        for (let i = 0; i < 34; i++) {
          const s = document.createElement('span');
          s.textContent = pickOne(DANMAKU);
          s.style.cssText = `position:absolute;top:${rnd(2, 94)}%;left:100%;white-space:nowrap;`
            + `font-size:${rnd(13, 20)}px;color:hsl(${rnd(0, 360)},70%,45%);font-weight:600;`
            + `text-shadow:0 1px 2px rgba(0,0,0,.12);animation:dx-slide ${rnd(3.4, 6.2)}s linear ${rnd(0, 3)}s forwards`;
          el.appendChild(s);
        }
        await h.sleep(6800);
      },
    },
    {
      id: 'cursor-army', name: '光标大军', weight: 2, maxMs: 9000,
      async run(h) {
        const el = h.layer({ pointer: false });
        // 用户要求：隐藏真实鼠标指针（只留这群假光标）；用临时样式覆盖所有元素的光标
        const hideCursor = document.createElement('style');
        hideCursor.textContent = '*{cursor:none !important}';
        document.head.appendChild(hideCursor);
        h.onCleanup(() => hideCursor.remove());
        const N = 28, cur = [];
        for (let i = 0; i < N; i++) {
          const c = document.createElement('div');
          c.textContent = '🖱️';
          c.style.cssText = 'position:absolute;font-size:20px;opacity:.9;will-change:transform';
          el.appendChild(c);
          cur.push({ el: c, x: window.innerWidth / 2, y: window.innerHeight / 2, k: rnd(0.04, 0.2), ox: rnd(-90, 90), oy: rnd(-70, 70) });
        }
        let mx = window.innerWidth / 2, my = window.innerHeight / 2;
        const onMove = e => { mx = e.clientX; my = e.clientY; };
        window.addEventListener('mousemove', onMove, true);
        h.onCleanup(() => window.removeEventListener('mousemove', onMove, true));
        let raf = 0; const stop = { v: false };
        h.onCleanup(() => { stop.v = true; cancelAnimationFrame(raf); });
        const step = () => {
          if (stop.v) return;
          for (const c of cur) {
            c.x += (mx + c.ox - c.x) * c.k;
            c.y += (my + c.oy - c.y) * c.k;
            c.el.style.transform = `translate(${c.x}px,${c.y}px)`;
          }
          raf = requestAnimationFrame(step);
        };
        step();
        await h.sleep(4200);
      },
    },
    {
      id: 'formula-storm', name: '公式暴走', weight: 2, maxMs: 11000,
      async run(h) {
        const el = h.layer({ pointer: true, css: 'overflow:hidden;background:rgba(255,255,255,.55)' });
        const F = ['$x = \\pm\\infty$', 'u(x) = ±∞', 'Δ = 0 ± 100%', 'R² = -1', 'g = 9.8 亿 m/s²',
          'λ = 632.8 km', 'tanθ = 42', 'sinθ = 1.02', 'ln(-1) = ?', '1 = 2 (证毕)'];
        for (let i = 0; i < 26; i++) {
          const s = document.createElement('div');
          s.textContent = pickOne(F).replace(/\$/g, '').replace(/\\pm/g, '±').replace(/\\infty/g, '∞');
          s.style.cssText = `position:absolute;top:-60px;left:${rnd(1, 92)}%;font-size:${rnd(14, 24)}px;`
            + `color:#c53030;font-family:"Cambria Math",Consolas,serif;font-weight:600;cursor:pointer;`
            + `animation:dx-fall ${rnd(2.6, 4.6)}s linear ${rnd(0, 2.4)}s forwards`;
          s.onclick = () => { s.textContent = '±∞'; s.style.color = '#7c3aed'; };
          el.appendChild(s);
        }
        await h.sleep(9000);          // 用户要求：不要底部提示条
      },
    },
    {
      id: 'fake-progress', name: '假进度条', weight: 3, maxMs: 12000,
      async run(h) {
        const el = h.layer({ css: 'background:rgba(15,18,25,.55);display:flex;align-items:center;justify-content:center' });
        const box = card(el, `
          <div style="font-size:16px;font-weight:700;margin-bottom:14px">正在删除全部实验数据…</div>
          <div style="width:360px;height:12px;background:#eef1f6;border-radius:6px;overflow:hidden">
            <div id="dxBar" style="width:0;height:100%;background:#e05656;transition:width .2s"></div>
          </div>
          <div id="dxPct" style="font-size:13px;color:#6b7280;margin-top:10px">0%</div>`, 'pointer-events:auto');
        const bar = box.querySelector('#dxBar'), pct = box.querySelector('#dxPct');
        for (let p = 0; p <= 99; p += 3) {
          if (h.cancelled()) return;
          bar.style.width = p + '%'; pct.textContent = p + '%';
          await h.sleep(p < 90 ? 70 : 260);
        }
        await h.sleep(1800);           // 卡在 99%
        // 用户要求：走完 99% 直接整屏白屏（不放"骗你的"文案），3 秒后恢复
        box.remove();
        el.style.background = '#ffffff';
        await h.sleep(3000);
      },
    },
    {
      id: 'click-counter', name: '手贱计数器', weight: 2, maxMs: 7000,
      async run(h) {
        const n = h.count;
        const el = h.layer({ css: 'background:rgba(15,18,25,.45);display:flex;align-items:center;justify-content:center' });
        card(el, `<div style="font-size:15px;color:#6b7280">第</div>
          <div style="font-size:64px;font-weight:800;line-height:1.1">${n}</div>
          <div style="font-size:15px;color:#6b7280">次点击「请勿点击」</div>
          <div style="margin-top:14px;font-size:17px;font-weight:700;color:#c53030">当前称号：${TITLES(n)}</div>`, 'pointer-events:auto');
        await h.sleep(2600);
      },
    },
    {
      id: 'fake-experiment', name: '假解锁第 27 个实验', weight: 2, maxMs: 12000,
      async run(h) {
        const el = h.layer({ css: 'background:rgba(15,18,25,.5);display:flex;align-items:center;justify-content:center' });
        const box = card(el, `<div style="font-size:34px">🎉</div>
          <div style="font-size:17px;font-weight:700;margin-top:8px">已解锁隐藏实验：第 27 个</div>
          <div style="font-size:15px;margin-top:6px">《玄学实验：误差的来源与玄学修正》</div>
          <button class="btn btn-sm btn-primary" id="dxEnter" style="margin-top:16px">进入实验</button>`, 'pointer-events:auto');
        box.querySelector('#dxEnter').onclick = () => {
          box.innerHTML = '<div style="font-size:32px">🕳️</div>'
            + '<div style="font-size:16px;font-weight:700;margin-top:10px">并没有这个实验 :)</div>'
            + '<div style="font-size:12px;color:#9ca3af;margin-top:6px">把机会留给真实存在的第 27 个吧</div>';
        };
        await h.sleep(4200);
      },
    },
    {
      id: 'runaway-button', name: '按钮逃跑', weight: 3, maxMs: 90000,
      async run(h) {
        // 用户要求：在整个窗口里躲、不设次数上限，一直躲到真的被点到（或 Esc 结束）
        const btn = $('btnDangerGo');
        if (!btn) { await h.sleep(500); return; }
        const box = btn.getBoundingClientRect();
        const w = box.width, hgt = box.height;
        const old = btn.style.cssText;
        btn.style.position = 'fixed';
        btn.style.width = w + 'px';
        btn.style.zIndex = '4700';
        btn.style.transition = 'left .12s ease-out, top .12s ease-out, transform .12s';
        btn.style.left = box.left + 'px';
        btn.style.top = box.top + 'px';
        h.onCleanup(() => { btn.style.cssText = old; });

        let caught = false;
        const onCaught = () => { caught = true; };
        btn.addEventListener('click', onCaught, true);

        const jump = (fromX, fromY) => {
          const pad = 12;
          const maxX = Math.max(pad, window.innerWidth - w - pad);
          const maxY = Math.max(pad, window.innerHeight - hgt - pad);
          // 优先跳到离鼠标远的地方，省得刚落地又被追上
          let bx = 0, by = 0, best = -1;
          for (let i = 0; i < 8; i++) {
            const x = pad + Math.random() * (maxX - pad);
            const y = pad + Math.random() * (maxY - pad);
            const d = Math.hypot(x + w / 2 - fromX, y + hgt / 2 - fromY);
            if (d > best) { best = d; bx = x; by = y; }
          }
          btn.style.left = Math.round(bx) + 'px';
          btn.style.top = Math.round(by) + 'px';
          btn.style.transform = `rotate(${rnd(-10, 10)}deg)`;
        };
        const onMove = e => {
          const b = btn.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
          if (d < 110) jump(e.clientX, e.clientY);
        };
        document.addEventListener('mousemove', onMove, true);
        h.onCleanup(() => {
          document.removeEventListener('mousemove', onMove, true);
          btn.removeEventListener('click', onCaught, true);
        });
        // 等到被点到（或看门狗/Esc 收场）
        while (!caught && !h.cancelled()) await h.sleep(120);
      },
    },
    {
      id: 'audio-scale', name: '音调递升', weight: 2, maxMs: 9000,
      async run(h) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { await h.sleep(600); return; }
        const ac = new AC();
        h.onCleanup(() => { try { ac.close(); } catch (_) {} });
        const base = 320 + Math.min(10, (h.count - 1)) * 28;
        for (let i = 0; i < 4; i++) {
          if (h.cancelled()) return;
          const o = ac.createOscillator(), g = ac.createGain();
          o.type = i === 3 ? 'triangle' : 'square';
          o.frequency.value = i === 3 ? base * 4 : base * (1 + i * 0.26);
          g.gain.value = 0.0001;
          o.connect(g).connect(ac.destination);
          const t = ac.currentTime;
          g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 3 ? 0.9 : 0.22));
          o.start(t); o.stop(t + (i === 3 ? 1 : 0.28));
          await h.sleep(i === 3 ? 950 : 300);
        }
      },
    },
    {
      id: 'window-shake', name: '窗口抖动', weight: 3, maxMs: 8000,
      async run(h) {
        const r = await window.labAPI.dangerShake().catch(e => ({ ok: false, error: e.message }));
        if (!r || !r.ok) {
          // 最大化 / 全屏时主进程拒绝移动窗口，退回内容抖动
          const root = $('app') || document.body;
          root.style.animation = 'dx-shake .5s 3';
          h.onCleanup(() => { root.style.animation = ''; });
          await h.sleep(1600);        // 用户要求：不出提示条
          return;
        }
        await h.sleep(1800);        // 用户要求：不出提示条
      },
    },
    {
      id: 'vanish', name: '闪退', weight: 2, maxMs: 12000,
      async run(h) {
        // 真·闪退太吓人且会丢数据：这里让窗口隐藏 1.6 秒再回来
        const el = h.layer({ pointer: false, css: 'background:#0f1219' });
        el.innerHTML = '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
          + 'color:#8b93a7;font-size:14px;font-family:system-ui">正在退出…</div>';
        await h.sleep(320);
        const r = await window.labAPI.dangerVanish().catch(e => ({ ok: false, error: e.message }));
        if (!r || !r.ok) {
          el.innerHTML = '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'color:#8b93a7;font-size:14px;font-family:system-ui">窗口躲起来了（没躲成）</div>';
          await h.sleep(1600);
          return;
        }
        await h.sleep(1200);           // 主进程会在 1.6 秒后把窗口显示回来
        el.remove();
        await h.sleep(400);            // 用户要求：结束不再出提示条
      },
    },
    {
      id: 'not-responding', name: '假未响应', weight: 1, maxMs: 9000,
      async run(h) {
        // 窗口是 frameless 的，"标题"就是自绘标题栏里的 .titlebar-name
        const nameEl = document.querySelector('.titlebar-name');
        const oldName = nameEl ? nameEl.textContent : '';
        if (nameEl) nameEl.textContent = '实验搭子（未响应）';
        h.onCleanup(() => { if (nameEl) nameEl.textContent = oldName; });
        const el = h.layer({ css: 'background:rgba(250,250,252,.92);display:flex;align-items:center;justify-content:center' });
        const box = card(el, `<div style="display:flex;gap:10px;align-items:center;justify-content:center">
            <div style="font-size:30px">🪟</div>
            <div style="text-align:left">
              <div style="font-size:16px;font-weight:700">实验搭子 未响应</div>
              <div style="font-size:13px;color:#6b7280;margin-top:4px">程序似乎已停止响应，是否结束它？</div>
            </div></div>
          <div style="margin-top:18px;display:flex;gap:10px;justify-content:center">
            <button class="btn btn-sm btn-outline" id="dxWait" style="flex:1">等待</button>
            <button class="btn btn-sm btn-danger" id="dxKill" style="flex:1">结束进程</button>
          </div>`, 'pointer-events:auto;max-width:420px');
        const close = why => { el.remove(); h.say(why, 2000, '程序好好的，是我演得太像了'); };
        box.querySelector('#dxWait').onclick = () => close('你选了「等待」');
        box.querySelector('#dxKill').onclick = () => close('想得美 😄');
        await h.sleep(3600);
      },
    },
    {
      id: 'pigeon', name: '变身实验鸽子', weight: 2, maxMs: 14000,
      async run(h) {
        const nodes = [
          [document.querySelector('.brand-mark'), '物', '🐦'],
          [document.querySelector('.brand-title'), '实验报告', '实验鸽子'],
          [document.querySelector('.titlebar-logo'), '物', '🐦'],
          [document.querySelector('.titlebar-name'), '实验搭子', '实验鸽子'],
        ].filter(([el]) => el);
        const old = nodes.map(([el]) => el.textContent);
        h.onCleanup(() => nodes.forEach(([el], i) => { el.textContent = old[i]; }));
        nodes.forEach(([el, , to]) => { el.textContent = to; });
        const sub = document.querySelector('.brand-sub');
        const oldSub = sub ? sub.textContent : '';
        if (sub) { sub.textContent = '大学物理 · 咕咕咕咕'; h.onCleanup(() => { sub.textContent = oldSub; }); }
        // 用户要求：页面上其它文字也逐字换成「咕」（一个字对应一个咕）。
        // 品牌/标题栏保持鸽子造型；效果自己的图层、脚本样式、用户正在编辑的 textarea 不动；
        // 原文本逐节点存好，结束时精确还原。
        const restored = [];
        try {
          const skip = '.dx-layer, .brand-mark, .brand-title, .brand-sub, .titlebar-logo, .titlebar-name';
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              const p = node.parentElement;
              if (!p) return NodeFilter.FILTER_REJECT;
              if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
              if (p.closest(skip)) return NodeFilter.FILTER_REJECT;
              if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          for (const node of nodes) {
            restored.push([node, node.nodeValue]);
            node.nodeValue = node.nodeValue.replace(/\S/g, '咕');
          }
        } catch (_) { /* 咕化失败就当没发生，别把效果拖垮 */ }
        h.onCleanup(() => { for (const [node, val] of restored) node.nodeValue = val; });
        h.caption('已进入摸鱼模式：咕…咕…咕…', 3000);
        await h.sleep(9000);
      },
    },
  ];

  // ── runner ──────────────────────────────────────────────
  let running = null;

  function cleanup(state) {
    if (state.done) return;
    state.done = true;
    for (const fn of state.cleanup.splice(0)) {
      try { fn(); } catch (_) {}
    }
    document.querySelectorAll('.dx-layer').forEach(el => el.remove());
  }

  function sleepIn(state, ms) {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms);
      state.wake.push(() => { clearTimeout(t); resolve(); });
    });
  }

  function cancel() {
    if (!running) return;
    running.cancelled = true;
    running.wake.splice(0).forEach(f => f());
  }

  async function run(id) {
    if (running) return false;
    const eff = POOL.find(e => e.id === id) || POOL[0];
    const state = { id: eff.id, cancelled: false, cleanup: [], wake: [], done: false };
    running = state;
    const onKey = e => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey, true);
    state.cleanup.push(() => document.removeEventListener('keydown', onKey, true));
    let count = 0;
    const h = {
      layer: opts => { const el = makeLayer(opts); state.cleanup.push(() => el.remove()); return el; },
      sleep: ms => sleepIn(state, ms),
      cancelled: () => state.cancelled,
      onCleanup: fn => state.cleanup.push(fn),
      // 注意：效果不要用应用的右上角 toast（用户明确不要角标弹窗），
      // 需要提示就用下面的 caption（底部提示条）或 say（居中卡片）
      caption: (text, ms = 2600) => {
        const el = makeLayer({ css: 'display:flex;align-items:flex-end;justify-content:center;padding-bottom:46px' });
        const b = document.createElement('div');
        b.textContent = text;
        b.style.cssText = 'background:rgba(17,20,28,.86);color:#fff;font-size:13px;padding:7px 14px;'
          + 'border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.25);animation:dx-rise .2s ease-out;max-width:70vw';
        el.appendChild(b);
        state.cleanup.push(() => el.remove());
        return sleepIn(state, ms);
      },
      say: async (html, ms = 2400, sub = '') => {
        const el = makeLayer({ css: 'background:rgba(15,18,25,.45);display:flex;align-items:center;justify-content:center' });
        card(el, `<div style="font-size:16px;font-weight:700">${html}</div>`
          + (sub ? `<div style="font-size:13px;color:#6b7280;margin-top:8px">${sub}</div>` : ''),
          'pointer-events:auto;max-width:460px');
        state.cleanup.push(() => el.remove());
        await sleepIn(state, ms);
        el.remove();
      },
      get count() { return count; },
    };
    count = bumpClickCount();
    try {                                            // 触发计数（管理员页的"统计"读它）
      const key = 'dangerEffectCounts';
      const m = JSON.parse(localStorage.getItem(key) || '{}') || {};
      m[eff.id] = (Number(m[eff.id]) || 0) + 1;
      localStorage.setItem(key, JSON.stringify(m));
    } catch (_) {}
    const watchdog = setTimeout(() => cancel(), eff.maxMs || 12000);
    try {
      await eff.run(h);
    } catch (err) {
      console.error('[danger] 效果执行出错：' + eff.id, err);
    } finally {
      clearTimeout(watchdog);
      cleanup(state);
      if (running === state) running = null;
    }
    return true;
  }

  // 随机抽取：rare 效果（原神）不进池，由下面的 rollRare() 单独掷骰子
  function pick(excludeLast = true) {
    let last = '';
    try { last = localStorage.getItem('dangerLastEffect') || ''; } catch (_) {}
    // 权重 0 的效果（原神、解锁庆祝）不进随机池，只能由特定入口触发
    const cand = POOL.filter(e => !e.rare && e.id !== 'audio'
      && e.weight > 0 && !(excludeLast && e.id === last));
    const total = cand.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of cand) { r -= e.weight; if (r <= 0) return e.id; }
    return cand[0].id;
  }

  // 稀有彩蛋：命中就返回 'genshin'，否则 null
  const RARE_ODDS = 0.01;     // 百分之一（用户要求；原为万分之一）
  function rollRare() { return Math.random() < RARE_ODDS ? 'genshin' : null; }

  function remember(id) { try { localStorage.setItem('dangerLastEffect', id); } catch (_) {} }

  window.dangerEffects = {
    ids: () => POOL.map(e => e.id),
    names: () => POOL.map(e => e.id + ': ' + e.name),
    run: async id => { remember(id); return run(id); },   // 供 CDP 验收逐个调用
    pick,
    rollRare,                 // 百分之一：命中原神
    RARE_ODDS,
    remember,
    isRunning: () => !!running,
    cancel,
  };
})();
