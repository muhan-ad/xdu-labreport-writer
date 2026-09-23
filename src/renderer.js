// renderer.js — 渲染进程逻辑
let experiments = [];
let currentExp = null;
let currentCategory = 'all';
let isGenerating = false;
let selectedIds = new Set();
let isBatchRunning = false;
// 方式三·生成队列状态
let genQueue = [];        // [{id, name, exp, status:'queued|running|done|failed|cancelled', elapsed, error}]
let queueState = 'idle';  // idle | running | paused | cancelled
let queueResume = null;   // 暂停时唤醒调度循环的 resolve
// 数据未保存标记（表单编辑）
let isDataModified = false;
let isSwitchingExperiment = false;
let isSavingData = false;
let isAiPolishing = false;
// 图表预览
let chartPreviewUrl = null;

const $ = (id) => document.getElementById(id);

// ── 获取 skill：百度网盘分享链接（技能文件 .md 包）──
const SKILL_PAN_URL = 'https://pan.baidu.com/s/1UzAla9IiEZ2KZ-Dvdtp_aA?pwd=f2dh';
const SKILL_PAN_CODE = 'f2dh';

// ── 渲染层错误采集（诊断日志用）：环形缓冲 60 条 + 上报主进程日志 ──
const renderErrorBuffer = [];
function pushRenderError(type, message, detail) {
  const entry = {
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    type,
    message: String(message || '未知错误').slice(0, 300),
    detail: String(detail || '').slice(0, 500),
  };
  renderErrorBuffer.push(entry);
  if (renderErrorBuffer.length > 60) renderErrorBuffer.shift();
  try {
    if (window.labAPI && window.labAPI.logEvent) {
      window.labAPI.logEvent(`[${type}] ${entry.message}${entry.detail ? ' @ ' + entry.detail : ''}`);
    }
  } catch (e) { /* 上报失败忽略 */ }
}
window.addEventListener('error', (ev) => {
  const d = ev.error && ev.error.stack ? ev.error.stack.split('\n').slice(0, 2).join(' | ') : '';
  pushRenderError('error', ev.message, d);
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  const msg = (r && (r.message || r.stack)) ? (r.message ? r.message : String(r).slice(0, 300)) : String(r || 'Promise 拒绝').slice(0, 300);
  pushRenderError('unhandledrejection', msg);
});

// ── 实验标准名称映射（文件夹名 → 教材标准名称）──
// 目录已按知识库（lab_部分1.pdf）目录名统一，此处保留映射以备将来目录名调整时兜底
const STANDARD_NAMES = {
  '长度与体积的测量': '长度与体积的测量',
  '扭摆法测量钢丝切变模量': '扭摆法测量钢丝切变模量',
  '重力加速度的测量': '重力加速度的测量',
  '刚体转动惯量的测量': '刚体转动惯量的测量',
  '简谐振动的合成': '简谐振动的合成',
  '声速的测量（水中）': '声速的测量（水中）',
  '声速的测量（空气）': '声速的测量（空气）',
  '薄透镜焦距的测量（凸透镜）': '薄透镜焦距的测量（凸透镜）',
  '薄透镜焦距的测量（凹透镜）': '薄透镜焦距的测量（凹透镜）',
  '衍射光强分布的测量': '衍射光强分布的测量',
  '三棱镜顶角的测量': '三棱镜顶角的测量',
  '平凸透镜曲率半径的测量': '平凸透镜曲率半径的测量',
  '光的偏振特性测量': '光的偏振特性测量',
  '激光波长的测量': '激光波长的测量',
  '光栅光谱的测量': '光栅光谱的测量',
  '电表的改装与校准': '电表的改装与校准',
  '电子元件伏安特性的测量': '电子元件伏安特性的测量',
  '电子偏转特性的测量': '电子偏转特性的测量',
  '灵敏电流计特性的测量': '灵敏电流计特性的测量',
  '静电场的模拟': '静电场的模拟',
  '霍尔效应实验': '霍尔效应实验',
  '直螺线管磁场分布的测量': '直螺线管磁场分布的测量',
  '低电阻的测量': '低电阻的测量',
  '拉伸法测量钢丝杨氏弹性模量': '拉伸法测量钢丝杨氏弹性模量',
  '电容与高电阻的测量': '电容与高电阻的测量',
  '劈尖干涉': '劈尖干涉',
  '理想气体状态方程': '理想气体状态方程',
};

function getDisplayName(exp) {
  return STANDARD_NAMES[exp.id] || exp.name;
}

// ── Toast 通知 ──
function showToast(type, title, detail = '', duration = 3000) {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${detail ? `<div class="toast-detail">${detail}</div>` : ''}
    </div>
    <button class="toast-close">×</button>
  `;

  // 新弹窗出现时删除上一个，避免弹窗堆积
  container.innerHTML = '';
  container.appendChild(toast);

  const close = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').onclick = close;
  if (duration > 0) setTimeout(close, duration);
}

// ── 实验分类 ──
const CATEGORY_RULES = {
  mechanics: ['扭摆', '重力', '转动惯量', '简谐振动', '拉伸法', '杨氏', '复摆', '三线摆', '音叉', '动量', '碰撞'],
  optics: ['薄透镜', '衍射', '三棱镜', '平凸', '牛顿环', '偏振', '激光波长', '光栅', '劈尖', '迈克尔逊', '焦距', '光强'],
  electromagnetism: ['电表', '电子元件', '伏安', '电子束', '电子偏转', '灵敏电流计', '静电场', '霍尔', '螺线管', '磁场', '低电阻', '电容', '高电阻', 'RLC', '马吕斯', '单臂电桥', '电流场', '双臂电桥', '电动势', '电位差计'],
};

function getCategory(name) {
  for (const [cat, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some(kw => name.includes(kw))) return cat;
  }
  return 'other';
}

const CATEGORY_NAMES = {
  all: '全部实验',
  mechanics: '力学',
  optics: '光学',
  electromagnetism: '电磁学',
  other: '其他',
};

// ── 学生信息（localStorage）──
function loadStudentInfo() {
  try {
    return JSON.parse(localStorage.getItem('studentInfo') || '{}');
  } catch { return {}; }
}
function saveStudentInfo(info) {
  localStorage.setItem('studentInfo', JSON.stringify(info));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('appSettings') || '{}');
  } catch { return {}; }
}
function saveSettings(settings) {
  delete settings.apiKey;
  localStorage.setItem('appSettings', JSON.stringify(settings));
}

// 扫描实验（主进程返回 {experiments, warnings}；此处归一为数组并携带 warnings 供提示）
async function fetchExperiments() {
  const r = await window.labAPI.scanExperiments();
  if (Array.isArray(r)) return r;   // 兼容异常返回
  const arr = (r && Array.isArray(r.experiments)) ? r.experiments : [];
  arr.warnings = (r && Array.isArray(r.warnings)) ? r.warnings : [];
  return arr;
}

// 扫描时被跳过的异常实验：提示用户（其余实验正常，异常项可导出诊断日志排查）
function showScanWarnings(expList) {
  const ws = expList && Array.isArray(expList.warnings) ? expList.warnings : [];
  if (!ws.length) return;
  showToast('warning', '部分实验数据异常', `已隐藏 ${ws.length} 个异常实验：${ws.slice(0, 3).join('；')}${ws.length > 3 ? '；…' : ''}`, 8000);
}

// ── AI 润色强约束：公式不可修改（程序化比对，不依赖模型自觉）──

// 当前实验未填的必填字段数（诊断导出用）：null 值必填字段与数组/矩阵内的空元素计数；未选实验返回 -1
function countMissingRequired(schema, data) {
  if (!schema || !data || typeof data !== 'object') return -1;
  let n = 0;
  for (const group of schema.groups || []) {
    for (const field of group.fields || []) {
      if (!field.required) continue;
      const v = data[field.key];
      if (v == null) { n++; continue; }
      if (field.type === 'array' && Array.isArray(v)) {
        n += v.filter(x => x == null).length;
      } else if (field.type === 'matrix' && Array.isArray(v)) {
        for (const row of v) if (Array.isArray(row)) n += row.filter(x => x == null).length;
      }
    }
  }
  return n;
}

// ── 初始化 ──
async function init() {
  const legacy = loadSettings();
  if (legacy.apiKey) {
    const migrated = await window.labAPI.saveCredential({ ...legacy, key: legacy.apiKey });
    if (migrated.ok) { legacy.hasApiKey = migrated.configured; saveSettings(legacy); }
    else showToast('error', '密钥迁移失败', migrated.error + '，请在设置中重新保存', 8000);
  }
  const credentials = await window.labAPI.credentialStatus();
  const settings = loadSettings();
  if (!settings.apiKey) { settings.hasApiKey = !!credentials.configured; saveSettings(settings); }

  experiments = await fetchExperiments();
  experiments.forEach(e => { e.category = getCategory(e.name); });
  showScanWarnings(experiments);

  updateCategoryCounts();
  applyDevUi();
  renderList();
  updateEmptyStats();
  updateStudentDisplay();
  bindEvents();
}

// ── 开发者调试模式 ──
function isDevMode() {
  return !!loadSettings().developerMode;
}

// 应用开发者模式 UI：开关切换时 / 启动时调用
function applyDevUi() {
  const dev = isDevMode();
  // dataFileInfo（data.json 文件名/路径/外部打开）、批量入口与自建变体导入仅开发者模式可见
  const devEls = ['btnBatch', 'btnQueuePanel', 'btnSelectAll', 'btnOpenData', 'btnOpenData2', 'dataFileInfo', 'btnImportCustomVariants'];
  devEls.forEach(id => {
    const el = $(id);
    if (el) el.style.display = dev ? '' : 'none';
  });
  if (!dev) selectedIds.clear();   // 关闭调试模式时清空选中，避免残留状态
}

function setDevMode(on) {
  const s = loadSettings();
  s.developerMode = !!on;
  saveSettings(s);
  applyDevUi();
  renderList();
  try { window.labAPI.logEvent(`setDevMode=${on}`); } catch (e) { /* 忽略 */ }
  showToast('success', '已切换', on ? '开发者调试模式已开启' : '已回到普通模式', 3000);
}

function loadDevelopPane() {
  const dev = isDevMode();
  $('rdDevMode').checked = dev;
  $('rdNormalMode').checked = !dev;
}

// ── 变体管理：实验级章节开关（设置-开发者调试）──
async function loadSecCfgExpList() {
  const sel = $('secCfgExpSel');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  for (const e of experiments) {
    const opt = document.createElement('option');
    opt.value = e.path;
    opt.textContent = getDisplayName(e);
    sel.appendChild(opt);
  }
  const exp = experiments.find(e => e.path === prev) || experiments[0];
  if (exp) { sel.value = exp.path; await loadSecCfgForExp(exp); }
}

async function loadSecCfgForExp(exp) {
  const box = $('secCfgList');
  if (!box) return;
  box.innerHTML = '';
  const lr = await window.labAPI.loadVariants(exp.path);
  const sections = (lr && lr.ok && lr.variants) ? Object.keys(lr.variants) : [];
  if (!sections.length) {
    box.innerHTML = '<div class="form-hint">该实验没有变体章节（无需配置）</div>';
    return;
  }
  const rr = await window.labAPI.readSectionsConfig(exp.path);
  const disabled = new Set((rr && rr.ok) ? rr.disabled : []);
  for (const s of sections) {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !disabled.has(s);
    cb.dataset.section = s;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + s));
    box.appendChild(label);
  }
}

async function saveSecCfg() {
  const sel = $('secCfgExpSel');
  const exp = experiments.find(e => e.path === sel.value);
  if (!exp) return;
  const disabled = Array.from($('secCfgList').querySelectorAll('input[type=checkbox]:not(:checked)'))
    .map(cb => cb.dataset.section);
  const r = await window.labAPI.writeSectionsConfig(exp.path, disabled);
  if (r && r.ok) showToast('success', '已保存', `${getDisplayName(exp)} 章节开关已保存，下次生成报告时生效`);
  else showToast('error', '保存失败', (r && r.error) || '未知错误', 5000);
}

// ── 导出诊断日志（设置-开发者调试；主进程统一脱敏）──
async function exportDiagnostics() {
  const btn = $('btnExportDiagnostics');
  const statusEl = $('diagnosticsStatus');
  btn.disabled = true;
  statusEl.textContent = '正在收集并导出…';
  try {
    const settings = loadSettings();
    const student = loadStudentInfo();
    // 配置摘要：绝不携带 apiKey
    const config = {
      provider: settings.provider || '',
      model: settings.model || '',
      apiUrl: settings.apiUrl || '',
      aiPolish: !!settings.aiPolish,
      kbOnly: settings.kbOnly !== false,
      developerMode: !!settings.developerMode,
      skills: (skillsCache || []).filter(s => !s.disabled).map(s => s.name),
    };
    const payload = {
      config,
      student: {
        name: student.name || '',
        id: student.id || '',
        class: student.class || '',
        date: student.date || '',
      },
      renderErrors: renderErrorBuffer,
      expCount: experiments.length,
      queueState,
      queueSize: genQueue.length,
      updateInfo: updateInfo || null,
      // 数据填写状态：当前实验未填必填字段数（-1=未选择实验）
      pendingRequired: countMissingRequired(currentSchema, currentData),
    };
    const r = await window.labAPI.exportDiagnostics(payload);
    if (!r.ok) {
      statusEl.textContent = '';
      showToast('error', '导出失败', r.error, 5000);
      return;
    }
    if (r.canceled) {
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = `已导出：${r.path}`;
    showToast('success', '诊断日志已导出', '已隐藏 API Key 等敏感信息（API Key 与润色内容不会包含在文件中）', 5000);
  } catch (err) {
    statusEl.textContent = '';
    showToast('error', '导出异常', err.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

// ── 分类计数 ──
function updateCategoryCounts() {
  const counts = { all: experiments.length, mechanics: 0, optics: 0, electromagnetism: 0, other: 0 };
  experiments.forEach(e => { counts[e.category]++; });
  $('count-all').textContent = counts.all;
  $('count-mechanics').textContent = counts.mechanics;
  $('count-optics').textContent = counts.optics;
  $('count-em').textContent = counts.electromagnetism;
  $('count-other').textContent = counts.other;
}

// ── 渲染实验列表 ──
function renderList(keyword = '') {
  const list = $('expList');
  list.innerHTML = '';

  let filtered = experiments;
  if (currentCategory !== 'all') {
    filtered = filtered.filter(e => e.category === currentCategory);
  }
  if (keyword) {
    const kw = keyword.toLowerCase();
    filtered = filtered.filter(e => e.name.toLowerCase().includes(kw));
  }

  $('listTitle').textContent = CATEGORY_NAMES[currentCategory];
  $('listCount').textContent = filtered.length;

  // 排序：有自建变体的实验优先置顶 → 分类顺序 → 名称
  const catOrder = { mechanics: 0, optics: 1, electromagnetism: 2, other: 3 };
  filtered.sort((a, b) => {
    const ca = a.hasCustomVariants ? 1 : 0;
    const cb = b.hasCustomVariants ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (a.category !== b.category) return catOrder[a.category] - catOrder[b.category];
    return a.name.localeCompare(b.name, 'zh');
  });

  for (const exp of filtered) {
    const li = document.createElement('li');
    const isSelected = selectedIds.has(exp.id);
    const isActive = currentExp && currentExp.id === exp.id;
    li.className = 'exp-item' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '');
    const checkboxHtml = isDevMode()
      ? `<div class="exp-checkbox ${isSelected ? 'checked' : ''}" data-id="${exp.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>`
      : '';
    const badgeHtml = exp.hasCustomVariants ? '<span class="exp-badge-custom">自建</span>' : '';
    li.innerHTML = checkboxHtml + `
      <span class="exp-dot ${exp.hasReport ? 'done' : ''}"></span>
      <span class="exp-name">${getDisplayName(exp)}${badgeHtml}</span>
      <span class="exp-cat">${CATEGORY_NAMES[exp.category].slice(0, 2)}</span>
    `;
    // checkbox 点击只切换选中，不打开详情（开发者模式才有）
    const cb = li.querySelector('.exp-checkbox');
    if (cb) {
      cb.onclick = (e) => {
        e.stopPropagation();
        toggleSelect(exp.id);
      };
    }
    li.onclick = () => selectExperiment(exp);
    list.appendChild(li);
  }
  updateBatchButton();
  updateSelectAllButton();
}

// ── 选中实验 ──
async function selectExperiment(exp) {
  // 报告生成中或 AI 润色进行中禁止切换：避免生成日志/润色上下文与当前实验错位显示
  const queueRunning = (typeof queueState !== 'undefined' && queueState === 'running');   // typeof 兜底：测试 vm 提取段无此模块级变量
  const aiPolishBusy = (typeof isAiPolishing !== 'undefined' && isAiPolishing);
  if (currentExp?.id === exp.id || isSwitchingExperiment || isSavingData || isGenerating || queueRunning || aiPolishBusy) {
    if (isGenerating || queueRunning || aiPolishBusy) {
      showToast('info', aiPolishBusy ? '润色进行中' : '正在生成报告',
        aiPolishBusy ? 'AI 润色进行中，请等待完成后再切换实验' : '报告生成中，请等待完成后再切换实验', 3000);
    }
    return;
  }
  isSwitchingExperiment = true;
  try {
  // 切换实验前若有未保存修改：保存并切换 / 取消则保留修改不切换（不静默丢弃）
  if (currentExp && currentExp.id !== exp.id && isDataModified) {
    const save = await appConfirm('当前实验有未保存的修改。\n点击「确定」保存并切换；点击「取消」不切换（修改保留）。');
    if (save) {
      const okSave = await saveFormData();
      if (!okSave) return;   // 保存失败不切换
    } else {
      return;   // 取消切换
    }
  }
  currentExp = exp;
  lastPolishResults = [];   // 切换实验清空上一实验的润色结果，防跨实验导入
  $('emptyState').style.display = 'none';
  $('detailPanel').style.display = 'block';
  $('batchPanel').style.display = 'none';

  $('expName').textContent = getDisplayName(exp);
  $('expCat').textContent = CATEGORY_NAMES[exp.category];

  $('metaData').textContent = exp.hasData ? '数据已就绪' : '无数据模板';
  $('metaData').className = 'meta-dot' + (exp.hasData ? ' ok' : '');
  $('metaReport').textContent = exp.hasReport ? '报告已生成' : '未生成';
  $('metaReport').className = 'meta-dot' + (exp.hasReport ? ' ok' : '');

  $('dataFileName').textContent = exp.dataFile ? exp.dataFile.split(/[\\/]/).pop() : 'data.json（保存后生成）';
  $('dataFilePath').textContent = exp.dataFile || '—';

  $('btnOpenData').disabled = !exp.hasData;
  $('btnOpenData2').disabled = !exp.hasData;
  $('btnOpenReport').disabled = !exp.hasReport;
  $('btnOpenReport2').disabled = !exp.hasReport;

  // 结果区
  setResultState(exp.hasReport && exp.reportFile ? 'success' : 'empty', exp.reportFile);

  $('logContent').textContent = '等待生成...';

  // 切换到数据录入 tab
  switchTab('data');
  renderList($('searchInput').value);

  // 方式三：检测 schema，加载表单
  await loadExperimentData(exp);
  // 加载变体组合面板
  await loadVariantsUI(exp);
  // 重置预览状态
  previewLoaded = false;
  // 重置图表预览
  chartPreviewUrl = null;
  // 更新 AI 状态（润色对象/技能/导入提示）
  updateAiStatus();
  await refreshAiScopeOptions(false);
  loadSkillList();
  updateOverrideBar();
  } finally {
    isSwitchingExperiment = false;
  }
}

// ── 多选与批量生成 ──
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderList($('searchInput').value);
}

function toggleSelectAll() {
  const list = $('expList');
  const visibleIds = Array.from(list.querySelectorAll('.exp-checkbox')).map(cb => cb.dataset.id);
  const allSelected = visibleIds.every(id => selectedIds.has(id));
  if (allSelected) {
    visibleIds.forEach(id => selectedIds.delete(id));
  } else {
    visibleIds.forEach(id => selectedIds.add(id));
  }
  renderList($('searchInput').value);
}

function updateSelectAllButton() {
  const list = $('expList');
  const visibleIds = Array.from(list.querySelectorAll('.exp-checkbox')).map(cb => cb.dataset.id);
  const btn = $('btnSelectAll');
  if (visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

function updateBatchButton() {
  const btn = $('btnBatch');
  const count = selectedIds.size;
  if (count > 0 && !isBatchRunning) {
    btn.disabled = false;
    btn.textContent = `批量生成 (${count})`;
  } else if (isBatchRunning) {
    btn.disabled = true;
    btn.textContent = '生成中...';
  } else {
    btn.disabled = true;
    btn.textContent = '批量生成';
  }
}

async function runBatchGenerate() {
  if (isGenerating || isSavingData || isSwitchingExperiment) return;
  // 队列活跃（running/paused）时点击只是回面板查看，不重建
  if (queueState === 'running' || queueState === 'paused') { openQueuePanel(); return; }
  const sel = experiments.filter(e => selectedIds.has(e.id));
  if (sel.length === 0) { showToast('warning', '未选择实验', '请先在列表勾选要生成的实验'); return; }
  genQueue = sel.map(e => ({ id: e.id, name: e.name, exp: e, status: 'queued', elapsed: 0, error: '' }));
  if ($('batchLog')) $('batchLog').textContent = '';
  openQueuePanel();
  await pumpQueue();
}

function openQueuePanel() {
  $('emptyState').style.display = 'none';
  $('detailPanel').style.display = 'none';
  $('batchPanel').style.display = 'block';
  renderQueue(); renderQueueControls(); updateQueueProgress();
}

async function pumpQueue() {
  queueState = 'running'; isBatchRunning = true;
  renderQueue(); renderQueueControls(); updateQueueProgress(); updateBatchButton();
  const studentInfo = loadStudentInfo();
  for (const q of genQueue) {
    if (q.status !== 'queued') continue;
    while (queueState === 'paused') await new Promise(res => { queueResume = res; });
    if (queueState === 'cancelled') break;
    q.status = 'running'; q.startedAt = Date.now(); q.error = '';
    renderQueue(); renderQueueControls(); updateQueueProgress();
    $('batchLog').textContent += `\n▶ ${getDisplayName(q.exp)}\n`;
    try {
      const r = await window.labAPI.runGenerate(q.exp.path, studentInfo, null, expOverrides(q.exp.id), loadSettings().embedDataPhoto !== false);
      q.elapsed = (Date.now() - q.startedAt) / 1000;
      q.status = r.ok ? 'done' : (r.cancelled ? 'cancelled' : 'failed');
      if (!r.ok) q.error = r.error || ('exit ' + r.exitCode);
    } catch (err) {
      q.elapsed = (Date.now() - q.startedAt) / 1000;
      q.status = 'failed'; q.error = err.message;
    }
    $('batchLog').textContent += `  ${q.status === 'done' ? '✓' : '✗'} ${q.elapsed.toFixed(1)}s${q.error ? ' · ' + q.error : ''}\n`;
    $('batchLog').scrollTop = $('batchLog').scrollHeight;
    renderQueue(); updateQueueProgress();
  }
  if (queueState === 'cancelled') genQueue.forEach(q => { if (q.status === 'queued') q.status = 'cancelled'; });
  queueState = 'idle'; isBatchRunning = false; queueResume = null;
  renderQueue(); renderQueueControls(); updateQueueProgress(); updateBatchButton();
  try {
    experiments = await fetchExperiments();
    experiments.forEach(e => { e.category = getCategory(e.name); });
    updateCategoryCounts(); updateEmptyStats(); renderList($('searchInput').value);
  } catch (e) { /* 刷新失败不影响队列结果 */ }
}

function pauseQueue() { if (queueState === 'running') { queueState = 'paused'; renderQueueControls(); } }
function resumeQueue() {
  if (queueState === 'paused') {
    queueState = 'running'; renderQueueControls();
    if (queueResume) { const r = queueResume; queueResume = null; r(); }
  }
}
function cancelAllQueue() {
  if (queueState !== 'running' && queueState !== 'paused') return;
  queueState = 'cancelled'; renderQueueControls();
  try { window.labAPI.cancelGenerate(); } catch (e) {}
  if (queueResume) { const r = queueResume; queueResume = null; r(); }
}
function cancelQueueItem(id) {
  const q = genQueue.find(x => x.id === id); if (!q) return;
  if (q.status === 'queued') { q.status = 'cancelled'; renderQueue(); updateQueueProgress(); }
  else if (q.status === 'running') { try { window.labAPI.cancelGenerate(); } catch (e) {} }
}
function removeQueueItem(id) {
  const q = genQueue.find(x => x.id === id);
  if (!q || q.status === 'running') return;
  genQueue = genQueue.filter(x => x.id !== id);
  renderQueue(); updateQueueProgress();
}
function moveQueueItem(id, dir) {
  const i = genQueue.findIndex(x => x.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= genQueue.length) return;
  if (genQueue[i].status !== 'queued' || genQueue[j].status === 'running') return;
  [genQueue[i], genQueue[j]] = [genQueue[j], genQueue[i]];
  renderQueue();
}
function clearFinishedQueue() {
  genQueue = genQueue.filter(q => q.status === 'queued' || q.status === 'running');
  renderQueue(); updateQueueProgress();
}

const QUEUE_STATUS_TEXT = { queued: '等待', running: '生成中…', done: '✓ 完成', failed: '✗ 失败', cancelled: '已取消' };
// 顶栏"队列"入口：队列非空即可回到面板；运行/暂停时高亮提示
function updateQueueEntry() {
  const btn = $('btnQueuePanel');
  if (!btn) return;
  const n = genQueue.length;
  const active = queueState === 'running' || queueState === 'paused';
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `队列 (${n})` : '队列';
  btn.className = 'btn btn-sm ' + (active ? 'btn-primary' : 'btn-ghost');
  btn.title = active ? '队列运行中，点击查看' : '打开生成队列面板';
}

function renderQueue() {
  updateQueueEntry();
  const list = $('queueList'); if (!list) return;
  if (!genQueue.length) { list.innerHTML = '<div class="queue-empty">队列为空</div>'; renderQueueControls(); return; }
  let html = '';
  for (const q of genQueue) {
    const acts = [];
    if (q.status === 'queued') {
      acts.push(`<button class="qbtn" data-act="up" data-id="${q.id}" title="上移">↑</button>`);
      acts.push(`<button class="qbtn" data-act="down" data-id="${q.id}" title="下移">↓</button>`);
      acts.push(`<button class="qbtn qbtn-danger" data-act="cancel" data-id="${q.id}" title="取消">✕</button>`);
    } else if (q.status === 'running') {
      acts.push(`<button class="qbtn qbtn-danger" data-act="cancel" data-id="${q.id}" title="终止当前">■</button>`);
    } else {
      acts.push(`<button class="qbtn" data-act="remove" data-id="${q.id}" title="移除">－</button>`);
    }
    const meta = q.error ? escapeHtml(q.error) : (q.elapsed ? q.elapsed.toFixed(1) + 's' : '');
    html += `<div class="queue-item q-${q.status}">`
      + `<span class="q-status">${QUEUE_STATUS_TEXT[q.status]}</span>`
      + `<span class="q-name">${escapeHtml(getDisplayName(q.exp))}</span>`
      + `<span class="q-meta">${meta}</span>`
      + `<span class="q-acts">${acts.join('')}</span>`
      + `</div>`;
  }
  list.innerHTML = html;
}

function renderQueueControls() {
  const badge = $('queueStateBadge');
  if (badge) {
    const m = { idle: '空闲', running: '运行中', paused: '已暂停', cancelled: '取消中' };
    badge.textContent = m[queueState] || queueState;
    badge.className = 'queue-state-badge qs-' + queueState;
  }
  const pause = $('btnQueuePause'), resume = $('btnQueueResume');
  if (pause) pause.style.display = (queueState === 'running') ? '' : 'none';
  if (resume) resume.style.display = (queueState === 'paused') ? '' : 'none';
  const active = queueState === 'running' || queueState === 'paused';
  if ($('btnQueueCancelAll')) $('btnQueueCancelAll').disabled = !active;
  if ($('btnQueueClear')) $('btnQueueClear').disabled = active;
}

function updateQueueProgress() {
  const total = genQueue.length;
  const done = genQueue.filter(q => q.status === 'done' || q.status === 'failed' || q.status === 'cancelled').length;
  if ($('batchProgressFill')) $('batchProgressFill').style.width = (total ? (done / total * 100) : 0) + '%';
  if ($('batchProgressText')) $('batchProgressText').textContent = `${done} / ${total}`;
}

// ── 事件日志 ──
function logEvent(msg) {
  try {
    if (window.labAPI && window.labAPI.logEvent) window.labAPI.logEvent(msg);
  } catch (e) { /* 忽略 */ }
}

// ══════════════════════════════════════════════════════════
// 方式三：表单模式（schema 驱动，data.json 为数据真相）
// 全部实验均有 schema.json，统一走表单渲染；无 schema 时提示未迁移
// ══════════════════════════════════════════════════════════
let currentSchema = null;   // 当前实验 schema（null = 未迁移）
let currentData = null;     // 当前表单数据

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function loadExperimentData(exp) {
  let sr = { ok: false, schema: null };
  try { sr = await window.labAPI.readSchema(exp.path); } catch (e) { /* 按未迁移处理 */ }
  if (sr.ok && sr.schema) {
    currentSchema = sr.schema;
    await loadFormData(exp);
  } else {
    currentSchema = null;
    currentData = null;
    $('dataTableWrap').innerHTML = '<div class="data-table-empty">该实验尚未迁移，暂不能在应用内填写</div>';
    $('sheetTabs').style.display = 'none';
    $('btnClearFormData').disabled = true;
    $('btnFillDefaultData').disabled = true;
  }
}

async function loadFormData(exp) {
  let result = { ok: false, data: null };
  try { result = await window.labAPI.readData(exp.path); } catch (e) { /* 忽略 */ }
  currentData = (result.ok && result.data) ? result.data : {};
  // schema 默认值只在"数据文件中缺失该字段"时回填一次；
  // 渲染层不再 fallback default，保证「清除数据」置空后不会被默认值恢复
  for (const group of (currentSchema?.groups || [])) {
    for (const fld of (group.fields || [])) {
      if (currentData[fld.key] !== undefined) continue;
      if (fld.type === 'array') {
        currentData[fld.key] = Array.isArray(fld.default)
          ? fld.default
          : new Array(fld.length || 0).fill(null);
      } else if (fld.type === 'matrix') {
        currentData[fld.key] = Array.isArray(fld.default)
          ? fld.default
          : Array.from({ length: fld.rows || 0 }, () => new Array(fld.cols || 0).fill(null));
      } else {
        currentData[fld.key] = fld.default !== undefined ? fld.default : null;
      }
    }
  }
  isDataModified = false;
  $('btnSaveData').disabled = true;
  $('btnClearFormData').disabled = false;
  $('btnFillDefaultData').disabled = false;
  notifyDataModified();
  $('sheetTabs').style.display = 'none';   // 表单模式无 sheet 切换
  $('dataIssueBar').style.display = 'none';
  renderForm();
  refreshFormCheck();
  populateChartFields();
}

// 清除表单全部可输入数据（置空，便于从头填写；需点"保存修改"才写入 data.json）
async function clearFormData() {
  if (!currentSchema || !currentExp) return;
  if (!(await appConfirm('清除当前实验表单中已填写的全部数据？\n所有字段将置为空值，清除后需点击「保存修改」才会写入数据文件。', { danger: true }))) return;
  for (const group of (currentSchema.groups || [])) {
    for (const fld of (group.fields || [])) {
      if (fld.type === 'array') {
        currentData[fld.key] = new Array(fld.length || 0).fill(null);
      } else if (fld.type === 'matrix') {
        currentData[fld.key] = Array.from({ length: fld.rows || 0 }, () => new Array(fld.cols || 0).fill(null));
      } else {
        currentData[fld.key] = null;
      }
    }
  }
  renderForm();
  isDataModified = true;
  notifyDataModified();
  $('btnSaveData').disabled = false;
  refreshFormCheck();
  showToast('info', '已清除', '全部字段已置空，填写后请点击「保存修改」');
}

// 填入默认数据：整表恢复为实验内置的测试数据（sample.json 快照；缺失时回退 schema 默认值），需二次确认
async function fillDefaultData() {
  if (!currentSchema || !currentExp) return;
  if (!(await appConfirm('将当前实验表单整表恢复为实验内置的测试数据？\n您已填写的字段将被测试数据覆盖！', { danger: true }))) return;
  if (!(await appConfirm('最后确认：恢复后当前填写内容将丢失，确定继续？', { danger: true }))) return;
  let sample = null;
  try {
    const r = await window.labAPI.readSampleData(currentExp.path);
    if (r.ok && r.data) sample = r.data;
  } catch (e) { /* 读取失败时回退 schema 默认值 */ }
  for (const group of (currentSchema.groups || [])) {
    for (const fld of (group.fields || [])) {
      const hasSample = sample && sample[fld.key] !== undefined;
      if (fld.type === 'array') {
        currentData[fld.key] = hasSample
          ? sample[fld.key].slice()
          : (Array.isArray(fld.default) ? fld.default.slice() : new Array(fld.length || 0).fill(null));
      } else if (fld.type === 'matrix') {
        currentData[fld.key] = hasSample
          ? sample[fld.key].map(r => r.slice())
          : (Array.isArray(fld.default) ? fld.default.map(r => r.slice()) : Array.from({ length: fld.rows || 0 }, () => new Array(fld.cols || 0).fill(null)));
      } else {
        currentData[fld.key] = hasSample ? sample[fld.key] : (fld.default !== undefined ? fld.default : null);
      }
    }
  }
  renderForm();
  isDataModified = true;
  notifyDataModified();
  $('btnSaveData').disabled = false;
  refreshFormCheck();
  showToast('success', '已填入', '全表已恢复为测试数据，点击「保存修改」后生效');
}

function renderForm() {
  const wrap = $('dataTableWrap');
  if (!currentSchema) { wrap.innerHTML = ''; return; }
  // 实验级样式挂载点（个别实验数据较长，需要更宽的数组格子）
  wrap.dataset.exp = (currentExp && currentExp.id) || '';
  let html = '<div class="schema-form">';
  for (const group of (currentSchema.groups || [])) {
    html += '<div class="form-group">';
    if (group.name) html += `<div class="form-group-title">${escapeHtml(group.name)}</div>`;
    for (const fld of (group.fields || [])) html += renderField(fld);
    html += '</div>';
  }
  html += '</div>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('input', onFormInput);
    // 禁止鼠标滚轮改变 number 输入框的值（聚焦时滚轮应滚动页面而非改数）
    if (inp.type === 'number') inp.addEventListener('wheel', (e) => { e.currentTarget.blur(); }, { passive: true });
  });
}

// ── 表单输入导航：Enter/空格 跳转到下一个输入格（提高录入效率）──
// 优先级：同行右边格子 → 下一行第一列 → 下一字段首格。array/matrix 按行优先渲染、
// science 尾数在指数前，故 DOM 顺序天然符合该优先级；最后一个格子不跳转。
function handleFormKeyNav(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !el.classList.contains('field-input')) return;
  // 文本类字段保留空格的输入含义（仅 Enter 跳转）；数字类格子 Enter/空格均跳转
  if (el.type === 'text' && e.key === ' ') return;
  const inputs = Array.from($('dataTableWrap').querySelectorAll('input.field-input:not(:disabled):not([readonly])'));
  const idx = inputs.indexOf(el);
  if (idx < 0 || idx >= inputs.length - 1) return;
  e.preventDefault();
  const next = inputs[idx + 1];
  next.focus();
  next.select();
}

// dataOverride：值来源覆盖（人工核对界面用它渲染识别结果，不改动主表单的 currentData）
function renderField(fld, dataOverride) {
  const key = fld.key;
  const label = escapeHtml(fld.label || key);
  const unit = fld.unit ? `<span class="field-unit">${escapeHtml(fld.unit)}</span>` : '';
  const src = dataOverride !== undefined ? dataOverride : currentData;
  const val = src ? src[key] : null;
  const hasVal = (v) => v !== null && v !== undefined && v !== '';

  if (fld.type === 'number') {
    const v = hasVal(val) ? val : '';   // 无默认回退：清除后保持空白（默认值已在 loadFormData 阶段填入）
    return `<div class="form-field form-field-number">`
      + `<label class="field-label">${label}</label>`
      + `<input type="number" step="any" class="field-input" data-key="${escapeHtml(key)}" value="${escapeHtml(v)}">`
      + unit + `</div>`;
  }
  if (fld.type === 'science') {
    // 科学计数法双框：尾数 × 10^指数（指数可自由输入，附预设建议；清除后指数框保持空白）
    let mantissa = '';
    let exp = '';
    if (hasVal(val)) {
      const num = Number(val);
      if (isFinite(num) && num !== 0) {
        exp = Math.floor(Math.log10(Math.abs(num)));
        mantissa = parseFloat((num / Math.pow(10, exp)).toPrecision(10));
      } else {
        mantissa = num;
      }
    }
    const suggs = Array.isArray(fld.expSuggestions) ? fld.expSuggestions : [-6, -7, -8, -9, -10, -11, -12];
    const dl = suggs.map(e => `<option value="${e}">10^${e}</option>`).join('');
    return `<div class="form-field form-field-science">`
      + `<label class="field-label">${label}</label>`
      + `<input type="number" step="any" class="field-input science-mantissa" data-key="${escapeHtml(key)}" value="${escapeHtml(mantissa)}" placeholder="有效数字">`
      + `<span class="sci-times">× 10^</span>`
      + `<input type="number" step="1" class="field-input science-exp" data-key="${escapeHtml(key)}" value="${exp}" list="sciExp_${escapeHtml(key)}">`
      + `<datalist id="sciExp_${escapeHtml(key)}">${dl}</datalist>`
      + unit + `</div>`;
  }
  if (fld.type === 'array') {
    const len = fld.length || (Array.isArray(val) ? val.length : 0);
    let cells = '';
    for (let i = 0; i < len; i++) {
      const av = (Array.isArray(val) && hasVal(val[i])) ? val[i] : '';
      cells += `<label class="array-cell"><span class="cell-idx">${i + 1}</span>`
        + `<input type="number" step="any" class="field-input array-input" data-key="${escapeHtml(key)}" data-idx="${i}" value="${escapeHtml(av)}"></label>`;
    }
    return `<div class="form-field form-field-array">`
      + `<div class="field-head"><span class="field-label">${label}</span>${unit}</div>`
      + `<div class="array-grid">${cells}</div></div>`;
  }
  if (fld.type === 'matrix') {
    const rows = fld.rows || 0, cols = fld.cols || 0;
    const rowLabels = fld.rowLabels || [], colLabels = fld.colLabels || [];
    let table = '<div class="matrix-scroll"><table class="matrix-input">';
    table += '<thead><tr><th class="matrix-corner"></th>';
    for (let c = 0; c < cols; c++) {
      const cl = (colLabels[c] != null) ? colLabels[c] : (c + 1);
      table += `<th class="matrix-col-label">${escapeHtml(String(cl))}</th>`;
    }
    table += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      const rl = (rowLabels[r] != null) ? rowLabels[r] : (r + 1);
      table += `<tr><td class="matrix-row-label">${escapeHtml(String(rl))}</td>`;
      for (let c = 0; c < cols; c++) {
        const mv = (Array.isArray(val) && val[r] && hasVal(val[r][c])) ? val[r][c] : '';
        table += `<td><input type="number" step="any" class="field-input matrix-cell" data-key="${escapeHtml(key)}" data-row="${r}" data-col="${c}" value="${escapeHtml(mv)}"></td>`;
      }
      table += '</tr>';
    }
    table += '</tbody></table></div>';
    return `<div class="form-field form-field-matrix">`
      + `<div class="field-head"><span class="field-label">${label}</span>${unit}</div>` + table + `</div>`;
  }
  // text 兜底
  const v = hasVal(val) ? val : '';
  return `<div class="form-field">`
    + `<label class="field-label">${label}</label>`
    + `<input type="text" class="field-input" data-key="${escapeHtml(key)}" value="${escapeHtml(v)}">`
    + unit + `</div>`;
}

function onFormInput() {
  if (!isDataModified) {
    isDataModified = true;
    $('btnSaveData').disabled = false;
    notifyDataModified();
  }
}

function readFormData() {
  const data = {};
  if (!currentSchema) return data;
  for (const group of (currentSchema.groups || [])) {
    for (const fld of (group.fields || [])) {
      const key = fld.key;
      if (fld.type === 'number') {
        const inp = document.querySelector(`input[data-key="${key}"]:not([data-idx]):not([data-row])`);
        data[key] = (inp && inp.value !== '') ? parseFloat(inp.value) : null;
      } else if (fld.type === 'science') {
        const m = document.querySelector(`input.science-mantissa[data-key="${key}"]`);
        const e = document.querySelector(`input.science-exp[data-key="${key}"]`);
        const mv = (m && m.value !== '') ? parseFloat(m.value) : NaN;
        // 指数留空时回退 schema 的默认指数（清除/重填后只填尾数也能合成正确量级）
        const ev = (e && e.value !== '') ? parseInt(e.value, 10) : (fld.expDefault !== undefined ? fld.expDefault : -9);
        data[key] = (isFinite(mv) && isFinite(ev)) ? mv * Math.pow(10, ev) : null;
      } else if (fld.type === 'array') {
        const inputs = document.querySelectorAll(`input[data-key="${key}"][data-idx]`);
        data[key] = Array.from(inputs).map(i => i.value !== '' ? parseFloat(i.value) : null);
      } else if (fld.type === 'matrix') {
        const rows = fld.rows || 0, cols = fld.cols || 0;
        const m = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            const inp = document.querySelector(`input[data-key="${key}"][data-row="${r}"][data-col="${c}"]`);
            row.push(inp && inp.value !== '' ? parseFloat(inp.value) : null);
          }
          m.push(row);
        }
        data[key] = m;
      } else {
        const inp = document.querySelector(`input[data-key="${key}"]`);
        data[key] = inp ? (inp.value === '' ? null : inp.value) : null;
      }
    }
  }
  return data;
}

async function saveFormData() {
  if (!currentExp || !currentSchema || isSavingData) return false;
  const saveExp = currentExp;
  isSavingData = true;
  try {
  const data = readFormData();
  const errors = dataValidation.validate(currentSchema, data, false);
  if (errors.length) { showToast('error', '数据无效', errors.join('；')); return false; }
  const result = await window.labAPI.writeData(saveExp.path, data);
  if (result.ok) {
    currentData = data;
    isDataModified = false;
    // 首次保存会把实验迁移到用户数据目录，同步当前实验与列表项的真实路径
    if (result.path) {
      currentExp.path = result.path;
      if (result.dataFile) currentExp.dataFile = result.dataFile;
      const listExp = experiments.find(e => e.id === currentExp.id);
      if (listExp) {
        listExp.path = result.path;
        if (result.dataFile) listExp.dataFile = result.dataFile;
      }
    }
    $('btnSaveData').disabled = true;
    notifyDataModified();
    showToast('success', '数据已保存', getDisplayName(currentExp));
    refreshFormCheck();
    return true;
  }
  showToast('error', '保存失败', result.error, 5000);
  return false;
  } finally {
    isSavingData = false;
  }
}

function refreshFormCheck() {
  if (!currentSchema) return;
  const data = readFormData();
  const missing = dataValidation.validate(currentSchema, data);
  for (const group of (currentSchema.groups || [])) {
    for (const fld of (group.fields || [])) {
      if (!fld.required) continue;
      const v = data[fld.key];
      if (v === null || v === undefined) { missing.push(fld.label || fld.key); continue; }
      if (Array.isArray(v)) {
        const flat = (v.length && Array.isArray(v[0])) ? v.flat() : v;
        if (flat.some(x => x === null || x === undefined)) missing.push(fld.label || fld.key);
      }
    }
  }
  const bar = $('dataIssueBar');
  if (missing.length > 0) {
    bar.style.display = 'block';
    bar.innerHTML = `<span class="issue-text">请检查 ${missing.length} 项数据：${escapeHtml(missing.join('、'))}</span>`;
  } else {
    bar.style.display = 'none';
  }
}

// 通知主进程当前是否有未保存的数据（用于关闭前提示）
function notifyDataModified() {
  if (window.labAPI && window.labAPI.setDataModified) {
    window.labAPI.setDataModified(isDataModified);
  }
}

async function saveExcelData() {
  if (currentSchema) return saveFormData();  // 方式三：统一走表单保存
  return false;
}

// ── 报告预览 ──
let previewLoaded = false;

async function getReportText(exp = currentExp) {
  if (!exp?.reportFile) return '';
  const r = await window.labAPI.reportText(exp.reportFile);
  return r.ok ? r.text : '';
}

function extractSection(text, scope) {
  if (scope === 'full') return text.trim();

  const patterns = {
    principle: ['实验原理', '实验目的', '实验原理与'],
    analysis: ['结果分析', '数据处理', '实验结果', '结果与分析', '数据记录与处理'],
    quiz: ['思考题', '课后思考题', '问题讨论'],
  };

  const keywords = patterns[scope] || [];
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx !== -1) {
      // 找到下一个章节标题（以"一、""二、""三、"等开头的行）
      const after = text.slice(idx + kw.length);
      const nextSection = after.search(/\n[一二三四五六七八九十]+、/);
      if (nextSection !== -1) {
        return (kw + after.slice(0, nextSection)).trim();
      }
      return (kw + after).trim();
    }
  }
  // 没找到对应章节，返回全文
  return text.trim();
}

function getAiStylePrompt(style) {
  const styles = {
    rigorous: '严谨学术风格：使用规范的物理学术语，逻辑严密，表述精确，符合大学物理实验报告的学术规范。',
    concise: '简洁明了风格：语言简练，直击要点，避免冗余修饰，用最少的文字表达完整的实验内容。',
    detailed: '详细充实风格：内容丰富，对实验现象和数据进行深入分析，补充必要的物理意义解释，使报告更加充实完整。',
  };
  return styles[style] || styles.rigorous;
}

// ── AI 润色：章节源文缓存 / 技能 / 导入覆盖 ──
let currentSections = null;      // .lab_sections.json 内容 {章节: 原文(含 $ 公式)}
let lastPolishResults = [];      // 本轮润色结果 [{section, displayScope, original, polished} | {error}]

function loadAllOverrides() { try { return JSON.parse(localStorage.getItem('polishOverrides') || '{}'); } catch { return {}; } }
function saveAllOverrides(all) { localStorage.setItem('polishOverrides', JSON.stringify(all)); }
function expOverrides(expId) { return loadAllOverrides()[expId] || {}; }
function setPolishOverride(expId, section, text) {
  const all = loadAllOverrides();
  (all[expId] = all[expId] || {})[section] = text;
  saveAllOverrides(all);
}
function clearPolishOverrides(expId) {
  const all = loadAllOverrides();
  delete all[expId];
  saveAllOverrides(all);
}

function updateOverrideBar() {
  const bar = $('aiOverrideBar');
  if (!bar) return;
  const keys = currentExp ? Object.keys(expOverrides(currentExp.id)) : [];
  if (!keys.length) { bar.style.display = 'none'; return; }
  $('aiOverrideText').textContent = `已导入润色章节：${keys.join('、')} —— 重新生成报告时将直接采用润色文本`;
  bar.style.display = 'flex';
}

async function refreshAiScopeOptions(keepValue) {
  const sourceExp = currentExp;
  currentSections = null;
  try {
    if (sourceExp) {
      const r = await window.labAPI.readSections(sourceExp.path);
      if (currentExp !== sourceExp) return;
      if (r && r.ok && r.sections) currentSections = r.sections;
    }
  } catch (e) { /* 无缓存按仅复制处理 */ }
  const box = $('aiScopeGroup');
  if (!box) return;
  const prev = keepValue ? new Set([...box.querySelectorAll('input:checked')].map(i => i.value)) : new Set();
  box.innerHTML = '';
  const add = (v, t) => {
    const label = document.createElement('label');
    label.className = 'ai-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = v;
    if (prev.has(v)) cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(t));
    box.appendChild(label);
  };
  if (currentSections) {
    for (const sec of Object.keys(currentSections)) add('sec:' + sec, sec + '（可导入）');
  }
  // 硬编码文本章节：源文取自已生成报告，能否导入由该实验的 generate.py 消费点决定（渲染结果时判定）
  add('analysis', '结果分析（取自报告）');
  add('quiz', '思考题（取自报告）');
  if (!prev.size) {
    const first = box.querySelector('input');
    if (first) first.checked = true;
  }
}

// ── AI 润色技能（文件制：userData/skills，由外部 Skill 文件导入）──
let skillsCache = [];   // [{id,name,description,content}]

function getSkillStates() {
  const s = loadSettings();
  return (s.skillStates && typeof s.skillStates === 'object') ? s.skillStates : {};
}
function setSkillState(id, enabled) {
  const s = loadSettings();
  s.skillStates = Object.assign({}, getSkillStates());
  s.skillStates[id] = enabled;
  saveSettings(s);
}
function getEnabledSkills() {
  const st = getSkillStates();
  return skillsCache.filter(sk => st[sk.id] !== false);
}
// 润色面板技能展示（只读）：启用与否由「设置 → AI 润色技能」的开关决定，这里不再逐次勾选
function renderSkillOptions() {
  const box = $('aiSkillGroup');
  if (!box) return;
  box.innerHTML = '';
  const skills = getEnabledSkills();
  if (!skills.length) {
    const span = document.createElement('span');
    span.className = 'ai-check-empty';
    span.textContent = '未启用技能 —— 可在「设置 → AI 润色技能」中启用';
    box.appendChild(span);
    return;
  }
  for (const sk of skills) {
    const chip = document.createElement('span');
    chip.className = 'ai-skill-chip';
    chip.title = sk.description || sk.name;
    chip.textContent = sk.name;
    box.appendChild(chip);
  }
}

async function loadSkillList() {
  try {
    const r = await window.labAPI.listSkills();
    skillsCache = (r && r.ok && Array.isArray(r.skills)) ? r.skills : [];
  } catch (e) { skillsCache = []; }
  renderSkillRows();
  renderSkillOptions();
}

function renderSkillRows() {
  const list = $('skillList');
  if (!list) return;
  list.innerHTML = '';
  if (!skillsCache.length) {
    const empty = document.createElement('div');
    empty.className = 'skill-empty';
    empty.textContent = '暂无技能 —— 点击下方「导入 skill」添加开源 Skill 文件（.md）';
    list.appendChild(empty);
    return;
  }
  const states = getSkillStates();
  for (const sk of skillsCache) {
    const row = document.createElement('div');
    row.className = 'skill-row';

    const info = document.createElement('div');
    info.className = 'skill-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'skill-name-text';
    nameEl.textContent = sk.name;
    info.appendChild(nameEl);
    if (sk.description) {
      const d = document.createElement('div');
      d.className = 'skill-desc';
      d.textContent = sk.description;
      d.title = sk.description;
      info.appendChild(d);
    }

    const toggle = document.createElement('label');
    toggle.className = 'checkbox-label skill-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = states[sk.id] !== false;
    cb.onchange = () => { setSkillState(sk.id, cb.checked); renderSkillOptions(); };
    toggle.appendChild(cb);
    toggle.appendChild(document.createTextNode('启用'));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-sm btn-ghost skill-del';
    del.textContent = '删除';
    del.onclick = async () => {
      if (!(await appConfirm('删除技能「' + sk.name + '」？\n技能文件将从配置文件夹中移除。', { danger: true }))) return;
      const rr = await window.labAPI.deleteSkill(sk.id);
      if (rr && rr.ok) { showToast('success', '已删除', sk.name); await loadSkillList(); }
      else showToast('error', '删除失败', (rr && rr.error) || '未知错误', 5000);
    };

    row.appendChild(info);
    row.appendChild(toggle);
    row.appendChild(del);
    list.appendChild(row);
  }
}

async function importSkillFiles() {
  const r = await window.labAPI.importSkill();
  if (!r || !r.ok) { showToast('error', '导入失败', (r && r.error) || '未知错误', 5000); return; }
  if (r.imported && r.imported.length) {
    showToast('success', '已导入 ' + r.imported.length + ' 个技能', r.imported.join('、'));
    await loadSkillList();
  }
  if (r.errors && r.errors.length) showToast('warning', '部分导入失败', r.errors.join('；'), 6000);
}

// ── 自建变体库（设置页：归档查看 / 删除 / 恢复 / 导出 / 批量导入）──
const CUSTOM_SECTION_ORDER = ['实验原理', '实验方法', '误差分析', '结论', '实验结论'];
let customVariantsCache = [];     // [{expId, sections:{章节:数量}, count}]
let customVariantsSelId = null;   // 当前展开详情的实验 id
let customVariantsDetail = null;  // {章节: [文本]}

async function loadCustomVariantsPane() {
  await loadCustomVariantsList();
}

async function loadCustomVariantsList() {
  const r = await window.labAPI.listCustomVariants();
  customVariantsCache = (r && r.ok) ? (r.list || []) : [];
  if (customVariantsSelId && !customVariantsCache.some(x => x.expId === customVariantsSelId)) {
    customVariantsSelId = null;
    customVariantsDetail = null;
  }
  renderCustomVariantList();
  renderCustomVariantDetail();
}

function renderCustomVariantList() {
  const el = $('customVariantExpList');
  if (!customVariantsCache.length) {
    el.innerHTML = '<div class="skill-empty">暂无自建变体 —— 用 AI 生成新变体时勾选「同时存入自建变体库」即可在此查看。</div>';
    return;
  }
  el.innerHTML = '';
  for (const item of customVariantsCache) {
    const row = document.createElement('div');
    const isSel = item.expId === customVariantsSelId;
    row.className = 'cv-exp-row' + (isSel ? ' active' : '');
    const badges = CUSTOM_SECTION_ORDER
      .filter(s => item.sections[s])
      .map(s => `${s}×${item.sections[s]}`)
      .join('　');
    row.innerHTML = `<span class="cv-exp-name">${escapeHtml(item.expId)}</span><span class="cv-exp-badges">${escapeHtml(badges)}</span>`;
    row.onclick = () => openCustomVariantDetail(item.expId);
    el.appendChild(row);
  }
}

async function openCustomVariantDetail(expId) {
  customVariantsSelId = expId;
  const r = await window.labAPI.readCustomVariants(expId);
  customVariantsDetail = (r && r.ok && r.data) ? r.data : null;
  renderCustomVariantList();
  renderCustomVariantDetail();
}

function renderCustomVariantDetail() {
  const el = $('customVariantDetail');
  if (!customVariantsSelId || !customVariantsDetail) {
    el.innerHTML = customVariantsCache.length
      ? '<div class="cv-detail-empty">点击上方实验查看各章节的自建变体</div>'
      : '';
    return;
  }
  const sections = CUSTOM_SECTION_ORDER.filter(s => Array.isArray(customVariantsDetail[s]) && customVariantsDetail[s].length);
  if (!sections.length) {
    el.innerHTML = '<div class="cv-detail-empty">该实验暂无自建变体</div>';
    return;
  }
  let html = '';
  for (const s of sections) {
    html += `<div class="cv-detail-section"><div class="cv-detail-title"><span>${escapeHtml(s)}</span></div>`;
    customVariantsDetail[s].forEach((text, idx) => {
      html += `<div class="cv-item"><span class="cv-item-text" title="${escapeHtml(String(text).slice(0, 300))}">${escapeHtml(String(text).slice(0, 60))}</span>`
        + `<span class="cv-item-actions">`
        + `<button class="btn btn-xs btn-outline cv-restore" data-section="${escapeHtml(s)}" data-idx="${idx}">恢复到实验</button>`
        + `<button class="btn btn-xs btn-outline cv-del" data-section="${escapeHtml(s)}" data-idx="${idx}">删除</button>`
        + `</span></div>`;
    });
    html += '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.cv-del').forEach(b => {
    b.onclick = () => deleteCustomVariantOne(b.dataset.section, parseInt(b.dataset.idx, 10));
  });
  el.querySelectorAll('.cv-restore').forEach(b => {
    b.onclick = () => restoreVariantToExperiment(b.dataset.section, parseInt(b.dataset.idx, 10));
  });
}

// 自建库变更后：刷新设置列表 + 主界面实验列表（排序/徽章）
async function refreshAfterCustomVariantChange() {
  await loadCustomVariantsList();
  try {
    experiments = await fetchExperiments();
    experiments.forEach(e => { e.category = getCategory(e.name); });
    renderList();
    updateCategoryCounts();
    updateEmptyStats();
  } catch (e) { /* 扫描失败不阻塞 */ }
  // 同步当前打开的实验：更新路径引用并重读变体列表，
  // 保证删除/恢复后主界面变体下拉与磁盘一致（不再显示已删除的“生成后的变体”）
  if (currentExp) {
    const updated = experiments.find(e => e.id === currentExp.id);
    if (updated) {
      currentExp = updated;
      try { await loadVariantsUI(updated); } catch (e) { /* 忽略 */ }
    }
  }
}

async function deleteCustomVariantOne(section, index) {
  if (!customVariantsSelId) return;
  const arr = (customVariantsDetail && customVariantsDetail[section]) || [];
  const preview = typeof arr[index] === 'string' ? arr[index].slice(0, 30) : '';
  if (!(await appConfirm(`删除「${section}」中的这条自建变体？\n${preview}…`, { danger: true }))) return;
  const r = await window.labAPI.deleteCustomVariant(customVariantsSelId, section, index);
  if (!r.ok) { showToast('error', '删除失败', r.error, 5000); return; }
  showToast('success', '已删除', '自建变体条目已移除');
  await refreshAfterCustomVariantChange();
}

async function restoreVariantToExperiment(section, index) {
  if (!customVariantsSelId) return;
  const arr = (customVariantsDetail && customVariantsDetail[section]) || [];
  const text = arr[index];
  if (typeof text !== 'string' || !text) { showToast('error', '内容无效', '该条目内容为空'); return; }
  const target = experiments.find(e => e.id === customVariantsSelId);
  if (!target) { showToast('error', '未找到实验', '该实验可能已被移除'); return; }
  if (!(await appConfirm(`把「${section}」的这条自建变体追加到实验「${customVariantsSelId}」的变体列表？\n恢复后可在该实验的变体下拉中选用。`))) return;
  const lr = await window.labAPI.loadVariants(target.path);
  const variants = (lr && lr.ok && lr.variants) ? lr.variants : {};
  const cur = Array.isArray(variants[section]) ? variants[section] : [];
  if (!cur.includes(text)) cur.push(text);
  variants[section] = cur;
  const sr = await window.labAPI.saveVariants(target.path, variants);
  if (!sr.ok) { showToast('error', '恢复失败', sr.error, 5000); return; }
  showToast('success', '已恢复', `已追加到「${section}」变体列表，可在变体下拉选用`);
  if (currentExp && currentExp.id === customVariantsSelId) loadVariantsUI(currentExp);
}

async function exportCustomVariantsOne() {
  if (!customVariantsSelId) { showToast('error', '未选择实验', '请先在列表中选择一个实验'); return; }
  const r = await window.labAPI.exportCustomVariants({ expId: customVariantsSelId });
  if (!r.ok) { showToast('error', '导出失败', r.error, 5000); return; }
  if (r.canceled) return;
  showToast('success', '已导出', `自建变体_${customVariantsSelId}.json`);
}

async function exportAllCustomVariants() {
  const r = await window.labAPI.exportCustomVariants({ exportAll: true });
  if (!r.ok) { showToast('error', '导出失败', r.error, 5000); return; }
  if (r.canceled) return;
  if (r.errors && r.errors.length) showToast('warning', '部分导出失败', r.errors.join('；'), 6000);
  else showToast('success', '已导出', `共导出 ${r.count} 个实验的自建变体`);
}

async function importCustomVariantsFiles() {
  const r = await window.labAPI.importCustomVariants();
  if (!r.ok) { showToast('error', '导入失败', r.error, 5000); return; }
  if (!r.imported.length && !r.errors.length) return;   // 取消选择
  if (r.imported.length) showToast('success', '已导入', r.imported.join('、'));
  if (r.errors.length) showToast('warning', '导入完成（部分失败）', r.errors.join('；'), 6000);
  await refreshAfterCustomVariantChange();
}

async function runAiPolish(onlyScopeVal) {
  if (isAiPolishing || isSwitchingExperiment) return;
  aiPolishCancelled = false;   // 本轮润色未被取消
  aiPolishRequestIds.clear();
  aiFlightOrder.clear();
  aiFollowedRequestId = null;
  aiThinkingChars = 0;
  const thinkBar = $('aiThinkingBar');
  if (thinkBar) thinkBar.style.display = 'none';
  const thinkTxt = $('aiThinkingText');
  if (thinkTxt) thinkTxt.textContent = '';
  // 公式不可变校验（局部函数，随函数体被测试提取段完整包含）：
  // 原文公式保护制——AI 不得删/改原文已有的公式；写法差异（\%→%、\left(→( 等）
  // 归一化后视为等价并回填为原文写法；AI 新增的 $ 包裹保留。拒绝时返回诊断信息。
  const extractFormulas = (text) => String(text || '').match(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g) || [];
  const normF = (f) => f.replace(/\s+/g, '')
    .replace(/\\%/g, '%')
    .replace(/\\left\(/g, '(').replace(/\\right\)/g, ')')
    .replace(/\\left\[/g, '[').replace(/\\right\]/g, ']')
    .replace(/\\left\{/g, '{').replace(/\\right\}/g, '}')
    .replace(/\\(?:d|t|c)frac/g, '\\frac')
    .replace(/\\cdot/g, '*').replace(/\\times/g, '*')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1').replace(/\\text\{([^}]*)\}/g, '$1');
  const restoreFormulas = (original, polished) => {
    const aRaw = extractFormulas(original);
    const a = aRaw.map(normF);
    if (!a.length) return { ok: true, content: String(polished || '') };   // 原文无公式：AI 新增 $ 包裹不拦截
    const bRaw = extractFormulas(polished);
    const b = bRaw.map(normF);
    const used = new Set();
    const matchIdx = new Map();   // b 下标 -> a 下标
    const missing = [];
    for (let j = 0; j < a.length; j++) {
      let found = false;
      for (let i = 0; i < b.length; i++) {
        if (!used.has(i) && b[i] === a[j]) { used.add(i); matchIdx.set(i, j); found = true; break; }
      }
      if (!found) missing.push(aRaw[j]);   // 原文公式在 AI 输出中找不到（被删或写法差异过大）
    }
    if (missing.length) {
      return { ok: false, missing, aiFormulas: bRaw };   // 诊断：具体哪条原文公式缺失
    }
    if (!bRaw.length) return { ok: true, content: String(polished || '') };
    // 回填：AI 输出中匹配到的公式替换回原文写法（定界形式与内容以原文为准）；新增的保留
    let out = String(polished || '');
    for (let i = 0; i < bRaw.length; i++) {
      if (matchIdx.has(i)) out = out.split(bRaw[i]).join(aRaw[matchIdx.get(i)]);
    }
    return { ok: true, content: out };
  };
  // 思考题题目不可变校验：原文每个题目片段（题号+题首）必须出现在结果中（空白差异放行）
  const quizTopicsUnchanged = (original, polished) => {
    const topics = (String(original || '').match(/\d+\.\s*[^\n。]{4,60}/g) || []).map(s => s.replace(/\s+/g, ''));
    if (!topics.length) return true;
    const p = String(polished || '').replace(/\s+/g, '');
    return topics.every(t => p.includes(t));
  };
  if (!currentExp || !currentExp.reportFile) {
    showToast('warning', '请先生成报告', '需要先生成报告才能进行 AI 润色');
    return;
  }

  const settings = loadSettings();
  if (!settings.hasApiKey) {
    showToast('warning', '未配置 API Key', '请在设置中配置 API Key 后再使用');
    return;
  }
  const srcExpId = currentExp.id;   // 记录润色来源实验，防跨实验导入
  const sourceExp = { ...currentExp };
  const sourceSections = { ...(currentSections || {}) };

  const style = document.querySelector('input[name="aiStyle"]:checked')?.value || 'rigorous';
  // 重新润色（repolish 传入失败项的 scopeVal，单个或数组）：不依赖当前勾选，只重跑这些对象
  const retryList = Array.isArray(onlyScopeVal) ? onlyScopeVal.filter(v => typeof v === 'string' && v)
    : (typeof onlyScopeVal === 'string' && onlyScopeVal ? [onlyScopeVal] : null);
  const retrying = !!retryList;
  let scopeVals = [...document.querySelectorAll('#aiScopeGroup input[type="checkbox"]:checked')].map(i => i.value);
  if (retrying) scopeVals = retryList.slice();
  if (!scopeVals.length) {
    showToast('warning', '未选择润色对象', '请至少勾选一个章节或范围');
    return;
  }
  isAiPolishing = true;
  try {
  // 启用技能由「设置 → AI 润色技能」的开关决定（skillStates）；面板只读展示，不再逐次勾选
  const skillStates = (loadSettings().skillStates && typeof loadSettings().skillStates === 'object') ? loadSettings().skillStates : {};
  const skillIds = (skillsCache || []).filter(sk => skillStates[sk.id] !== false).map(sk => sk.id);
  const kbOnly = $('chkKbOnly').checked;

  // 知识库与技能指令：本轮所有润色对象共用
  let ragText = '';
  if (kbOnly) {
    try {
      const rr = await window.labAPI.readRag(sourceExp.path);
      if (rr && rr.ok && rr.text) ragText = rr.text;
    } catch (e) { /* 读取失败时降级为软约束 */ }
  }
  const kbBlock = kbOnly
    ? `\n\n【知识库硬性约束——本实验教材原理是唯一权威依据】\n${ragText ? ragText.slice(0, 8000) : '（本实验未提供知识库文本）'}\n只能使用知识库与原文中有依据的表述：不得新增两者中不存在的公式、数据、常数或结论，不得凭常识臆造。${ragText ? '' : '当前无知识库：只做语言层面的改写，禁止补充任何物理内容。'}`
    : '';
  const skillBlock = skillIds
    .map(id => skillsCache.find(s => s.id === id))
    .filter(Boolean)
    .map(s => `\n【技能·${s.name}（优先遵循）】${(s.content || '').slice(0, 2000)}`)
    .join('');
  const formatBlock = '\n\n【输出格式硬性要求】只输出改写后的正文（Markdown）：任何数学表达（含 \\pi、\\Delta 等符号和上下标）一律用 $...$ 包裹，独立公式用单行 $$...$$（定界符与公式同一行）；不得输出裸的 \\frac、^、_ 等未包裹的 LaTeX；不得改变任何数值、单位与变量符号；【公式不可修改·最高优先级】原文中的每一个 $...$ 或 $$...$$ 公式必须逐字原样保留（含变量名、上下标、运算符与整体结构），公式只能出现在不可修改区，只能改写公式之外的文字；【公式数量与定界形式必须与原文一致】不得新增 $...$ 包裹（包括给数字、单位、百分比等原文未包裹的内容加 $），不得拆分或合并公式，不得将公式改写为纯文本；不要输出章节编号标题（如"一、"），不要输出任何解释。';

  // 显示加载状态：整轮润色隐藏结果卡；重新润色保留结果卡——已成功的润色文本继续可见，
  // 仅把被重新润色的块变暗并标「润色中…」，加载卡只展示这些对象的进度/思考
  $('btnAiPolish').disabled = true;
  const scopeLabel = (v) => v.startsWith('sec:') ? v.slice(4) : (v === 'quiz' ? '思考题' : '结果分析');
  if (retrying) {
    $('aiLoadingCard').style.display = 'block';
    $('aiLoadingText').textContent = scopeVals.length === 1
      ? `AI 正在重新润色「${scopeLabel(scopeVals[0])}」...`
      : `AI 正在重新润色...（0/${scopeVals.length}）`;
    for (const sv of scopeVals) {
      const block = [...($('aiResultsWrap')?.children || [])].find(el => el.dataset && el.dataset.scope === sv);
      if (block) {
        block.classList.add('ai-repolishing');
        const t = block.querySelector('.ai-result-title');
        if (t) t.textContent += '（润色中…）';
        [...block.querySelectorAll('button')].forEach(b => { b.disabled = true; });
      }
    }
  } else {
    $('aiResultCard').style.display = 'none';
    $('aiLoadingCard').style.display = 'block';
  }

  // "结果分析/思考题"取自 docx 纯文本，只提取一次（全文润色已取消）
  let fullText = '';
  if (scopeVals.some(v => !v.startsWith('sec:'))) {
    try { fullText = await getReportText(sourceExp); } catch (e) { fullText = ''; }
  }

  const results = [];
  try {
    // 两路并发（主进程 ai-chat 的并发上限就是 2）：结果按发起顺序落位，流式预览只跟随最先发起的一路
    if (!retrying) {
      $('aiLoadingText').textContent = scopeVals.length > 1
        ? `AI 正在润色中...（0/${scopeVals.length}，两路并行）`
        : 'AI 正在润色中...';
    }
    const pv = $('aiStreamPreview');
    if (pv) pv.textContent = '';
    const slots = new Array(scopeVals.length).fill(null);
    let nextIdx = 0, doneCount = 0, seq = 0;
    const polishOne = async (scopeVal, prevAttempt) => {
      let rid = null;
      let sectionText = '', displayScope = '', section = null;
      try {
        if (scopeVal.startsWith('sec:')) {
          section = scopeVal.slice(4);
          sectionText = sourceSections[section] || '';
          displayScope = section;
          if (!sectionText) return { section, displayScope, scopeVal, error: '缺少章节源文，请先生成一次报告' };
        } else {
          // 硬编码文本章节（结果分析/思考题）：源文取自已生成报告；是否可导入
          // 由该实验 generate.py 是否有消费点决定（renderAiResults 中判定）
          section = scopeVal === 'quiz' ? '思考题' : '结果分析';
          displayScope = section;
          if (!fullText) return { section, displayScope, scopeVal, error: '无法读取报告内容，请先生成一次报告' };
          sectionText = extractSection(fullText, scopeVal);
        }

        // 失败反馈：把上一次被拒绝的原因交给模型（公式删改→缺失公式清单+上次输出；题目修改→上次输出），
        // 让重试有针对性而不是原样重试。API/网络类失败无内容可反馈。
        let feedback = '';
        if (prevAttempt && prevAttempt.failKind === 'formula' && prevAttempt.failInfo) {
          const missing = (prevAttempt.failInfo.missing || []).join('；');
          feedback = `\n\n【上一次尝试被系统拒绝——原因：删改了原文公式】\n你上一次的输出没有逐字保留原文公式。本次必须让原文的每一个公式逐字出现（定界符形式、上下标花括号、命令拼写与原文完全一致），只改写公式之外的文字。\n必须逐字出现的原文公式：${missing || '（见原文）'}\n你上一次被拒绝的输出（仅作参照，其中与原文不一致的公式必须修正）：\n${String(prevAttempt.failInfo.output || '').slice(0, 6000)}`;
        } else if (prevAttempt && prevAttempt.failKind === 'quiz' && prevAttempt.failInfo) {
          feedback = `\n\n【上一次尝试被系统拒绝——原因：修改了思考题题目】\n题目（含题号）必须逐字保留，只允许改写"答："之后的回答。\n你上一次被拒绝的输出（仅作参照）：\n${String(prevAttempt.failInfo.output || '').slice(0, 6000)}`;
        }

        const messages = [
          {
            role: 'system',
            content: `你是一个大学物理实验报告润色助手。${getAiStylePrompt(style)}${skillBlock}请对用户提供的实验报告内容进行个性化改写，保持科学准确性和数据真实性，避免与原文措辞重复，使报告更具个人特色，降低重复检测风险。只输出改写后的内容，不要输出解释或说明。${formatBlock}${kbBlock}${scopeVal === 'quiz' ? '\n\n【思考题润色规则·最高优先级】题目（含题号，如"1. …"）是固定内容：必须逐字保留在输出中，严禁修改、删除或新增任何题目；只改写"答："之后的回答内容。输出格式：每问一行题目（与原文逐字一致）+ 下一行改写后的回答，按题号顺序排列。' : ''}`,
          },
          {
            role: 'user',
            content: `请润色以下实验报告的「${displayScope}」部分：\n\n${sectionText.slice(0, 6000)}${feedback}`,
          },
        ];

        if (aiPolishCancelled) return null;   // 用户已取消：不再发起新的请求
        // requestId 仅用于主进程定向中止当前请求；vm/旧环境无 crypto 时用时间戳+序号兜底
        rid = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('r' + (seq++) + '-' + Date.now().toString(36));
        aiPolishRequestIds.add(rid);
        aiFlightOrder.set(rid, seq++);
        if (aiFollowedRequestId === null) aiFollowedRequestId = rid;
        const result = await window.labAPI.aiChat({
          provider: settings.provider || 'deepseek',
          apiUrl: settings.apiUrl,
          model: settings.model,
          messages,
          temperature: 0.8,
          requestId: rid,
        });
        if (aiPolishCancelled) return null;   // 取消后丢弃当前项结果
        if (result.ok) {
          // 公式强约束：AI 输出中的公式一律替换回原文公式（文字保留 AI 改写）；
          // 仅当原文公式被 AI 删除/改写时拒绝，并给出诊断（具体缺失的公式与 AI 输出公式）
          const restored = restoreFormulas(sectionText, result.content || '');
          if (!restored.ok) {
            const miss = (restored.missing || []).slice(0, 3).join('；');
            const aiF = (restored.aiFormulas || []).slice(0, 3).join('、');
            return { section, displayScope, scopeVal, failKind: 'formula',
              failInfo: { missing: restored.missing || [], output: result.content || '' },
              error: `AI 删改了公式：原文公式「${miss}」未在输出中找到。AI 输出中的公式：${aiF || '（无）'}（若只是写法差异请重试）` };
          }
          const content = restored.content;
          // 思考题强约束：题目（含题号）必须逐字保留，只允许改写回答
          if (section === '思考题' && !quizTopicsUnchanged(sectionText, content)) {
            return { section, displayScope, scopeVal, failKind: 'quiz',
              failInfo: { output: result.content || '' },
              error: 'AI 修改了思考题题目，已拒绝该结果（题目必须原样保留，可重试）' };
          }
          return { section, displayScope, scopeVal, original: sectionText, polished: content };
        } else if (result.cancelled) return null;
        else return { section, displayScope, scopeVal, failKind: 'api', error: result.error || '润色失败' };
      } catch (err) {
        if (aiPolishCancelled) return null;
        return { section, displayScope, scopeVal, failKind: 'api', error: err.message };
      } finally {
        if (rid) {
          aiPolishRequestIds.delete(rid);
          aiFlightOrder.delete(rid);
          if (aiFollowedRequestId === rid) {
            const rest = Array.from(aiFlightOrder.entries()).sort((a, b) => a[1] - b[1]);
            aiFollowedRequestId = rest.length ? rest[0][0] : null;   // 跟随转移到下一个在飞项
          }
        }
      }
    };
    // 重新润色时取上一轮同名对象的失败信息，作为本次请求的反馈上下文（failKind/failInfo）
    const prevByScope = {};
    if (retrying && Array.isArray(lastPolishResults)) {
      for (const r of lastPolishResults) {
        if (r && r.scopeVal && retryList.includes(r.scopeVal)) prevByScope[r.scopeVal] = r;
      }
    }
    const worker = async () => {
      while (!aiPolishCancelled) {
        const i = nextIdx++;
        if (i >= scopeVals.length) return;
        slots[i] = await polishOne(scopeVals[i], retrying ? prevByScope[scopeVals[i]] : null);
        doneCount++;
        $('aiLoadingText').textContent = (retrying ? 'AI 正在重新润色...' : 'AI 正在润色中...')
          + `（已完成 ${doneCount}/${scopeVals.length}）`;
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, scopeVals.length) }, () => worker()));
    for (const r of slots) if (r) results.push(r);

    results.forEach(r => { r.expId = srcExpId; });   // 绑定来源实验，导入时校验
    // 重新润色：重跑结果按 scopeVal 合并回上一轮（其余对象保留原结果与顺序）
    let finalResults = results;
    if (retrying && Array.isArray(lastPolishResults) && lastPolishResults.length) {
      const sameItem = (a, b) => a.expId === b.expId && a.scopeVal === b.scopeVal;
      finalResults = lastPolishResults.map(r => results.find(x => sameItem(x, r)) || r);
      for (const x of results) if (!finalResults.some(r => sameItem(r, x))) finalResults.push(x);
    }
    lastPolishResults = finalResults;
    renderAiResults();
    const counted = retrying ? results : finalResults;   // 重新润色时只统计本轮重跑的对象
    const okCount = counted.filter(r => r.polished).length;
    if (aiPolishCancelled) {
      showToast('info', '已取消', okCount ? `润色已中止，保留已完成 ${okCount} 项结果` : '润色已中止');
    } else if (okCount) {
      showToast('success', '润色完成', `${okCount}/${results.length} 个对象完成，可导入章节支持一键重新生成`);
    } else {
      showToast('error', '润色失败', (results[0] && results[0].error) || '全部失败', 5000);
    }
  } catch (err) {
    showToast('error', '润色异常', err.message, 5000);
  } finally {
    $('aiLoadingCard').style.display = 'none';
    $('aiLoadingText').textContent = 'AI 正在润色中...';
    $('btnAiPolish').disabled = false;
    aiPolishRequestIds.clear();
    aiFlightOrder.clear();
    aiFollowedRequestId = null;
    aiThinkingChars = 0;
    const thinkBar = $('aiThinkingBar');
    if (thinkBar) thinkBar.style.display = 'none';
    const pv = $('aiStreamPreview');
    if (pv) pv.textContent = '';
    if (retrying) renderAiResults();   // 异常退出时也要撤掉「润色中…」标记；正常路径重复渲染无副作用
  }
  } finally {
    isAiPolishing = false;
    updateAiStatus();
  }
}

// 思考题导入：按题号拆分 AI 结果 → 追加为该实验思考题回答变体（自动参与生成时的随机组合）
async function importQuizAnswers(exp, polished) {
  try {
    const parts = String(polished || '').split(/\n(?=\d+\.\s)/);
    const lr = await window.labAPI.loadVariants(exp.path);
    const variants = (lr && lr.ok && lr.variants && typeof lr.variants === 'object') ? lr.variants : {};
    const quiz = (variants['思考题'] && typeof variants['思考题'] === 'object') ? variants['思考题'] : {};
    let added = 0;
    for (const part of parts) {
      const m = part.match(/^(\d+)\.\s*(.*)/s);
      if (!m) continue;
      const qno = m[1];
      // 段内第一行为题目行（prompt 要求题目逐字保留并单独一行），其余为改写后的回答
      const answer = part.split('\n').slice(1).join('\n').trim();
      if (!answer) continue;
      if (!Array.isArray(quiz[qno])) quiz[qno] = [];
      if (quiz[qno].includes(answer)) continue;   // 与已有变体重复则跳过
      quiz[qno].push(answer);
      added++;
    }
    if (!added) {
      showToast('warning', '未导入', '未能从润色结果中拆分出回答（需要"题目行+回答行"格式）');
      return;
    }
    variants['思考题'] = quiz;
    const sr = await window.labAPI.saveVariants(exp.path, variants);
    if (!sr.ok) { showToast('error', '导入失败', sr.error, 5000); return; }
    showToast('success', '已追加变体', `已为 ${added} 道思考题追加新回答变体，下次生成自动随机`);
    if (currentExp && currentExp.id === exp.id) await loadVariantsUI(exp);
  } catch (e) {
    showToast('error', '导入异常', e.message, 5000);
  }
}

// 重新润色入口：失败结果卡片上的单个按钮，或失败项汇总条上的批量按钮。
// 走 runAiPolish(scopeVals) 复用整条管线（两路并发队列），只重跑这些对象；其余结果保留上一轮。
// 实验已切换时拒绝，避免把 A 实验的源文润给 B。
function repolish(scopeVals) {
  const list = (Array.isArray(scopeVals) ? scopeVals : [scopeVals]).filter(Boolean);
  if (!list.length) return;
  if (isAiPolishing) { showToast('info', '润色进行中', '请等当前润色结束后再重新润色'); return; }
  const src = lastPolishResults.find(r => r.scopeVal === list[0]);
  if (!currentExp || (src && src.expId !== currentExp.id)) {
    showToast('warning', '实验已切换', '请先在列表切回原实验，再重新润色');
    return;
  }
  runAiPolish(list);
}

// 渲染多对象润色结果（每项：原文/润色后对比 + 复制 + 可导入章节的导入按钮）
async function renderAiResults() {
  const wrap = $('aiResultsWrap');
  if (!wrap) return;
  // 变体章节必然可导入；硬编码文本章节（结果分析/思考题等）由该实验 generate.py 消费点决定
  const VARIANT_SECTIONS = ['实验原理', '实验方法', '误差分析', '结论', '实验结论'];
  for (const r of lastPolishResults) {
    if (r.section && !VARIANT_SECTIONS.includes(r.section) && r._importable === undefined) {
      const exp = experiments.find(e => e.id === r.expId);
      if (!exp) { r._importable = false; continue; }
      const ir = await window.labAPI.sectionImportable(exp.path, r.section);
      r._importable = !!(ir && ir.ok && ir.importable);
    }
  }
  wrap.innerHTML = '';
  // 失败项汇总条：≥2 项失败时提供批量重新润色（走同一队列，两路并行）
  const failedItems = lastPolishResults.filter(r => r.error && r.scopeVal);
  if (failedItems.length >= 2) {
    const bar = document.createElement('div');
    bar.className = 'ai-retry-bar';
    const label = document.createElement('span');
    label.textContent = `${failedItems.length} 项失败`;
    const batchBtn = document.createElement('button');
    batchBtn.type = 'button';
    batchBtn.className = 'btn btn-sm btn-outline';
    batchBtn.textContent = '重新润色失败项';
    batchBtn.onclick = () => repolish(failedItems.map(r => r.scopeVal));
    bar.appendChild(label);
    bar.appendChild(batchBtn);
    wrap.appendChild(bar);
  }
  let importable = 0;
  for (const r of lastPolishResults) {
    const block = document.createElement('div');
    block.className = 'ai-result-block';
    if (r.scopeVal) block.dataset.scope = r.scopeVal;   // 重新润色时据此定位对应块

    const head = document.createElement('div');
    head.className = 'ai-result-head';
    const title = document.createElement('span');
    title.className = 'ai-result-title';
    const canImport = r.section && (VARIANT_SECTIONS.includes(r.section) || r._importable);
    title.textContent = r.displayScope + (canImport ? '（可导入）' : '（仅复制）');
    head.appendChild(title);

    if (r.error) {
      const err = document.createElement('span');
      err.className = 'ai-result-error';
      err.textContent = '失败：' + r.error;
      head.appendChild(err);
      // 单项重新润色：只重跑这个失败对象，不重跑整轮（要求当前实验未切换）
      if (r.scopeVal) {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn btn-sm btn-outline';
        retryBtn.textContent = '重新润色';
        retryBtn.onclick = () => repolish([r.scopeVal]);
        head.appendChild(retryBtn);
      }
      block.appendChild(head);
      wrap.appendChild(block);
      continue;
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-sm btn-outline';
    copyBtn.textContent = '复制结果';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(r.polished).then(() => {
        showToast('success', '已复制', r.displayScope + ' 润色结果已复制到剪贴板');
      }).catch(() => {
        showToast('error', '复制失败', '请手动选择复制');
      });
    };
    head.appendChild(copyBtn);

    if (canImport) {
      importable++;
      const impBtn = document.createElement('button');
      impBtn.type = 'button';
      impBtn.className = 'btn btn-sm btn-primary';
      impBtn.textContent = '导入';
      impBtn.onclick = async () => {
        if (!currentExp) return;
        if (r.expId && r.expId !== currentExp.id) {
          showToast('warning', '无法导入', `该结果来自实验「${r.expId}」，请先切回该实验再导入`);
          return;
        }
        if (r.section === '思考题') {
          // 思考题导入=按题号追加回答变体，自动参与生成时的随机组合
          await importQuizAnswers(currentExp, r.polished);
          return;
        }
        setPolishOverride(currentExp.id, r.section, r.polished);
        updateOverrideBar();
        showToast('info', '已导入', `「${r.section}」将在下次生成报告时生效`);
      };
      head.appendChild(impBtn);
    }

    block.appendChild(head);
    const cmp = document.createElement('div');
    cmp.className = 'ai-compare';
    cmp.innerHTML = '<div class="ai-compare-col"><div class="ai-compare-label">原文</div><div class="ai-compare-text"></div></div>'
      + '<div class="ai-compare-col"><div class="ai-compare-label">润色后</div><div class="ai-compare-text ai-polished"></div></div>';
    const texts = cmp.querySelectorAll('.ai-compare-text');
    texts[0].textContent = (r.original || '').slice(0, 3000);
    texts[1].textContent = r.polished;
    block.appendChild(cmp);
    wrap.appendChild(block);
  }
  $('btnImportAi').style.display = importable ? '' : 'none';
  $('aiResultCard').style.display = 'block';
}

function updateAiStatus() {
  const settings = loadSettings();
  const hasKey = !!settings.hasApiKey;
  const hasReport = !!(currentExp && currentExp.reportFile);
  const model = settings.model || getDefaultModel(settings.provider);

  $('aiStatus').textContent = hasKey ? `已配置 · ${model}` : '未配置 API Key';
  $('aiStatus').style.color = hasKey ? 'var(--accent)' : 'var(--warning)';
  $('btnAiPolish').disabled = isAiPolishing || !hasKey || !hasReport;
}

function getDefaultModel(provider) {
  const defaults = {
    deepseek: 'deepseek-v4-pro',
    mimo: 'mimo-v2.5',
    doubao: 'doubao-seed-2-1-pro-260628',
    qwen: 'qwen-plus',
    custom: 'gpt-4o',
  };
  return defaults[provider] || defaults.deepseek;
}

// 常用模型快速选择
const POPULAR_MODELS = {
  deepseek: [
    { name: 'deepseek-v4-pro', desc: '最新旗舰' },
    { name: 'deepseek-v4-flash', desc: '快速版' },
    { name: 'deepseek-chat', desc: '旧版兼容' },
  ],
  mimo: [
    { name: 'mimo-v2.5', desc: '默认' },
    { name: 'mimo-v2.5-pro', desc: '专业版' },
  ],
  custom: [
    { name: 'gpt-4o', desc: 'GPT-4o' },
    { name: 'gpt-4o-mini', desc: '轻量版' },
    { name: 'claude-sonnet-4-20250514', desc: 'Claude' },
  ],
};

// 各平台默认 API URL
const DEFAULT_API_URLS = {
  deepseek: 'https://api.deepseek.com',
  mimo: 'https://api.xiaomimimo.com/v1',
  custom: '',
};

// ── Tab 切换 ──

let previewRequest = 0;
async function loadPreview() {
  const target = currentExp, token = ++previewRequest;
  const wrap = $('previewWrap');
  wrap.textContent = target?.reportFile ? '加载中…' : '生成报告后可在此预览';
  if (!target?.reportFile) return;
  const result = await window.labAPI.readDocxBuffer(target.reportFile);
  if (token !== previewRequest || currentExp?.id !== target.id) return;
  if (!result.ok) { wrap.textContent = '预览失败：' + result.error; return; }
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.title = '报告预览'; frame.src = 'labapp://app/preview.html';
  frame.style.cssText = 'width:100%;height:75vh;border:0;background:white';
  frame.onload = () => {
    if (token !== previewRequest) return;
    frame.contentWindow.postMessage({ type: 'preview', buffer: result.buffer }, '*');
  };
  const receive = async event => {
    if (event.source !== frame.contentWindow || event.data?.type !== 'preview-result') return;
    window.removeEventListener('message', receive);
    if (token !== previewRequest || currentExp?.id !== target.id) return;
    if (!event.data.ok) {
      const fallback = await window.labAPI.docxToHtml(target.reportFile);
      if (token !== previewRequest || currentExp?.id !== target.id) return;
      frame.removeAttribute('src'); frame.sandbox = '';
      frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">' +
        (fallback.ok ? fallback.html : '<p>无法预览，请在 Word 中打开报告。</p>');
    }
    previewLoaded = true;
  };
  window.addEventListener('message', receive);
  setTimeout(() => window.removeEventListener('message', receive), 60000);
  wrap.replaceChildren(frame);
}

// ── 图表预览 ──
async function populateChartFields() {
  const xSel = $('chartXField');
  const ySel = $('chartYField');
  if (!xSel || !ySel) return;
  // 切换实验后清空旧图表预览（chartPreviewUrl 已被 selectExperiment 置 null）
  if (!chartPreviewUrl) {
    $('chartPreviewImage').style.display = 'none';
    $('chartLoading').style.display = 'none';
    $('chartPreviewEmpty').style.display = 'flex';
  }
  xSel.innerHTML = '<option value="">— 选择字段 —</option>';
  ySel.innerHTML = '<option value="">— 选择字段 —</option>';
  if (!currentSchema) return;
  // 收集所有 array 字段，按 schema 分组
  const groupArrays = [];
  for (const group of (currentSchema.groups || [])) {
    const arrs = group.fields.filter(f => f.type === 'array');
    for (const fld of arrs) {
      const label = fld.label || fld.key;
      const optX = document.createElement('option');
      optX.value = fld.key; optX.textContent = label;
      xSel.appendChild(optX);
      const optY = document.createElement('option');
      optY.value = fld.key; optY.textContent = label;
      ySel.appendChild(optY);
    }
    if (arrs.length >= 2) groupArrays.push(arrs);
  }
  // 默认选中：优先取同一 group 内前两字段
  if (groupArrays.length > 0) {
    const pair = groupArrays[0];
    xSel.value = pair[0].key;
    ySel.value = pair[1].key;
  } else if (xSel.options.length > 1) {
    xSel.selectedIndex = 1;
    if (ySel.options.length > 2) ySel.selectedIndex = 2;
  }
  // 恢复上次保存的图表配置
  if (!currentExp) return;
  try {
    const r = await window.labAPI.readChartConfig(currentExp.path);
    if (r.ok && r.config) {
      if (r.config.xField) xSel.value = r.config.xField;
      if (r.config.yField) ySel.value = r.config.yField;
      if (r.config.chartType) $('chartType').value = r.config.chartType;
      if (r.config.title !== undefined) $('chartTitle').value = r.config.title;
      if (r.config.xlabel !== undefined) $('chartXLabel').value = r.config.xlabel;
      if (r.config.ylabel !== undefined) $('chartYLabel').value = r.config.ylabel;
      if (r.config.insertSection) $('chartInsertSection').value = r.config.insertSection;
      if (r.config.imageWidth) $('chartImageWidth').value = r.config.imageWidth;
    }
  } catch (e) { /* 配置读取失败忽略 */ }
}
async function generateChartPreview() {
  const exp = currentExp;
  if (!exp) return;
  const xField = $('chartXField').value;
  const yField = $('chartYField').value;
  if (!xField || !yField) { showToast('warning', '请选择 X 和 Y 轴字段'); return; }
  // 检查长度是否匹配
  const xData = currentData && currentData[xField];
  const yData = currentData && currentData[yField];
  if (Array.isArray(xData) && Array.isArray(yData) && xData.length !== yData.length) {
    showToast('warning', `字段长度不匹配: ${xField}(${xData.length}) vs ${yField}(${yData.length})，请选择同组字段`);
    return;
  }
  const chartType = $('chartType').value;
  const title = $('chartTitle').value;
  const xlabel = $('chartXLabel').value;
  const ylabel = $('chartYLabel').value;
  $('chartPreviewEmpty').style.display = 'none';
  $('chartPreviewImage').style.display = 'none';
  $('chartLoading').style.display = 'flex';
  try {
    const result = await window.labAPI.chartPreview({
      expPath: exp.path,
      xField,
      yField,
      chartType,
      title,
      xlabel,
      ylabel,
    });
    if (!result.ok) throw new Error(result.error || '生成失败');
    $('chartLoading').style.display = 'none';
    $('chartPreviewImage').style.display = 'flex';
    $('chartImg').src = result.dataUrl;
    chartPreviewUrl = result.dataUrl;
    // 保存图表配置
    window.labAPI.saveChartConfig(exp.path, { xField, yField, chartType, title, xlabel, ylabel, insertSection: $('chartInsertSection').value, imageWidth: parseFloat($('chartImageWidth').value) || 14 });
  } catch (err) {
    $('chartLoading').style.display = 'none';
    $('chartPreviewEmpty').style.display = 'flex';
    $('chartPreviewEmpty').querySelector('p').textContent = '生成失败: ' + err.message;
  }
}

// ── Tab 切换 ──
function switchTab(tabId) {
  document.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + tabId);
  });
  if (tabId === 'chart') populateChartFields();
  if (tabId === 'preview' && !previewLoaded) {
    loadPreview();
  }
}

// ── 空状态统计 ──
function updateEmptyStats() {
  $('statTotal').textContent = experiments.length;
  $('statDone').textContent = experiments.filter(e => e.hasReport).length;
}

// ── 学生信息显示 ──
function updateStudentDisplay() {
  const info = loadStudentInfo();
  $('stuName').textContent = info.name || '未设置';
  $('stuId').textContent = info.id || '未设置';
  $('stuClass').textContent = info.class || '未设置';
  $('stuDate').textContent = info.date || new Date().toLocaleDateString('zh-CN');
}

// ── 事件绑定 ──
function bindEvents() {
  // 主进程请求"保存后退出"：保存当前数据，成功则确认关闭
  if (window.labAPI && window.labAPI.onSaveAndClose) {
    window.labAPI.onSaveAndClose(async () => {
      const saved = await saveExcelData();
      if (saved) {
        if (window.labAPI.confirmClose) window.labAPI.confirmClose();
      } else {
        showToast('error', '保存失败', '未能保存数据，已取消关闭', 5000);
      }
    });
  }

  // 分类导航
  document.querySelectorAll('.cat-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cat-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.cat;
      renderList($('searchInput').value);
    };
  });

  // 搜索
  $('searchInput').addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  // Tab
  document.querySelectorAll('.tab-item').forEach(t => {
    t.onclick = () => switchTab(t.dataset.tab);
  });

  // 打开数据模板
  $('btnOpenData').onclick = openDataFile;
  $('btnOpenData2').onclick = openDataFile;

  // 打开报告
  $('btnOpenReport').onclick = openReportFile;
  $('btnOpenReport2').onclick = openReportFile;

  // 生成报告
  $('btnGenerate').onclick = runGenerate;
  $('btnCancelGenerate').onclick = cancelGenerate;

  // 清空日志
  $('btnClearLog').onclick = () => { $('logContent').textContent = ''; };

  // 学生信息
  $('btnStudentInfo').onclick = () => openModal('studentModal');
  $('btnEditStudent').onclick = () => openModal('studentModal');
  $('btnCloseStudent').onclick = () => closeModal('studentModal');
  $('btnCancelStudent').onclick = () => closeModal('studentModal');
  $('btnSaveStudent').onclick = saveStudent;

  // 设置
  $('btnSettings').onclick = () => { openModal('settingsModal'); loadSettingsForm(); switchSettingsPane('ai'); };
  $('btnNavAi').onclick = () => switchSettingsPane('ai');
  $('btnNavSkills').onclick = () => { switchSettingsPane('skills'); loadSkillList(); };
  $('btnNavCustomVariants').onclick = () => { switchSettingsPane('customvariants'); loadCustomVariantsPane(); };
  $('btnNavReports').onclick = () => { switchSettingsPane('reports'); loadReportsList(); };
  $('btnRefreshReports').onclick = loadReportsList;
  $('btnNavHelp').onclick = () => switchSettingsPane('help');
  $('btnNavDanger').onclick = () => switchSettingsPane('danger');
  $('btnNavUpdate').onclick = () => { switchSettingsPane('update'); loadUpdatePane(); };
  $('btnNavFeedback').onclick = () => switchSettingsPane('feedback');
  $('btnSubmitFeedback').onclick = submitFeedback;
  $('btnNavNotice').onclick = () => switchSettingsPane('notice');
  $('btnNavThanks').onclick = () => { switchSettingsPane('thanks'); loadThanksPane(); };
  $('btnExportDiagnostics').onclick = exportDiagnostics;
  const noticeReminder = document.querySelector('.notice-reminder');
  if (noticeReminder) noticeReminder.onclick = () => { openModal('settingsModal'); switchSettingsPane('notice'); };
  $('btnNavDevelop').onclick = () => { switchSettingsPane('develop'); loadDevelopPane(); loadSecCfgExpList(); };
  $('rdDevMode').onclick = () => setDevMode(true);
  $('rdNormalMode').onclick = () => setDevMode(false);
  $('secCfgExpSel').onchange = () => {
    const exp = experiments.find(e => e.path === $('secCfgExpSel').value);
    if (exp) loadSecCfgForExp(exp);
  };
  $('btnSaveSecCfg').onclick = saveSecCfg;
  $('btnFillDefaultData').onclick = fillDefaultData;
  $('btnCheckUpdate').onclick = checkForUpdate;
  $('btnCheckDataUpdate').onclick = checkDataUpdate;
  $('btnUpdateLater').onclick = () => closeModal('updateModal');
  $('btnCloseUpdateModal').onclick = () => closeModal('updateModal');
  // 通用确认弹窗
  $('btnConfirmOk').onclick = () => settleConfirm(true);
  $('btnConfirmCancel').onclick = () => settleConfirm(false);
  $('btnConfirmClose').onclick = () => settleConfirm(false);
  // 贡献数据弹窗
  $('btnContribute').onclick = openContributeModal;
  $('btnCloseContribute').onclick = () => closeModal('contributeModal');
  $('btnCancelContribute').onclick = () => closeModal('contributeModal');
  $('btnCVTabVariant').onclick = () => switchCVTab('variant');
  $('btnCVTabReport').onclick = () => switchCVTab('report');
  $('btnCVTabVision').onclick = () => switchCVTab('vision');
  bindMaskEditor();
  $('btnCVPickPhotos').onclick = () => $('cvPhotoInput').click();
  $('cvPhotoInput').onchange = (e) => handleCVPhotos(e.target.files);
  $('btnCVPickDocx').onclick = () => $('cvDocxInput').click();
  $('cvDocxInput').onchange = (e) => handleCVDocx(e.target.files);
  $('btnContributeUpload').onclick = doContributeUpload;
  $('btnDangerGo').onclick = startDangerFlow;
  $('btnDangerExit').onclick = exitDangerFlow;
  $('btnDangerProceed').onclick = proceedDangerFlow;
  $('btnDeleteAllReports').onclick = deleteAllReports;
  $('btnCloseSettings').onclick = () => closeModal('settingsModal');
  $('btnCancelSettings').onclick = () => closeModal('settingsModal');
  $('btnSaveSettings').onclick = saveAppSettings;
  $('btnClearApiKey').onclick = async () => {
    const r = await window.labAPI.saveCredential({ key: '' });
    if (!r.ok) { showToast('error', '清除失败', r.error); return; }
    const settings = loadSettings(); settings.hasApiKey = false; saveSettings(settings);
    $('inputApiKey').value = ''; $('inputApiKey').placeholder = '请输入 API Key'; updateAiStatus();
    showToast('success', '已清除', '已删除此应用保存的 API Key');
  };
  $('btnAiConfig').onclick = () => { closeModal('studentModal'); openModal('settingsModal'); loadSettingsForm(); };
  $('selectProvider').onchange = () => {
    renderModelChips();
    autoFillApiUrl();
    // 识图处于"继承"时，地址栏跟着主 API 地址走
    if (typeof refreshVisionInheritedUrl === 'function') refreshVisionInheritedUrl();
  };
  // AI 服务页的两个配置入口（就地展开/收起）
  $('btnOpenApiConfig').onclick = () => toggleAiConfigPanel('api');
  $('btnOpenVisionConfig').onclick = () => toggleAiConfigPanel('vision');
  if ($('inputApiUrl')) $('inputApiUrl').addEventListener('input', () => {
    if (typeof refreshVisionInheritedUrl === 'function') refreshVisionInheritedUrl();
  });

  // 批量生成（预留）
  $('btnBatch').onclick = runBatchGenerate;
  $('btnQueuePanel').onclick = openQueuePanel;
  $('btnSelectAll').onclick = toggleSelectAll;
  $('btnBatchClose').onclick = () => {
    $('batchPanel').style.display = 'none';
    if (currentExp) $('detailPanel').style.display = 'block';
    else $('emptyState').style.display = 'flex';
  };
  // 生成队列控制
  if ($('btnQueuePause')) $('btnQueuePause').onclick = pauseQueue;
  if ($('btnQueueResume')) $('btnQueueResume').onclick = resumeQueue;
  if ($('btnQueueCancelAll')) $('btnQueueCancelAll').onclick = cancelAllQueue;
  if ($('btnQueueClear')) $('btnQueueClear').onclick = clearFinishedQueue;
  const _ql = $('queueList');
  if (_ql) _ql.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === 'up') moveQueueItem(id, -1);
    else if (act === 'down') moveQueueItem(id, 1);
    else if (act === 'cancel') cancelQueueItem(id);
    else if (act === 'remove') removeQueueItem(id);
  });

  // 监听运行日志
  window.labAPI.onGenerateLog((data) => {
    if ($('logContent').textContent === '等待生成...') {
      $('logContent').textContent = '';
    }
    $('logContent').textContent = ($('logContent').textContent + data).slice(-128 * 1024);
    $('logContent').scrollTop = $('logContent').scrollHeight;
  });

  // 点击遮罩关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    };
  });

  // 窗口控制
  $('btnMinimize').onclick = () => window.labAPI.minimize();
  $('btnMaximize').onclick = () => window.labAPI.toggleMaximize();
  $('btnClose').onclick = () => window.labAPI.close();

  // 数据录入
  $('btnSaveData').onclick = saveExcelData;
  $('btnClearFormData').onclick = clearFormData;

  // 报告预览
  $('btnRefreshPreview').onclick = () => { previewLoaded = false; loadPreview(); };
  $('btnOpenReportPreview').onclick = openReportFile;

  // AI 润色
  $('btnAiPolish').onclick = runAiPolish;
  $('btnCancelAiPolish').onclick = () => {
    // 润色进行中点击：中止全部在飞请求，剩余对象不再发起
    aiPolishCancelled = true;
    for (const id of [...aiPolishRequestIds]) window.labAPI.aiChatCancel(id);
    $('aiLoadingText').textContent = '正在取消...';
    showToast('info', '正在取消', '已发送中止请求，完成后保留已完成的润色结果');
  };
  // AI 润色流式增量：kind=reasoning 是推理模型的思考内容（驱动「模型思考中」状态条），
  // content 是正文。两路并发时预览与思考文本只跟随最先发起的一路，思考字数两路合计。
  window.labAPI.onAiChunk(({ requestId, delta, kind }) => {
    if (!aiPolishRequestIds.has(requestId)) return;
    if (kind === 'reasoning') {
      aiThinkingChars += delta.length;
      const bar = $('aiThinkingBar');
      if (bar) {
        bar.style.display = 'block';
        const stat = $('aiThinkingStat');
        if (stat) stat.textContent = `模型思考中… 已思考 ${aiThinkingChars} 字`;
      }
      if (requestId !== aiFollowedRequestId) return;
      const txt = $('aiThinkingText');
      if (txt) { txt.textContent += delta; txt.scrollTop = txt.scrollHeight; }
      return;
    }
    if (requestId !== aiFollowedRequestId) return;
    const bar = $('aiThinkingBar');
    if (bar) bar.style.display = 'none';   // 本路正文已开始：思考阶段结束
    const el = $('aiStreamPreview');
    if (el) el.textContent += delta;
  });
  $('btnAiConfig').onclick = () => openModal('settingsModal');
  $('btnImportAi').onclick = importPolishAndRegenerate;
  $('btnClearOverrides').onclick = () => {
    if (!currentExp) return;
    clearPolishOverrides(currentExp.id);
    updateOverrideBar();
    showToast('info', '已清除', '导入的润色文本已移除，下次生成恢复变体库文本');
  };
  $('chkKbOnly').onchange = () => {
    const s = loadSettings();
    s.kbOnly = $('chkKbOnly').checked;
    saveSettings(s);
  };
  $('btnImportSkill').onclick = importSkillFiles;
  $('btnOpenSkillsFolder').onclick = () => window.labAPI.openSkillsFolder();
  $('btnGetSkill').onclick = openGetSkillModal;
  $('btnCloseGetSkill').onclick = closeGetSkillModal;
  $('btnCancelGetSkill').onclick = closeGetSkillModal;
  $('btnCopySkillLink').onclick = copySkillLink;
  $('btnOpenSkillLink').onclick = openSkillLink;
  // 数据表单输入导航（事件委托：表单渲染重建无需重绑）
  $('dataTableWrap').addEventListener('keydown', handleFormKeyNav);
  $('btnExportCustomVariant').onclick = exportCustomVariantsOne;
  $('btnExportAllCustomVariants').onclick = exportAllCustomVariants;
  $('btnImportCustomVariants').onclick = importCustomVariantsFiles;
  // 润色面板初始状态（实验相关部分由 selectExperiment 刷新）
  $('chkKbOnly').checked = loadSettings().kbOnly !== false;
  loadSkillList();
  refreshAiScopeOptions(false);
  // 图表
  $('btnChartGenerate').onclick = generateChartPreview;
  $('btnChartRefresh').onclick = () => { populateChartFields(); generateChartPreview(); };
}

function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }

// ── 通用确认弹窗（Promise 化）：替代 window.confirm——原生对话框在 Windows 上会破坏
// 窗口焦点状态，导致后续原生 select 下拉不弹出、键盘输入失效 ──
let pendingConfirmResolve = null;
function appConfirm(msg, opts = {}) {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = opts.title || '确认操作';
    $('confirmMsg').textContent = msg;
    const okBtn = $('btnConfirmOk');
    okBtn.textContent = opts.okText || '确定';
    okBtn.classList.toggle('btn-danger', !!opts.danger);
    okBtn.classList.toggle('btn-primary', !opts.danger);
    pendingConfirmResolve = resolve;
    openModal('confirmModal');
  });
}
function settleConfirm(result) {
  if (pendingConfirmResolve) {
    const r = pendingConfirmResolve;
    pendingConfirmResolve = null;
    r(result);
  }
  closeModal('confirmModal');
}

// ── 获取 skill 弹窗：展示可复制的网盘分享链接 ──
function openGetSkillModal() {
  $('skillPanLink').value = SKILL_PAN_URL;
  $('skillPanCode').textContent = SKILL_PAN_CODE;
  const btn = $('btnCopySkillLink');
  btn.textContent = '复制链接';
  btn.disabled = false;
  openModal('getSkillModal');
}

function closeGetSkillModal() { closeModal('getSkillModal'); }

function copySkillLink() {
  const btn = $('btnCopySkillLink');
  const done = () => {
    btn.textContent = '已复制';
    showToast('success', '已复制', '网盘链接已复制到剪贴板');
    setTimeout(() => { if (btn.textContent === '已复制') btn.textContent = '复制链接'; }, 2000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(SKILL_PAN_URL).then(done).catch(() => legacyCopySkillLink(done));
  } else {
    legacyCopySkillLink(done);
  }
}

function legacyCopySkillLink(done) {
  const inp = $('skillPanLink');
  inp.focus();
  inp.select();
  try {
    if (document.execCommand('copy')) { done(); return; }
  } catch (e) { /* 忽略 */ }
  showToast('error', '复制失败', '请手动全选链接复制');
}

async function openSkillLink() {
  const r = await window.labAPI.openExternal(SKILL_PAN_URL);
  if (!(r && r.ok)) showToast('error', '无法打开链接', (r && r.error) || '未知错误', 5000);
}

async function openDataFile() {
  if (currentExp && currentExp.dataFile) {
    const r = await window.labAPI.openDataFile(currentExp.path);
    if (!r.ok) showToast('error', '无法打开文件', '数据文件不存在或已被移动', 5000);
  }
}

async function openReportFile() {
  if (currentExp && currentExp.reportFile) {
    const r = await window.labAPI.openFile(currentExp.reportFile);
    if (!r.ok) showToast('error', '无法打开文件', '报告文件不存在或已被移动', 5000);
  }
}

// ── 保存学生信息 ──
function saveStudent() {
  const info = {
    name: $('inputName').value.trim(),
    id: $('inputId').value.trim(),
    class: $('inputClass').value.trim(),
    date: new Date().toLocaleDateString('zh-CN'),
  };
  saveStudentInfo(info);
  updateStudentDisplay();
  closeModal('studentModal');
  showToast('success', '已保存', '学生信息已更新');
}

// AI 服务页：两个配置面板就地展开/收起（同一时刻只展开一组，进入页面时都收起）
function toggleAiConfigPanel(which) {
  const api = $('panelApiConfig'), vision = $('panelVisionConfig');
  if (!api || !vision) return;
  const showApi = which === 'api' ? api.hidden : false;
  const showVision = which === 'vision' ? vision.hidden : false;
  api.hidden = !showApi;
  vision.hidden = !showVision;
  $('btnOpenApiConfig').classList.toggle('active', showApi);
  $('btnOpenVisionConfig').classList.toggle('active', showVision);
  if (showVision && typeof updateVisionFields === 'function') updateVisionFields();
}
function collapseAiConfigPanels() {
  const api = $('panelApiConfig'), vision = $('panelVisionConfig');
  if (api) api.hidden = true;
  if (vision) vision.hidden = true;
  if ($('btnOpenApiConfig')) $('btnOpenApiConfig').classList.remove('active');
  if ($('btnOpenVisionConfig')) $('btnOpenVisionConfig').classList.remove('active');
}

// ── 加载设置表单 ──
// 设置模块导航切换
function switchSettingsPane(name) {
  if (name === 'ai') collapseAiConfigPanels();   // 每次进入 AI 服务页都回到"只有两个按钮"的初始态
  $('btnNavAi').classList.toggle('active', name === 'ai');
  $('paneAi').classList.toggle('active', name === 'ai');
  $('btnNavSkills').classList.toggle('active', name === 'skills');
  $('paneSkills').classList.toggle('active', name === 'skills');
  $('btnNavCustomVariants').classList.toggle('active', name === 'customvariants');
  $('paneCustomVariants').classList.toggle('active', name === 'customvariants');
  $('btnNavReports').classList.toggle('active', name === 'reports');
  $('paneReports').classList.toggle('active', name === 'reports');
  $('btnNavHelp').classList.toggle('active', name === 'help');
  $('paneHelp').classList.toggle('active', name === 'help');
  $('btnNavDanger').classList.toggle('active', name === 'danger');
  $('paneDanger').classList.toggle('active', name === 'danger');
  $('btnNavDevelop').classList.toggle('active', name === 'develop');
  $('paneDevelop').classList.toggle('active', name === 'develop');
  $('btnNavUpdate').classList.toggle('active', name === 'update');
  $('paneUpdate').classList.toggle('active', name === 'update');
  $('btnNavFeedback').classList.toggle('active', name === 'feedback');
  $('paneFeedback').classList.toggle('active', name === 'feedback');
  $('btnNavNotice').classList.toggle('active', name === 'notice');
  $('paneNotice').classList.toggle('active', name === 'notice');
  $('btnNavThanks').classList.toggle('active', name === 'thanks');
  $('paneThanks').classList.toggle('active', name === 'thanks');
}

// ── 感谢声明（名单来自 common/credits.json，可随实验数据更新推送）──
async function loadThanksPane() {
  const el = $('thanksList');
  if (!el) return;
  let r = null;
  try { r = await window.labAPI.readCredits(); } catch (e) { /* 读取失败按空态处理 */ }
  const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
  if (!items.length) {
    el.innerHTML = '<div class="thanks-empty">（致谢名单待同步，可稍后在「检查更新」中获取最新实验数据）</div>';
    return;
  }
  el.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'thanks-row';
    const name = document.createElement('span');
    name.className = 'thanks-name';
    name.textContent = it.name;
    const sep = document.createElement('span');
    sep.className = 'thanks-sep';
    sep.textContent = '——';
    const work = document.createElement('span');
    work.className = 'thanks-work';
    work.textContent = it.contribution;
    row.append(name, sep, work);
    el.appendChild(row);
  }
}

// ── 检查更新（对象存储清单，国内高速）──
const MANIFEST_URL = 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/latest.json';
let updateInfo = null;   // 最近一次检查结果（含下载入口）

function loadUpdatePane() {
  window.labAPI.getAppVersion().then(v => {
    $('inputCurrentVersion').textContent = 'v' + v;
  }).catch(() => { $('inputCurrentVersion').textContent = '未知'; });
  loadDataInfo();
}

// ── 实验数据热更新 ──
async function loadDataInfo() {
  const el = $('dataVersionText');
  if (!el) return;
  try {
    const r = await window.labAPI.getDataInfo();
    if (r.ok) {
      el.textContent = r.localVersion || r.builtinVersion || '1.0.0';
    } else {
      el.textContent = '未知';
    }
  } catch (e) { el.textContent = '未知'; }
}

async function checkDataUpdate() {
  const btn = $('btnCheckDataUpdate');
  btn.disabled = true;
  btn.textContent = '检查中…';
  try {
    const r = await window.labAPI.checkDataUpdate();
    if (!r.ok) {
      showToast('error', '检查失败', r.error, 5000);
      return;
    }
    if (r.noRemote) {
      showToast('info', '暂无数据更新', `云端还没有发布数据更新包（当前 v${r.localVersion}）`, 4000);
      return;
    }
    if (!r.hasUpdate) {
      showToast('success', '已是最新', `实验数据已是最新（v${r.localVersion}）`, 3000);
      return;
    }
    const ok = await appConfirm(
      `发现实验数据新版本 v${r.remoteVersion}（当前 v${r.localVersion}）\n\n${r.notes || '（无更新说明）'}\n\n是否立即下载并更新？\n更新不会覆盖您已填写的测量数据。`,
      { okText: '立即更新' }
    );
    if (!ok) {
      showToast('info', '已取消', `新版本 v${r.remoteVersion} 待更新`, 3000);
      return;
    }
    btn.textContent = '下载中…';
    window.labAPI.onDataProgress(({ percent }) => {
      btn.textContent = `下载中 ${percent}%`;
    });
    const dl = await window.labAPI.downloadDataPackage({ url: r.url });
    if (!dl.ok) {
      showToast('error', '下载失败', dl.error, 5000);
      return;
    }
    btn.textContent = '正在应用…';
    const ap = await window.labAPI.applyDataPackage({
      filePath: dl.filePath,
      version: r.remoteVersion,
      notes: r.notes,
    });
    if (!ap.ok) {
      showToast('error', '更新失败', ap.error, 5000);
      return;
    }
    // 更新前的实验名集合（用于识别本次云端新增的实验）
    const oldNames = new Set(experiments.map(e => getDisplayName(e)));
    // 重新扫描实验（热更新后的实验列表与资源入口）
    experiments = await fetchExperiments();
    experiments.forEach(e => { e.category = getCategory(e.name); });
    showScanWarnings(experiments);
    const addedExps = experiments.filter(e => !oldNames.has(getDisplayName(e))).map(getDisplayName);
    updateCategoryCounts();
    renderList();
    updateEmptyStats();
    loadDataInfo();
    loadSecCfgExpList();   // 数据包可能新增了实验，刷新变体管理下拉
    if (ap.warnings && ap.warnings.length) {
      const w = ap.warnings.join('；') + (addedExps.length ? `；本次新增实验：${addedExps.join('、')}` : '');
      showToast('info', '数据更新完成', w, 6000);
    } else if (addedExps.length) {
      showToast('success', '数据更新完成', `实验数据已更新到 v${r.remoteVersion}，本次新增实验：${addedExps.join('、')}`, 6000);
    } else {
      showToast('success', '数据更新完成', `实验数据已更新到 v${r.remoteVersion}`, 4000);
    }
  } catch (err) {
    showToast('error', '检查失败', err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '检查实验数据更新';
  }
}

async function checkForUpdate() {
  const btn = $('btnCheckUpdate');
  btn.disabled = true;
  btn.textContent = '检查中…';
  try {
    const r = await window.labAPI.checkForUpdate({ manifestUrl: MANIFEST_URL });
    if (!r.ok) {
      showToast('error', '检查更新失败', r.error, 5000);
      return;
    }
    updateInfo = r;
    if (r.hasUpdate) {
      openUpdateModal(r);
    } else {
      showToast('success', '检查更新', `目前已是最新版本 v${r.current}`, 4000);
    }
  } catch (err) {
    showToast('error', '检查更新失败', err.message, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '检查更新';
  }
}

// 仅提示新版本：渲染下载入口链接（浏览器打开），不自动下载
function openUpdateModal(r) {
  $('updateModalTitle').textContent = `发现新版本 v${r.latest}`;
  $('updateMeta').textContent = `当前版本 v${r.current} → 最新版本 v${r.latest}`;
  $('updateNotes').textContent = r.notes || '（本次更新未填写说明）';
  const wrap = $('updateDownloadsWrap');
  const downloads = Array.isArray(r.downloads) ? r.downloads : [];
  wrap.innerHTML = downloads.length
    ? '<div class="update-downloads">' + downloads.map(d =>
        `<div class="update-download-link">`
        + `<span><span class="update-download-name">${escapeHtml(d.name)}</span>`
        + (d.hint ? ` <span class="update-download-hint">${escapeHtml(d.hint)}</span>` : '') + `</span>`
        + `<input class="update-share-url" aria-label="网盘分享链接" readonly value="${escapeHtml(d.url)}">`
        + `<button class="btn btn-sm btn-outline cv-copy-link" data-url="${escapeHtml(d.url)}">复制链接</button>`
        + `<button class="btn btn-sm btn-primary cv-open-link" data-url="${escapeHtml(d.url)}">打开网盘</button>`
        + `</div>`
      ).join('') + '</div>'
    : '<div class="form-hint">暂无可用下载链接，请稍后再试</div>';
  wrap.querySelectorAll('.cv-copy-link').forEach(b => {
    b.onclick = async () => {
      const result = await window.labAPI.copyLink(b.dataset.url);
      showToast(result.ok ? 'success' : 'error', result.ok ? '已复制链接' : '复制失败', result.ok ? '网盘分享链接已复制' : result.error);
    };
  });
  wrap.querySelectorAll('.cv-open-link').forEach(b => {
    b.onclick = async () => {
      const res = await window.labAPI.openExternal(b.dataset.url);
      if (!res.ok) showToast('error', '无法打开链接', res.error, 5000);
    };
  });
  openModal('updateModal');
}

// ── 意见反馈（复用贡献上传通道，落盘 COS contributions/feedbacks/，管理应用清单对比审核）──
async function submitFeedback() {
  const text = $('feedbackText').value.trim();
  if (text.length < 5) { showToast('warning', '内容太短', '请填写至少 5 个字的反馈内容'); return; }
  const statusEl = $('feedbackStatus');
  const btn = $('btnSubmitFeedback');
  btn.disabled = true;
  statusEl.textContent = '正在提交…';
  try {
    const ts = cvTs();
    const key = `contributions/feedbacks/${ts}/feedback.json`;
    const payload = {
      kind: 'feedback',
      text,
      ts,
      appVersion: (await window.labAPI.getAppVersion()) || '',
      exp: currentExp ? currentExp.id : '',
    };
    const data = new TextEncoder().encode(JSON.stringify(payload, null, 1));
    const c = await window.labAPI.contributeGetCredentials({ files: [{ key, size: data.byteLength }] });
    if (!c.ok || !Array.isArray(c.items) || !c.items.length) {
      statusEl.textContent = '';
      showToast('error', '提交失败', (c && c.error) || '服务异常', 5000);
      return;
    }
    const r = await window.labAPI.contributeUpload({ putUrl: c.items[0].putUrl, data });
    if (!r.ok) {
      statusEl.textContent = '';
      showToast('error', '提交失败', r.error, 5000);
      return;
    }
    statusEl.textContent = '✓ 已提交，感谢您的反馈！';
    $('feedbackText').value = '';
    showToast('success', '反馈已提交', '感谢您的建议，开发者会定期查看', 4000);
  } catch (err) {
    statusEl.textContent = '';
    showToast('error', '提交异常', err.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

// ── 贡献数据（变体 / 实验报告，COS 直传）──
let cvMode = 'variant';            // variant | report | vision
let cvPhotos = [];                 // [{name, buf, thumb}]
let cvDocx = null;                 // {name, buf}
let cvSelections = [];             // [{section, text}]
let cvVisionSamples = [];          // 本地识图训练样本（listVisionSamples 的结果）
let cvVisionSel = [];              // 勾选的样本 [{exp, ts}]
const cvVisionMasked = new Map();  // 'exp/ts' -> 打码后的图片 dataURL（仅内存，提交用）
const cvVisionStrip = new Map();   // 'exp/ts' -> 是否移除学生信息（默认 true）

function cvTs() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function openContributeModal() {
  if (!currentExp) { showToast('warning', '请先选择实验', '从左侧选择一个实验后再贡献'); return; }
  cvMode = 'variant';
  cvPhotos = [];
  cvDocx = null;
  cvSelections = [];
  $('contributeExpName').textContent = getDisplayName(currentExp);
  $('cvVariantNote').value = '';
  $('cvReportScore').value = '';
  $('cvReportNote').value = '';
  $('cvUploadStatus').textContent = '';
  $('chkContributeAgree').checked = false;
  renderCVPhotos();
  renderCVDocx();
  switchCVTab('variant');
  loadCVVariants();
  loadCVVision();
  openModal('contributeModal');
}

function switchCVTab(mode) {
  cvMode = mode;
  $('btnCVTabVariant').classList.toggle('active', mode === 'variant');
  $('btnCVTabReport').classList.toggle('active', mode === 'report');
  $('btnCVTabVision').classList.toggle('active', mode === 'vision');
  $('cvPaneVariant').style.display = mode === 'variant' ? '' : 'none';
  $('cvPaneReport').style.display = mode === 'report' ? '' : 'none';
  $('cvPaneVision').style.display = mode === 'vision' ? '' : 'none';
}

async function loadCVVariants() {
  const el = $('cvVariantList');
  let data = null;
  try {
    const r = await window.labAPI.readCustomVariants(currentExp.id);
    if (r.ok) data = r.data;
  } catch (e) { /* 读取失败按无变体处理 */ }
  const sections = (data && typeof data === 'object')
    ? CUSTOM_SECTION_ORDER.filter(s => Array.isArray(data[s]) && data[s].length)
    : [];
  if (!sections.length) {
    el.innerHTML = '<div class="skill-empty">该实验暂无自建变体 —— 先在变体卡片中用 AI 生成新变体并勾选「同时存入自建变体库」。</div>';
    return;
  }
  let html = '';
  for (const s of sections) {
    html += `<div class="cv-detail-title"><span>${escapeHtml(s)}</span></div>`;
    data[s].forEach((text, idx) => {
      html += `<label class="cv-variant-check"><input type="checkbox" data-section="${escapeHtml(s)}" data-idx="${idx}" />`
        + `<span class="cv-variant-text">${escapeHtml(String(text).slice(0, 80))}</span></label>`;
    });
  }
  el.innerHTML = html;
  const collect = () => {
    cvSelections = [];
    el.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      const sec = cb.dataset.section;
      const idx = parseInt(cb.dataset.idx, 10);
      if (data[sec] && typeof data[sec][idx] === 'string') {
        cvSelections.push({ section: sec, text: data[sec][idx] });
      }
    });
  };
  el.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.onchange = collect; });
}

// 客户端压缩：最长边 1600px、JPEG 质量 0.8（手机原图压至约 100-300KB）
async function compressImageFile(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { name: file.name, buf, thumb: URL.createObjectURL(blob) };
}

function renderCVPhotos() {
  const grid = $('cvPhotoGrid');
  grid.innerHTML = '';
  cvPhotos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'cv-photo-item';
    div.innerHTML = `<img src="${p.thumb}" alt=""><button class="cv-photo-del" data-i="${i}">×</button>`;
    div.querySelector('.cv-photo-del').onclick = () => {
      cvPhotos.splice(i, 1);
      renderCVPhotos();
    };
    grid.appendChild(div);
  });
}

function renderCVDocx() {
  $('cvDocxRow').textContent = cvDocx ? `${cvDocx.name}（${(cvDocx.buf.length / 1024 / 1024).toFixed(1)}MB）` : '未选择文件';
}

async function handleCVPhotos(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (cvPhotos.length >= 9) { showToast('warning', '最多 9 张', '已忽略超出数量的照片'); break; }
    try {
      cvPhotos.push(await compressImageFile(f));
    } catch (e) {
      showToast('error', '图片处理失败', f.name + ': ' + e.message, 5000);
    }
  }
  $('cvPhotoInput').value = '';
  renderCVPhotos();
}

async function handleCVDocx(fileList) {
  const f = fileList && fileList[0];
  if (!f) return;
  if (f.size > 16 * 1024 * 1024) { showToast('error', '文件过大', 'Word 文档不能超过 16MB'); $('cvDocxInput').value = ''; return; }
  cvDocx = { name: f.name, buf: new Uint8Array(await f.arrayBuffer()) };
  $('cvDocxInput').value = '';
  renderCVDocx();
}

// ── 识图训练样本（贡献 → 识图数据）──
function visionSampleKey(s) { return s.exp + '/' + s.ts; }

// 时间戳 YYYYMMDD_HHMMSS → 2026-09-20 10:30
function fmtVisionTs(ts) {
  const m = String(ts || '').match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(ts || '');
}

async function loadCVVision() {
  const el = $('cvVisionList');
  if (!el) return;
  let samples = [];
  try {
    const r = await window.labAPI.listVisionSamples();
    if (r && r.ok) samples = r.samples || [];
  } catch (e) { /* 读取失败按空处理 */ }
  // 只展示「打开贡献弹窗的这个实验」的识图样本，且只取最新一次（列表已按时间倒序）
  const mine = samples.filter(s => currentExp && s.exp === currentExp.id);
  const s = mine.length ? mine[0] : null;
  cvVisionSamples = s ? [s] : [];
  cvVisionSel = [];
  if (!s) {
    el.innerHTML = '<div class="skill-empty">该实验暂无识图训练样本 —— 使用「识别图片 → 人工核对 → 导入数据」后会自动生成三件套（此处只展示最新一次）。</div>';
    return;
  }
  const key = visionSampleKey(s);
  const stripped = cvVisionStrip.get(key) !== false;
  el.innerHTML = `<div class="cv-vision-item${s.submitted ? ' submitted' : ''}" data-key="${escapeHtml(key)}">
      <label class="cv-vision-head">
        <input type="checkbox" class="cv-vision-pick" ${s.submitted ? 'disabled' : 'checked'} />
        <span class="cv-vision-name">最近一次 · ${escapeHtml(fmtVisionTs(s.ts))}</span>
        ${s.submitted ? '<span class="cv-vision-tag">已提交</span>' : '<span class="cv-vision-tag new">待提交</span>'}
      </label>
      <div class="cv-vision-body">
        <div class="cv-vision-thumb" data-key="${escapeHtml(key)}">
          ${s.photo ? '<span class="cv-vision-thumb-hint">点击预览 / 打码</span>' : '<span class="cv-vision-thumb-hint">无图片</span>'}
        </div>
        <div class="cv-vision-meta">
          <div class="cv-vision-actions">
            <button class="btn btn-sm btn-outline cv-vision-mask" type="button" ${s.photo ? '' : 'disabled'}>隐私打码</button>
            <button class="btn btn-sm btn-ghost cv-vision-json" type="button">查看 AI / 校对数据</button>
          </div>
          <label class="checkbox-label cv-vision-strip">
            <input type="checkbox" class="cv-vision-strip-cb" ${stripped ? 'checked' : ''} ${s.submitted ? 'disabled' : ''} />
            移除学生信息（姓名 / 学号 / 班级）
          </label>
          <div class="cv-vision-json-panel" style="display:none"></div>
        </div>
      </div>
    </div>`;

  el.querySelectorAll('.cv-vision-item').forEach(item => {
    const key = item.dataset.key;
    const pick = item.querySelector('.cv-vision-pick');
    if (pick && !pick.disabled) pick.onchange = () => collectCVVisionSel();
    const strip = item.querySelector('.cv-vision-strip-cb');
    if (strip && !strip.disabled) strip.onchange = () => cvVisionStrip.set(key, strip.checked);
    const maskBtn = item.querySelector('.cv-vision-mask');
    if (maskBtn && !maskBtn.disabled) maskBtn.onclick = () => openMaskEditor(key);
    const jsonBtn = item.querySelector('.cv-vision-json');
    if (jsonBtn) jsonBtn.onclick = () => toggleVisionJson(item, key);
    const thumb = item.querySelector('.cv-vision-thumb');
    if (thumb && item.querySelector('.cv-vision-mask') && !item.querySelector('.cv-vision-mask').disabled) {
      thumb.onclick = () => openMaskEditor(key);
    }
  });
  collectCVVisionSel();   // 单条样本默认勾选：同步选择集，上传无需再点勾选框
}

function collectCVVisionSel() {
  const el = $('cvVisionList');
  cvVisionSel = [];
  if (!el) return;
  el.querySelectorAll('.cv-vision-item').forEach(item => {
    const cb = item.querySelector('.cv-vision-pick');
    if (cb && cb.checked && !cb.disabled) {
      const [exp, ts] = String(item.dataset.key).split('/');
      cvVisionSel.push({ exp, ts });
    }
  });
}

async function toggleVisionJson(item, key) {
  const panel = item.querySelector('.cv-vision-json-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.textContent = '正在读取…';
  panel.style.display = '';
  const [exp, ts] = key.split('/');
  const r = await window.labAPI.readVisionSample({ expId: exp, ts });
  if (!r || !r.ok) { panel.textContent = '读取失败：' + ((r && r.error) || '未知错误'); return; }
  const brief = (obj, title) => {
    const o = JSON.parse(JSON.stringify(obj || {}));
    const student = o.student ? JSON.stringify(o.student) : '（无）';
    const fields = Object.keys(o.fields || {});
    return `<div class="cv-vision-json-col"><div class="cv-vision-json-title">${title}</div>`
      + `<div class="cv-vision-json-line">字段数：${fields.length}</div>`
      + `<div class="cv-vision-json-line">学生信息：<code>${escapeHtml(student.slice(0, 200))}</code></div>`
      + `<pre class="cv-vision-json-pre">${escapeHtml(JSON.stringify(o.fields || {}, null, 1).slice(0, 1200))}</pre></div>`;
  };
  panel.innerHTML = '<div class="cv-vision-json-grid">' + brief(r.aiData, 'AI 识别') + brief(r.proofreadData, '人工校对') + '</div>';
}

// ── 隐私打码编辑器（矩形涂黑，可撤销）──
const maskEdit = { key: null, img: null, rects: [], drawing: null, scale: 1 };

async function openMaskEditor(key) {
  const [exp, ts] = String(key).split('/');
  const r = await window.labAPI.readVisionSample({ expId: exp, ts });
  if (!r || !r.ok || !r.photoDataUrl) { showToast('error', '打码失败', (r && r.error) || '图片读取失败', 5000); return; }
  const img = new Image();
  img.onload = () => {
    maskEdit.key = key;
    maskEdit.img = img;
    maskEdit.rects = [];
    maskEdit.drawing = null;
    // 先把弹窗打开，再按可用宽度给画布定尺寸 —— 画布以 1:1 显示（不再被 CSS 缩小），
    // 打码时看得清、框得准；上限 1400px 兼顾清晰度与上传体积
    openModal('maskModal');
    const body = document.querySelector('#maskModal .modal-body');
    const avail = Math.max(600, (body ? body.clientWidth : 1000) - 28);
    const maxW = Math.min(1400, avail);
    const canvas = $('maskCanvas');
    maskEdit.scale = Math.min(1, maxW / img.width);
    canvas.width = Math.round(img.width * maskEdit.scale);
    canvas.height = Math.round(img.height * maskEdit.scale);
    drawMaskCanvas();
    $('maskHint').textContent = '按住鼠标拖动，框选要涂黑的隐私区域（可多次框选）';
  };
  img.onerror = () => showToast('error', '打码失败', '图片无法加载', 5000);
  img.src = r.photoDataUrl;
}

function drawMaskCanvas() {
  const canvas = $('maskCanvas');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(maskEdit.img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  const all = maskEdit.rects.concat(maskEdit.drawing ? [maskEdit.drawing] : []);
  for (const rc of all) ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
}

function bindMaskEditor() {
  const canvas = $('maskCanvas');
  if (!canvas) return;
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * (canvas.width / rect.width))),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * (canvas.height / rect.height))),
    };
  };
  canvas.onmousedown = (e) => {
    if (!maskEdit.img) return;
    const p = pos(e);
    maskEdit.drawing = { x: p.x, y: p.y, w: 0, h: 0 };
    e.preventDefault();
  };
  canvas.onmousemove = (e) => {
    if (!maskEdit.drawing) return;
    const p = pos(e);
    maskEdit.drawing.w = p.x - maskEdit.drawing.x;
    maskEdit.drawing.h = p.y - maskEdit.drawing.y;
    drawMaskCanvas();
  };
  const finish = () => {
    if (!maskEdit.drawing) return;
    const rc = maskEdit.drawing;
    maskEdit.drawing = null;
    if (Math.abs(rc.w) > 4 && Math.abs(rc.h) > 4) {
      maskEdit.rects.push({
        x: Math.min(rc.x, rc.x + rc.w), y: Math.min(rc.y, rc.y + rc.h),
        w: Math.abs(rc.w), h: Math.abs(rc.h),
      });
    }
    drawMaskCanvas();
  };
  canvas.onmouseup = finish;
  canvas.onmouseleave = finish;
  $('btnMaskUndo').onclick = () => { maskEdit.rects.pop(); drawMaskCanvas(); };
  $('btnMaskClear').onclick = () => { maskEdit.rects = []; drawMaskCanvas(); };
  $('btnMaskCancel').onclick = () => { maskEdit.img = null; closeModal('maskModal'); };
  const closeBtn = $('btnMaskCancel2');
  if (closeBtn) closeBtn.onclick = () => { maskEdit.img = null; closeModal('maskModal'); };
  $('btnMaskDone').onclick = () => {
    if (!maskEdit.img) return;
    const key = maskEdit.key;
    const out = $('maskCanvas').toDataURL('image/jpeg', 0.9);
    cvVisionMasked.set(key, out);
    maskEdit.img = null;
    closeModal('maskModal');
    const item = $('cvVisionList').querySelector(`.cv-vision-item[data-key="${CSS.escape(key)}"]`);
    if (item) {
      const thumb = item.querySelector('.cv-vision-thumb');
      if (thumb) thumb.innerHTML = `<img src="${out}" alt="已打码"><span class="cv-vision-thumb-tag">已打码</span>`;
    }
    showToast('success', '已打码', '提交时将使用打码后的图片（本地原图不变）', 5000);
  };
}

function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) throw Error('图片数据无效');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

async function doContributeUpload() {
  const statusEl = $('cvUploadStatus');
  if (!currentExp) return;
  if (!$('chkContributeAgree').checked) { showToast('warning', '请先勾选同意', '阅读并勾选隐私同意后才能上传'); return; }
  const expId = currentExp.id;
  const ts = cvTs();
  const files = [];
  let kind = 'variant';
  if (cvMode === 'variant') {
    if (!cvSelections.length) { showToast('warning', '未选择变体', '请至少勾选一条要贡献的变体'); return; }
    const obj = {};
    for (const sel of cvSelections) (obj[sel.section] = obj[sel.section] || []).push(sel.text);
    const note = $('cvVariantNote').value.trim();
    if (note) obj['__note'] = note;   // 备注随包附带，仅开发者可见
    files.push({ name: `自建变体_${expId}.json`, data: new TextEncoder().encode(JSON.stringify(obj, null, 1)), contentType: 'application/json' });
  } else if (cvMode === 'vision') {
    kind = 'vision';
    if (!cvVisionSel.length) { showToast('warning', '未选择样本', '请至少勾选一个识图训练样本'); return; }
    if (cvVisionSel.length > 5) { showToast('warning', '数量过多', '单次最多提交 5 个样本（每个样本含图片与两个 JSON）'); return; }
    const appVersion = (await window.labAPI.getAppVersion()) || '';
    const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 1));
    for (const sel of cvVisionSel) {
      const key = sel.exp + '/' + sel.ts;
      const rd = await window.labAPI.readVisionSample({ expId: sel.exp, ts: sel.ts });
      if (!rd || !rd.ok || !rd.photoDataUrl) {
        showToast('error', '样本读取失败', `${sel.exp} ${sel.ts}：${(rd && rd.error) || '缺少图片'}`, 6000);
        return;
      }
      const maskedUrl = cvVisionMasked.get(key);
      const photoUrl = maskedUrl || rd.photoDataUrl;
      let parsed;
      try { parsed = dataUrlToBytes(photoUrl); }
      catch (e) { showToast('error', '图片无效', `${sel.exp} ${sel.ts}：${e.message}`, 6000); return; }
      const ext = parsed.mime === 'image/png' ? '.png' : '.jpg';
      const ai = JSON.parse(JSON.stringify(rd.aiData || {}));
      const pr = JSON.parse(JSON.stringify(rd.proofreadData || {}));
      if (cvVisionStrip.get(key) !== false) { delete ai.student; delete pr.student; }
      const base = `contributions/vision/${sel.exp}/${sel.ts}`;
      files.push({ name: `photo${ext}`, key: `${base}/photo${ext}`, data: parsed.bytes, contentType: parsed.mime });
      files.push({ name: `ai_${sel.ts}.json`, key: `${base}/ai.json`, data: enc(ai), contentType: 'application/json' });
      files.push({ name: `proofread_${sel.ts}.json`, key: `${base}/proofread.json`, data: enc(pr), contentType: 'application/json' });
      files.push({
        name: `manifest_${sel.ts}.json`, key: `${base}/manifest.json`,
        data: enc({ kind: 'vision', exp: sel.exp, ts: sel.ts, masked: !!maskedUrl, appVersion }),
        contentType: 'application/json',
      });
    }
  } else {
    kind = 'report';
    const score = $('cvReportScore').value;
    if (!score || !/^(7|7\.5|8|8\.5|9|9\.5|10|10\.0)$/.test(String(score))) {
      showToast('warning', '请选择分数', '报告分数为必选项（7.0 ~ 10.0）');
      return;
    }
    if (!cvPhotos.length && !cvDocx) { showToast('warning', '没有可上传内容', '请至少选择一张照片或一个 Word 文档'); return; }
    const prefix = `${expId}-${score}-${ts}`;
    cvPhotos.forEach((p, i) => files.push({ name: `${prefix}_${i + 1}.jpg`, data: p.buf, contentType: 'image/jpeg' }));
    if (cvDocx) files.push({ name: `${prefix}.docx`, data: cvDocx.buf, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    files.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(JSON.stringify({
        kind: 'report', exp: expId, score, ts, note: $('cvReportNote').value.trim(), appVersion: (await window.labAPI.getAppVersion()) || '',
      }, null, 1)),
      contentType: 'application/json',
    });
  }
  const baseKey = `contributions/${cvMode === 'variant' ? 'variants' : cvMode === 'vision' ? 'vision' : 'reports'}/${expId}/${ts}`;
  const items = files.map(f => ({ name: f.name, key: f.key || `${baseKey}/${f.name}` }));   // vision 逐文件带 key（可跨实验）
  statusEl.textContent = '正在获取上传凭证…';
  const c = await window.labAPI.contributeGetCredentials({ files: items.map((x, i) => ({ key: x.key, size: files[i].data.byteLength })) });
  if (!c.ok || !Array.isArray(c.items) || !c.items.length) {
    statusEl.textContent = '';
    showToast('error', '无法上传', (c && c.error) || '凭证服务异常', 5000);
    return;
  }
  const credMap = {};
  c.items.forEach(it => { credMap[it.key] = it.putUrl; });
  let done = 0;
  const failed = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const file = files[i];
    statusEl.textContent = `上传中 ${done + 1}/${items.length}（${item.name}）`;
    const putUrl = credMap[item.key];
    if (!putUrl) { failed.push(item.name + ': 缺少凭证'); continue; }
    const r = await window.labAPI.contributeUpload({ putUrl, data: file.data, contentType: file.contentType });
    if (r.ok) done += 1;
    else failed.push(item.name + ': ' + r.error);
  }
  if (done === items.length) {
    statusEl.textContent = '✓ 上传完成，感谢您的贡献！';
    showToast('success', '贡献成功', '已上传，等待开发者审核');
    if (cvMode === 'report') {
      cvPhotos = [];
      cvDocx = null;
      $('cvReportScore').value = '';
      $('cvReportNote').value = '';
      renderCVPhotos();
      renderCVDocx();
    } else if (cvMode === 'vision') {
      for (const sel of cvVisionSel) {
        try { await window.labAPI.markVisionSubmitted({ expId: sel.exp, ts: sel.ts }); } catch (e) { /* 标记失败不影响已上传 */ }
        cvVisionMasked.delete(sel.exp + '/' + sel.ts);
      }
      await loadCVVision();
    }
  } else if (done > 0) {
    statusEl.textContent = `部分上传失败（${failed.length} 个）`;
    showToast('warning', '部分上传失败', failed.join('；'), 6000);
  } else {
    statusEl.textContent = '';
    showToast('error', '上传失败', failed.join('；'), 5000);
  }
}
let dangerStep = 0;          // 0 一级 / 1 二级 / 2 三级

const DANGER_STEPS = [
  {
    msg: '高危警告！！！请勿点击，点击后若出现任何情况，开发者概不负责！！！',
    proceed: '我不听！',
  },
  {
    msg: '开发者已经做出明确警告与责任声明，你是否继续？',
    proceed: '继续',
  },
  {
    msg: '最后一次确认，你真的要继续吗？',
    proceed: '继续',
  },
];

function startDangerFlow() {
  dangerStep = 0;
  showDangerStep(0);
  openModal('dangerModal');
}

function showDangerStep(step) {
  const cfg = DANGER_STEPS[step];
  $('dangerMsg').textContent = cfg.msg;
  $('btnDangerProceed').textContent = cfg.proceed;
  // 一级“我不听！”用描边样式，二三级“继续”用红色危险样式
  const red = step > 0;
  $('btnDangerProceed').classList.toggle('btn-danger', red);
  $('btnDangerProceed').classList.toggle('btn-outline', !red);
}

function proceedDangerFlow() {
  if (dangerStep < 2) {
    dangerStep += 1;
    showDangerStep(dangerStep);
    return;
  }
  // 三级确认通过：关掉确认弹窗，跑一个彩蛋效果，跑完（或被 Esc 中断）再回主界面
  closeModal('dangerModal');
  runDangerEffect();
}

// 效果池在 src/danger-effects.js：第一次点永远是原来那段音频（保留节目），
// 之后每次从池里随机抽一个，且不与上一次重复。
async function runDangerEffect() {
  // 已经在跑就不重复触发（按钮虽已隐藏，但程序化连点仍会走到这里）
  if (window.dangerEffects && window.dangerEffects.isRunning()) return;
  const first = Number(localStorage.getItem('dangerClickCount') || 0) === 0;
  let id = 'audio';
  if (!first && window.dangerEffects) {
    // 百分之一：原神启动（纯动画彩蛋，不进随机池）；否则从池里随机抽，且不与上次重复
    id = window.dangerEffects.rollRare() || window.dangerEffects.pick();
  }
  try {
    await window.dangerEffects.run(id);
  } catch (err) {
    console.error('[danger] 效果异常，退回音频', err);
    try { await window.dangerEffects.run('audio'); } catch (_) {}
  } finally {
    backToMain();
  }
}

function exitDangerFlow() {
  // 中途退出（还没到三级）时效果池没在跑，这里兜一下以防万一
  if (window.dangerEffects) window.dangerEffects.cancel();
  closeModal('dangerModal');
  showToast('info', '已退出', '还好你及时收手了', 2500);
}

function backToMain() {
  // 关闭所有弹窗，回到主界面（生成页）
  closeModal('settingsModal');
  closeModal('dangerModal');
  switchTab('generate');
}

// ── 报告管理（设置页）──
let lastReportsList = [];   // 最近一次列表结果（供"删除全部"使用）

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

async function loadReportsList() {
  const list = $('reportsList');
  const summary = $('reportsSummary');
  if (!list || !summary) return;
  summary.textContent = '加载中…';
  list.innerHTML = '';
  let reports = [];
  try {
    const r = await window.labAPI.listReports();
    reports = (r && r.ok && Array.isArray(r.reports)) ? r.reports : [];
  } catch (e) { reports = []; }
  lastReportsList = reports;
  const delAllBtn = $('btnDeleteAllReports');
  if (delAllBtn) delAllBtn.disabled = !reports.length;
  if (!reports.length) {
    summary.textContent = '暂无已生成的报告。先选择实验并点击「生成报告」。';
    return;
  }
  summary.textContent = `共 ${reports.length} 份报告 · 按生成时间倒序 · 「删除」仅移除报告文件，不影响测量数据与变体`;
  for (const rep of reports) {
    const row = document.createElement('div');
    row.className = 'report-row';

    const info = document.createElement('div');
    info.className = 'report-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'report-name';
    nameEl.textContent = rep.exp;
    const metaEl = document.createElement('div');
    metaEl.className = 'report-meta';
    metaEl.textContent = `${new Date(rep.mtime).toLocaleString('zh-CN', { hour12: false })} · ${fmtSize(rep.size)} · ${rep.file}`;
    metaEl.title = rep.path;
    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.className = 'report-actions';
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = label; b.onclick = fn;
      return b;
    };
    actions.appendChild(mkBtn('打开', 'btn-outline', () => window.labAPI.openFile(rep.path)));
    actions.appendChild(mkBtn('文件夹', 'btn-outline', () => window.labAPI.showInFolder(rep.path)));
    actions.appendChild(mkBtn('删除', 'btn-ghost report-del', async () => {
      if (!(await appConfirm(`删除「${rep.exp}」的报告 ${rep.file}？\n（测量数据与变体不受影响）`, { danger: true }))) return;
      const rr = await window.labAPI.deleteReport(rep.path);
      if (rr && rr.ok) {
        showToast('success', '已删除', rep.file);
        await refreshAfterReportChange();
      } else {
        showToast('error', '删除失败', (rr && rr.error) || '未知错误', 5000);
      }
    }));

    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

// 报告增删后同步：刷新管理列表 + 实验列表状态（角标/报告文件/预览可用性）
async function refreshAfterReportChange() {
  await loadReportsList();
  experiments = await fetchExperiments();
  experiments.forEach(e => { e.category = getCategory(e.name); });
  updateCategoryCounts();
  updateEmptyStats();
  renderList($('searchInput').value);
  if (currentExp) {
    const updated = experiments.find(e => e.id === currentExp.id);
    if (updated) selectExperiment(updated);
  }
}

async function deleteAllReports() {
  const reports = lastReportsList || [];
  if (!reports.length) return;
  if (!(await appConfirm(`删除全部 ${reports.length} 份已生成报告？\n（仅移除报告文件，测量数据、变体与已导入润色不受影响）`, { danger: true }))) return;
  let ok = 0, fail = 0;
  for (const rep of reports) {
    try {
      const rr = await window.labAPI.deleteReport(rep.path);
      if (rr && rr.ok) ok++; else fail++;
    } catch (e) { fail++; }
  }
  if (fail) showToast('warning', `已删除 ${ok} 份`, `${fail} 份删除失败（可能被 Word 占用，关闭后重试）`, 6000);
  else showToast('success', '已删除全部报告', `共 ${ok} 份`);
  await refreshAfterReportChange();
}

// ── 导入润色结果并重新生成报告（导入本轮全部可导入章节）──
async function importPolishAndRegenerate() {
  if (!currentExp) return;
  const ok = (lastPolishResults || []).filter(r => r.section && r.polished && r.polished.trim()
    && (!r.expId || r.expId === currentExp.id));   // 仅导入当前实验的结果，防跨实验注入
  if (!ok.length) {
    showToast('warning', '无法导入', '本次结果中没有可导入的章节（仅"可导入"章节支持注入重生成）');
    return;
  }
  for (const r of ok) setPolishOverride(currentExp.id, r.section, r.polished);
  updateOverrideBar();
  showToast('info', '已导入 ' + ok.length + ' 个章节', ok.map(r => r.section).join('、') + ' —— 正在重新生成报告…');
  await runGenerate();
}

function loadSettingsForm() {
  const s = loadSettings();
  // 旧版本曾提供豆包/通义千问，现已下架：存量设置自动重置为 DeepSeek
  if (s.provider === 'doubao' || s.provider === 'qwen') {
    s.provider = 'deepseek';
    s.model = '';
    s.apiUrl = '';
    saveSettings(s);
    showToast('info', '供应商已更新', '豆包/通义千问已下架，AI 服务已重置为 DeepSeek，请重新配置', 6000);
  }
  $('selectProvider').value = s.provider || 'deepseek';
  $('inputApiKey').value = '';
  $('inputApiKey').placeholder = s.hasApiKey ? '已安全保存，留空保留；输入新密钥可替换' : '请输入 API Key';
  $('inputModel').value = s.model || '';
  $('inputApiUrl').value = s.apiUrl || '';
  $('chkAiPolish').checked = !!s.aiPolish;
  $('chkKbOnly').checked = s.kbOnly !== false;
  loadSkillList();
  renderModelChips();
  if (window.loadOcrSettingsForm) window.loadOcrSettingsForm();
}

// 渲染常用模型快速选择按钮
function renderModelChips() {
  const provider = $('selectProvider').value;
  const models = POPULAR_MODELS[provider] || [];
  const container = $('modelQuickSelect');
  if (!container) return;
  container.innerHTML = models.map(m =>
    `<button type="button" class="model-chip" data-model="${m.name}">
      <span>${m.name}</span>
      <span class="chip-desc">${m.desc}</span>
    </button>`
  ).join('');
  container.querySelectorAll('.model-chip').forEach(btn => {
    btn.onclick = () => {
      $('inputModel').value = btn.dataset.model;
    };
  });
}

// 切换提供商时自动填充默认 API URL（仅当当前为空或是上一个默认值时）
function autoFillApiUrl() {
  const provider = $('selectProvider').value;
  const currentUrl = $('inputApiUrl').value.trim();
  const defaultUrl = DEFAULT_API_URLS[provider] || '';
  const isDefault = Object.values(DEFAULT_API_URLS).includes(currentUrl);
  if (!currentUrl || isDefault) {
    $('inputApiUrl').value = defaultUrl;
  }
}

// ── 保存设置 ──
async function saveAppSettings() {
  // 在现有设置基础上更新（保留 developerMode 等非本表单字段，避免保存时把开发者模式重置）
  const settings = loadSettings();
  settings.provider = $('selectProvider').value;
  const newKey = $('inputApiKey').value.trim();
  settings.model = $('inputModel').value.trim();
  settings.apiUrl = $('inputApiUrl').value.trim();
  settings.aiPolish = $('chkAiPolish').checked;
  settings.kbOnly = $('chkKbOnly').checked;
  settings.skillStates = getSkillStates();
  if (settings.apiUrl && !/^https:\/\//i.test(settings.apiUrl)) { showToast('error', '地址无效', 'AI 服务必须使用 HTTPS'); return; }
  if (window.saveOcrSettings && !(await window.saveOcrSettings(settings))) return;
  if (newKey) {
    const stored = await window.labAPI.saveCredential({ ...settings, key: newKey });
    if (!stored.ok) { showToast('error', '密钥未保存', stored.error, 6000); return; }
    settings.hasApiKey = stored.configured;
  }
  saveSettings(settings);
  closeModal('settingsModal');
  try { window.labAPI.logEvent(`saveAppSettings | provider=${settings.provider} model=${settings.model || '（默认）'}`); } catch (e) { /* 忽略 */ }
  showToast('success', '已保存', '设置已更新');
  updateAiStatus();
  renderSkillOptions();
}

// ── 运行生成报告 ──
async function runGenerate() {
  if (!currentExp || isGenerating || isBatchRunning || isSavingData || isSwitchingExperiment) return;
  isGenerating = true;
  const genExpId = currentExp.id;
  const btn = $('btnGenerate');
  btn.disabled = true;
  let genOk = false;
  try {
  // 生成前若有未保存修改先保存，保证报告使用当前界面值；保存失败则中止不启动 Word
  if (isDataModified) {
    const saved = await saveFormData();
    if (!saved) {
      showToast('error', '生成已中止', '表单保存失败，请先检查输入后重试');
      return;
    }
  }
  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="40 20" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> 生成中...';
  // 生成期间：结果区显示"报告生成中"，禁用"打开报告"，显示"取消生成"按钮
  setResultState('generating');
  $('btnOpenReport').disabled = true;
  $('btnOpenReport2').disabled = true;
  $('btnCancelGenerate').style.display = 'inline-flex';
  $('logContent').textContent = '开始生成报告...\n';
  switchTab('generate');

    genOk = await runGenerateReport(btn, genExpId);
  } catch (err) {
    $('logContent').textContent += `\n❌ 异常: ${err.message}\n`;
    showToast('error', '运行异常', err.message, 5000);
  } finally {
    isGenerating = false;
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 生成报告';
    $('btnCancelGenerate').style.display = 'none';
    // 生成结束：成功时结果区已由 refreshExperimentAfterGenerate 置为"报告生成成功"；
    // 失败/取消则按当前实验已有报告状态恢复（有旧报告 → 可继续打开旧报告；无 → 显示尚未生成）
    if (!genOk && currentExp) {
      $('btnOpenReport').disabled = !currentExp.hasReport;
      $('btnOpenReport2').disabled = !currentExp.hasReport;
      setResultState(currentExp.hasReport && currentExp.reportFile ? 'success' : 'empty', currentExp.reportFile);
      if (currentExp.hasReport) $('metaReport').textContent = '本次未成功，显示上次报告';
    }
  }
}

// 取消生成
async function cancelGenerate() {
  if (!isGenerating) return;
  $('btnCancelGenerate').disabled = true;
  $('btnCancelGenerate').textContent = '正在取消...';
  $('logContent').textContent += '\n⏹ 正在取消生成...\n';
  try {
    await window.labAPI.cancelGenerate();
  } catch (err) {
    $('logContent').textContent += `\n⚠️ 取消失败: ${err.message}\n`;
  } finally {
    // 恢复按钮（runGenerate 的 finally 会完成后续状态恢复）
    $('btnCancelGenerate').disabled = false;
    $('btnCancelGenerate').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg> 取消生成';
  }
}

// 生成结果区统一状态：empty=尚未生成 / generating=报告生成中 / success=报告生成成功
function setResultState(state, path) {
  $('resultEmpty').style.display = state === 'empty' ? 'block' : 'none';
  $('resultGenerating').style.display = state === 'generating' ? 'block' : 'none';
  $('resultSuccess').style.display = state === 'success' ? 'flex' : 'none';
  if (path) $('resultPath').textContent = path;
}

// 生成后只刷新结果区/按钮状态，不重置日志、不切换 tab、不重载数据
function refreshExperimentAfterGenerate(updated) {
  if (!updated) return;
  currentExp = updated;
  $('metaReport').textContent = '报告已生成';
  $('metaReport').className = 'meta-dot ok';
  $('btnOpenReport').disabled = false;
  $('btnOpenReport2').disabled = false;
  setResultState('success', updated.reportFile);
}

// 实验报告：Python generate.py 生成 Word
async function runGenerateReport(btn, genExpId) {
  const genExp = experiments.find(e => e.id === genExpId) || currentExp;
  const studentInfo = loadStudentInfo();
  // 学生信息未填写时提醒（报告头部将显示"（未填写）"）
  if (!studentInfo.name || !studentInfo.id || !studentInfo.class) {
    showToast('warning', '学生信息未填写', '报告头部将显示（未填写），可在右上角「学生信息」中填写', 5000);
  }
  // 收集变体组合选择（值为 -1 的"随机"在此真正随机）
  const variantChoices = {};
  document.querySelectorAll('.variant-select').forEach(sel => {
    const idx = parseInt(sel.value, 10);
    const sec = sel.dataset.section;
    if (idx === -1 && currentVariants && Array.isArray(currentVariants[sec])) {
      variantChoices[sec] = Math.floor(Math.random() * currentVariants[sec].length);
    } else {
      variantChoices[sec] = idx;
    }
  });
  const result = await window.labAPI.runGenerate(genExp.path, studentInfo, variantChoices, expOverrides(genExp.id), loadSettings().embedDataPhoto !== false);
  if (result.cancelled) {
    $('logContent').textContent += '\n⏹ 生成已取消\n';
    showToast('info', '生成已取消', getDisplayName(genExp));
    return false;
  }
  if (result.ok) {
    $('logContent').textContent += '\n✅ 报告生成成功！\n';
    if (result.reportFile) $('logContent').textContent += `📄 ${result.reportFile}\n`;

    // 插入图表到报告
    const chkInsert = $('chkInsertChart');
    if (chkInsert && chkInsert.checked && result.reportFile) {
      try {
        const insResult = await window.labAPI.insertChartIntoReport(result.reportFile, genExp.path);
        if (insResult.ok) {
          $('logContent').textContent += `📊 图表已插入「${insResult.section}」\n`;
        } else {
          $('logContent').textContent += `⚠️ 图表插入失败: ${insResult.error}\n`;
        }
      } catch (e) {
        $('logContent').textContent += `⚠️ 图表插入异常: ${e.message}\n`;
      }
    }

    showToast('success', '报告生成成功', getDisplayName(genExp));
    // 刷新实验列表
    experiments = await fetchExperiments();
    experiments.forEach(e => { e.category = getCategory(e.name); });
    updateCategoryCounts();
    updateEmptyStats();
    const updated = experiments.find(e => e.id === genExpId);
    // 若用户仍停留在发起生成的实验，则刷新其结果区；中途切换则不影响当前页面
    if (updated && currentExp && currentExp.id === genExpId) {
      refreshExperimentAfterGenerate(updated);
    }
    // 刷新预览
    previewLoaded = false;
    if (document.querySelector('.tab-item.active')?.dataset.tab === 'preview') {
      loadPreview();
    }
    // 更新 AI 状态；章节源文缓存刚随本次生成落盘，同步润色对象选项
    updateAiStatus();
    await refreshAiScopeOptions(true);
    updateOverrideBar();
    return true;
  } else {
    $('logContent').textContent += `\n❌ 生成失败（退出码 ${result.exitCode}）\n`;
    if (result.error) $('logContent').textContent += `错误: ${result.error}\n`;
    const reason = result.error || `退出码 ${result.exitCode}`;
    showToast('error', '生成失败', reason, 6000);
    return false;
  }
}

// ── 变体组合 ──
let currentVariants = null;   // {章节: [变体文本...]}
let aiVariantSection = '';    // 当前 AI 调整的章节

function getSavedVariantChoices() {
  try { return JSON.parse(localStorage.getItem('variantChoices') || '{}'); } catch { return {}; }
}
function saveVariantChoices(choices) {
  localStorage.setItem('variantChoices', JSON.stringify(choices));
}

async function loadVariantsUI(exp) {
  const card = $('variantsCard');
  const list = $('variantsList');
  list.innerHTML = '';
  card.style.display = 'none';
  currentVariants = null;
  try {
    const res = await window.labAPI.loadVariants(exp.path);
    if (!res.ok || !res.variants || Object.keys(res.variants).length === 0) return;
    currentVariants = res.variants;
    renderVariantsPanel();
    card.style.display = '';
  } catch (e) { /* 静默：无变体库时不显示面板 */ }
}

function renderVariantsPanel() {
  const list = $('variantsList');
  list.innerHTML = '';
  const saved = getSavedVariantChoices();
  const expKey = currentExp ? currentExp.id : '';
  const savedForExp = saved[expKey] || {};
  for (const [section, texts] of Object.entries(currentVariants)) {
    if (!Array.isArray(texts)) continue;   // dict 型章节（思考题按问变体）不进手动选择面板
    const row = document.createElement('div');
    row.className = 'variant-row';

    const label = document.createElement('span');
    label.className = 'variant-label';
    label.textContent = section;

    const select = document.createElement('select');
    select.className = 'variant-select';
    select.dataset.section = section;
    const opts = [['-1', '随机']].concat(texts.map((_, i) => [String(i), `变体 ${i + 1}`]));
    for (const [val, txt] of opts) {
      const o = document.createElement('option');
      o.value = val; o.textContent = txt;
      select.appendChild(o);
    }
    if (savedForExp[section] !== undefined && savedForExp[section] >= -1 && savedForExp[section] < texts.length) {
      select.value = String(savedForExp[section]);
    }
    select.onchange = () => {
      const choices = collectVariantChoices();
      const all = getSavedVariantChoices();
      all[expKey] = choices;
      saveVariantChoices(all);
    };

    const pvBtn = document.createElement('button');
    pvBtn.className = 'btn btn-sm btn-outline variant-preview-btn';
    pvBtn.textContent = '预览';
    pvBtn.onclick = () => previewVariant(section, texts);

    const aiBtn = document.createElement('button');
    aiBtn.className = 'btn btn-sm btn-outline variant-ai-btn';
    aiBtn.textContent = 'AI 调整';
    aiBtn.onclick = () => openVariantAI(section);

    row.append(label, select, pvBtn, aiBtn);
    list.appendChild(row);
  }
}

function collectVariantChoices() {
  const choices = {};
  document.querySelectorAll('.variant-select').forEach(sel => {
    choices[sel.dataset.section] = parseInt(sel.value, 10);
  });
  return choices;
}

function randomizeVariants() {
  const expKey = currentExp ? currentExp.id : '';
  const choices = {};
  document.querySelectorAll('.variant-select').forEach(sel => {
    const count = (currentVariants[sel.dataset.section] || []).length;
    choices[sel.dataset.section] = count > 0 ? Math.floor(Math.random() * count) : -1;
    sel.value = String(choices[sel.dataset.section]);
  });
  const all = getSavedVariantChoices();
  all[expKey] = choices;
  saveVariantChoices(all);
  showToast('info', '已随机组合', '已为各章节随机选择变体');
}

function previewVariant(section, texts) {
  const sel = document.querySelector(`.variant-select[data-section="${CSS.escape(section)}"]`);
  let idx = sel ? parseInt(sel.value, 10) : 0;
  if (idx < 0 || idx >= texts.length) idx = 0;
  $('variantPreviewTitle').textContent = `${section} — 变体 ${idx + 1}`;
  $('variantPreviewText').textContent = texts[idx];
  openModal('variantPreviewModal');
}

// AI 变体调整的默认提示词（专业学术风格）
const DEFAULT_VARIANT_AI_PROMPT = '请用专业、严谨的学术写作风格改写这段实验报告文本：物理概念表述准确、术语规范（如“测量”“不确定度”“系统误差”等使用得当），逻辑连贯、语言凝练，避免口语化表达与重复措辞；保持原意与数据不变，必须原样保留所有 $...$ 公式与 %%DATA:xxx%% 数据占位符。';

function openVariantAI(section) {
  const texts = currentVariants[section] || [];
  if (texts.length === 0) return;
  const sel = document.querySelector(`.variant-select[data-section="${CSS.escape(section)}"]`);
  let idx = sel ? parseInt(sel.value, 10) : 0;
  if (idx < 0 || idx >= texts.length) idx = 0;
  aiVariantSection = section;
  $('variantAITitle').textContent = `AI 调整变体 — ${section}（变体 ${idx + 1}）`;
  $('variantAIInstruction').value = DEFAULT_VARIANT_AI_PROMPT;
  $('variantAIOriginal').value = texts[idx];
  $('variantAIResult').value = '';
  $('chkArchiveVariant').checked = true;   // 每次打开默认勾选「同时存入自建变体库」
  openModal('variantAIModal');
}

let aiGenerating = false;     // AI 生成进行中（防重复触发）
let aiRequestId = null;       // 当前请求 ID（用于主进程中止）
let aiCancelled = false;      // 用户已请求取消
let aiPolishCancelled = false;   // AI 润色：用户已请求取消（中止剩余对象）
let aiPolishRequestIds = new Set();   // AI 润色：在飞请求 ID（两路并发，主进程中止与增量过滤用）
let aiFlightOrder = new Map();        // requestId -> 发起序号（预览跟随策略用）
let aiFollowedRequestId = null;       // 流式预览/思考文本跟随的请求（最先发起且仍在飞的那一路）
let aiThinkingChars = 0;              // 本轮已收到的思考字数（两路合计）

async function runVariantAI() {
  if (aiGenerating) return;
  const instruction = $('variantAIInstruction').value.trim();
  const original = $('variantAIOriginal').value;
  if (!original) { showToast('error', '内容为空', '没有可调整的原文本'); return; }
  const settings = loadSettings();
  if (!settings.hasApiKey) {
    showToast('error', '未配置 API Key', '请先在设置中填写 API Key');
    return;
  }
  aiGenerating = true;
  aiCancelled = false;
  aiRequestId = 'ai-' + Date.now();
  $('btnVariantAIRetry').disabled = true;
  $('btnVariantAIRetry').textContent = '生成中...';
  $('btnCancelVariantAI').textContent = '取消生成';
  try {
    const messages = [
      {
        role: 'system',
        content: '你是大学物理实验报告写作助手。根据用户的调整指令，对给定的实验章节文本进行改写：保持物理原理与实验事实正确；必须原样保留 $...$ 公式和 %%DATA:xxx%% 数据占位符；使表达更具个人特色、避免与原文措辞重复。只输出改写后的完整文本，不要输出任何解释或前后缀说明。',
      },
      {
        role: 'user',
        content: `调整指令：${instruction || '换一种措辞风格，使表达更有个人特色，避免与原文重复'}\n\n章节文本：\n${original}`,
      },
    ];
    const result = await window.labAPI.aiChat({
      provider: settings.provider || 'deepseek',
      apiUrl: settings.apiUrl,
      model: settings.model,
      messages,
      temperature: 0.8,
      requestId: aiRequestId,
    });
    if (aiCancelled) return;   // 用户已取消：丢弃结果
    if (result.ok) {
      $('variantAIResult').value = result.content.trim();
      showToast('success', '生成完成', 'AI 已生成新变体，可编辑后保存');
    } else if (result.cancelled) {
      showToast('info', '已取消', '本次 AI 生成已中止');
    } else {
      showToast('error', '生成失败', result.error, 5000);
    }
  } catch (err) {
    if (!aiCancelled) showToast('error', '生成异常', err.message, 5000);
  } finally {
    aiGenerating = false;
    aiRequestId = null;
    $('btnVariantAIRetry').disabled = false;
    $('btnVariantAIRetry').textContent = '生成/重试';
    $('btnCancelVariantAI').textContent = '取消';
  }
}

async function saveVariantAI() {
  const newText = $('variantAIResult').value.trim();
  if (!newText) { showToast('error', '内容为空', '请先生成或填写变体文本'); return; }
  if (!currentVariants[aiVariantSection]) currentVariants[aiVariantSection] = [];
  currentVariants[aiVariantSection].push(newText);
  const res = await window.labAPI.saveVariants(currentExp.path, currentVariants);
  if (!res.ok) { showToast('error', '保存失败', res.error, 5000); return; }
  renderVariantsPanel();
  closeModal('variantAIModal');
  const n = currentVariants[aiVariantSection].length;
  showToast('success', '已保存', `已为"${aiVariantSection}"新增变体 ${n}`);
  // 勾选「同时存入自建变体库」时归档（失败只提示，不影响已保存到实验的变体）
  if ($('chkArchiveVariant').checked && currentExp) {
    const ar = await window.labAPI.saveCustomVariant(currentExp.id, aiVariantSection, newText);
    if (ar.ok) {
      showToast('info', '已归档', '该变体已存入自建变体库');
      await refreshAfterCustomVariantChange();
    } else {
      showToast('warning', '归档失败', ar.error, 5000);
    }
  }
}

function bindVariantsEvents() {
  $('btnRandomVariants').onclick = randomizeVariants;
  $('btnRefreshVariants').onclick = () => { if (currentExp) loadVariantsUI(currentExp); };
  $('btnCloseVariantAI').onclick = () => {
    if (aiGenerating) {   // 生成中关闭窗口也中止请求
      aiCancelled = true;
      window.labAPI.aiChatCancel(aiRequestId);
    }
    closeModal('variantAIModal');
  };
  $('btnCancelVariantAI').onclick = () => {
    if (aiGenerating) {   // 生成中：中止请求但不关窗，可修改后重新生成
      aiCancelled = true;
      window.labAPI.aiChatCancel(aiRequestId);
      showToast('info', '已取消生成', '已中止本次 AI 请求');
      return;
    }
    closeModal('variantAIModal');
  };
  $('btnVariantAIRetry').onclick = runVariantAI;
  $('btnSaveVariantAI').onclick = saveVariantAI;
  $('btnCloseVariantPreview').onclick = () => closeModal('variantPreviewModal');
}

init();
bindVariantsEvents();
