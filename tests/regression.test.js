const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const store = require('../src/main/resource-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labreport-regression-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function read(file) { return fs.readFileSync(file, 'utf8'); }

test('resource update commits files and metadata together, retaining a recovery copy', t => {
  const target = path.join(fixture(t), 'experiments');
  put(path.join(target, 'common/core.py'), 'old');
  const backup = store.replaceTree(target, candidate => {
    put(path.join(candidate, 'common/core.py'), 'new');
    store.writeState(candidate, { manifest: { dataVersion: '2' } });
  });
  assert.equal(read(path.join(target, 'common/core.py')), 'new');
  assert.equal(store.readState(target).manifest.dataVersion, '2');
  assert.equal(read(path.join(backup, 'common/core.py')), 'old');
});

test('preparation failure preserves every original file and version', t => {
  const target = path.join(fixture(t), 'experiments');
  put(path.join(target, 'common/core.py'), 'old');
  store.writeState(target, { manifest: { dataVersion: '1' } });
  assert.throws(() => store.replaceTree(target, candidate => {
    put(path.join(candidate, 'common/core.py'), 'partial');
    throw Error('disk full');
  }), /disk full/);
  assert.equal(read(path.join(target, 'common/core.py')), 'old');
  assert.equal(store.readState(target).manifest.dataVersion, '1');
});

test('rename failure restores the old directory and version', t => {
  const target = path.join(fixture(t), 'experiments');
  put(path.join(target, 'common/core.py'), 'old');
  store.writeState(target, { manifest: { dataVersion: '1' } });
  const io = { ...fs, renameSync: (from, to) => {
    if (path.basename(from) === 'candidate') throw Error('sharing violation');
    fs.renameSync(from, to);
  } };
  assert.throws(() => store.replaceTree(target, candidate => {
    put(path.join(candidate, 'common/core.py'), 'new');
    store.writeState(candidate, { manifest: { dataVersion: '2' } });
  }, io), /sharing violation/);
  assert.equal(read(path.join(target, 'common/core.py')), 'old');
  assert.equal(store.readState(target).manifest.dataVersion, '1');
});

test('installed upgrades refresh existing scripts but retain data, reports and custom variants', t => {
  const root = fixture(t), builtin = path.join(root, 'builtin'), target = path.join(root, 'user');
  for (const base of [builtin, target]) {
    put(path.join(base, 'common/core.py'), 'v1');
    put(path.join(base, 'A/generate.py'), 'v1');
    put(path.join(base, 'A/variants.json'), '["original"]');
    put(path.join(base, 'B/generate.py'), 'v1');
    put(path.join(base, 'B/variants.json'), '["original"]');
  }
  put(path.join(target, 'A/data.json'), '{"measurement":42}');
  put(path.join(target, 'A/report.docx'), 'personal report');
  store.syncBuiltin(builtin, target, store.resourceVersion(builtin), '1');
  put(path.join(target, 'A/variants.json'), '["custom"]');
  put(path.join(builtin, 'common/core.py'), 'v2');
  put(path.join(builtin, 'A/generate.py'), 'v2');
  put(path.join(builtin, 'A/variants.json'), '["new"]');
  put(path.join(builtin, 'B/variants.json'), '["new"]');
  const fingerprint = store.resourceVersion(builtin);
  store.syncBuiltin(builtin, target, fingerprint, '2');
  assert.equal(read(path.join(target, 'A/generate.py')), 'v2');
  assert.equal(read(path.join(target, 'common/core.py')), 'v2');
  assert.equal(read(path.join(target, 'A/data.json')), '{"measurement":42}');
  assert.equal(read(path.join(target, 'A/report.docx')), 'personal report');
  assert.equal(read(path.join(target, 'A/variants.json')), '["custom"]');
  assert.equal(read(path.join(target, 'B/variants.json')), '["new"]');
  put(path.join(target, 'common/core.py'), 'hot-update');
  assert.equal(store.syncBuiltin(builtin, target, fingerprint, '2'), false);
  assert.equal(read(path.join(target, 'common/core.py')), 'hot-update');
});

test('installed upgrades retain the verified data-package state', t => {
  const root = fixture(t), builtin = path.join(root, 'builtin'), target = path.join(root, 'user');
  put(path.join(builtin, 'common/core.py'), 'v1');
  store.syncBuiltin(builtin, target, store.resourceVersion(builtin), '1');
  store.writeState(target, {
    ...store.readState(target),
    manifest: { dataVersion: '2.3.4', removed: ['已下架实验'] },
  });
  put(path.join(builtin, 'common/core.py'), 'v2');
  store.syncBuiltin(builtin, target, store.resourceVersion(builtin), '2');
  assert.deepEqual(store.readState(target).manifest, { dataVersion: '2.3.4', removed: ['已下架实验'] });
});

test('resource sync carries non-script data files (vendored formula deps)', async t => {
  // 回归：白名单曾只认 .py/.json/.md，导致公式转换依赖的符号表 .txt 既不进指纹也不同步，
  // 用户端生成报告直接失败（内置副本缺文件）。这里钉住"数据文件必须一起走"。
  const root = fixture(t), builtin = path.join(root, 'builtin'), target = path.join(root, 'user');
  put(path.join(builtin, 'common/_vendor/latex2mathml/symbols.py'), 'v1');
  put(path.join(builtin, 'common/_vendor/latex2mathml/unimathsymbols.txt'), 'DATA-1');
  store.syncBuiltin(builtin, target, store.resourceVersion(builtin), '1');
  assert.equal(read(path.join(target, 'common/_vendor/latex2mathml/unimathsymbols.txt')), 'DATA-1');
  // 数据文件内容变化必须改变指纹，否则热更新不会触发
  const before = store.resourceVersion(builtin);
  put(path.join(builtin, 'common/_vendor/latex2mathml/unimathsymbols.txt'), 'DATA-2');
  assert.notEqual(store.resourceVersion(builtin), before);
  store.syncBuiltin(builtin, target, store.resourceVersion(builtin), '2');
  assert.equal(read(path.join(target, 'common/_vendor/latex2mathml/unimathsymbols.txt')), 'DATA-2');
});

const renderer = read(path.join(__dirname, '../src/renderer.js'));
function load(context, start, end) {
  vm.runInContext(renderer.slice(renderer.indexOf(start), renderer.indexOf(end, renderer.indexOf(start))), context);
}
function uiContext() {
  const nodes = {};
  return vm.createContext({
    currentExp: { id: 'A', path: 'A', reportFile: 'A.docx' }, currentSchema: {},
    isGenerating: false, isBatchRunning: false, isSavingData: false, isSwitchingExperiment: false,
    isDataModified: true, isAiPolishing: false,
    aiPolishRequestIds: new Set(), aiFlightOrder: new Map(), aiFollowedRequestId: null, aiThinkingChars: 0,
    $: id => nodes[id] ??= { style: {}, value: '', checked: false },
    showToast: () => {}, setResultState: () => {}, switchTab: () => {}, updateAiStatus: () => {},
  });
}

test('clicking the current experiment does not reload unsaved data', async () => {
  const ui = uiContext();
  ui.loadExperimentData = () => assert.fail('must not reload');
  ui.appConfirm = () => assert.fail('must not prompt');
  load(ui, 'async function selectExperiment(', '// ── 多选与批量生成');
  await ui.selectExperiment(ui.currentExp);
  assert.equal(ui.isDataModified, true);
});

test('double generation clicks during save start exactly one report task', async () => {
  const ui = uiContext();
  let releaseSave, saves = 0, starts = 0;
  ui.saveFormData = async () => { saves++; await new Promise(r => releaseSave = r); return true; };
  ui.runGenerateReport = async () => { starts++; return true; };
  load(ui, 'async function runGenerate()', '// 取消生成');
  const first = ui.runGenerate();
  await ui.runGenerate();
  assert.equal(ui.isGenerating, true);
  releaseSave(); await first;
  assert.equal(saves, 1); assert.equal(starts, 1); assert.equal(ui.isGenerating, false);
});

test('failed autosave unlocks the UI and never starts Word', async () => {
  const ui = uiContext();
  ui.saveFormData = async () => { throw Error('disk full'); };
  ui.runGenerateReport = () => assert.fail('must not generate');
  load(ui, 'async function runGenerate()', '// 取消生成');
  await ui.runGenerate();
  assert.equal(ui.isGenerating, false);
  assert.equal(ui.$('btnGenerate').disabled, false);
});

test('batch generation saves the dirty current form before constructing its queue', async () => {
  const ui = uiContext();
  let saves = 0, queued = 0;
  Object.assign(ui, {
    experiments: [{ id: 'A', name: '实验 A', path: 'A' }], selectedIds: new Set(['A']),
    queueState: 'idle', genQueue: [],
    saveFormData: async () => { saves++; return true; },
    openQueuePanel: () => {}, pumpQueue: async () => { queued++; },
  });
  load(ui, 'async function runBatchGenerate()', 'function openQueuePanel()');
  await ui.runBatchGenerate();
  assert.equal(saves, 1);
  assert.equal(queued, 1);
  assert.equal(ui.genQueue.length, 1);
});

test('form issue bar is refreshed while the user edits data', () => {
  const ui = uiContext();
  Object.assign(ui, {
    currentSchema: { groups: [] }, readFormData: () => ({}),
    dataValidation: { validate: () => ['读数：必须是有限数值'] }, escapeHtml: s => s,
  });
  load(ui, 'function refreshFormCheck()', '// 通知主进程当前是否有未保存的数据');
  load(ui, 'function onFormInput()', '// 只读主表单');
  ui.onFormInput();
  assert.equal(ui.$('dataIssueBar').style.display, 'block');
  assert.match(ui.$('dataIssueBar').innerHTML, /必须是有限数值/);
});

test('multi-section polishing uses the original snapshot after switching experiments', async () => {
  const ui = uiContext();
  let releaseFirst, calls = 0;
  Object.assign(ui, {
    currentSections: { one: 'A first', two: 'A second' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}, {value:'sec:two'}] : [] },
    window: { labAPI: { aiChat: async () => {
      if (++calls === 1) await new Promise(r => releaseFirst = r);
      return { ok: true, content: 'mock' };
    } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  const pending = ui.runAiPolish();
  ui.currentExp = { id: 'B', path: 'B', reportFile: 'B.docx' };
  ui.currentSections = { one: 'B first', two: 'B second' };
  await ui.runAiPolish(); // A second click cannot start another request chain.
  releaseFirst(); await pending;
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(ui.lastPolishResults, r => r.original), ['A first', 'A second']);
  assert.ok(ui.lastPolishResults.every(r => r.expId === 'A'));
});

test('AI polish refuses quiz results that modify topics (strong constraint)', async () => {
  const ui = uiContext();
  Object.assign(ui, {
    currentSections: {}, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    getReportText: async () => '1. 原题目文本\n答：原回答\n2. 第二题题目\n答：第二题回答',
    extractSection: (t) => t,   // 提取段外函数：测试中直接透传全文
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{ value: 'quiz' }] : [] },
    window: { labAPI: { aiChat: async () => ({ ok: true, content: '1. 被改写的题目\n新回答' }) } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  const r = ui.lastPolishResults[0];
  assert.ok(r && !r.polished && /题目/.test(r.error || ''), '修改题目的结果应被拒绝：' + JSON.stringify(r));
  // 对照组：题目逐字保留、只改回答 → 放行
  ui.window.labAPI.aiChat = async () => ({ ok: true, content: '1. 原题目文本\n新回答1\n2. 第二题题目\n新回答2' });
  ui.lastPolishResults = [];
  await ui.runAiPolish();
  assert.ok(ui.lastPolishResults[0] && !!ui.lastPolishResults[0].polished, '题目保留应放行');
});

test('AI polish restores original formulas and tolerates AI-added wrappers (strong constraint)', async () => {
  const ui = uiContext();
  Object.assign(ui, {
    currentSections: { one: '原理公式为 $E = mc^2$ 且适用。' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}] : [] },
    window: { labAPI: { aiChat: async () => ({ ok: true, content: '原理公式为 $E = mc^2$，误差 $0.05$ 内完全适用。' }) } },   // 原文公式保留 + AI 给数字新增 $ 包裹
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  const r = ui.lastPolishResults[0];
  assert.ok(r && !!r.polished, '原文公式未被删改时应放行：' + JSON.stringify(r));
  assert.ok(r.polished.includes('$E = mc^2$'), '公式保持原文：' + r.polished);
  assert.ok(r.polished.includes('完全适用'), '文字保留 AI 改写');
  // 对照组：AI 修改了原文公式内容 → 拒绝
  ui.window.labAPI.aiChat = async () => ({ ok: true, content: '原理公式为 $E = mc^3$ 且适用。' });
  ui.lastPolishResults = [];
  await ui.runAiPolish();
  assert.ok(ui.lastPolishResults[0] && !ui.lastPolishResults[0].polished && /公式/.test(ui.lastPolishResults[0].error || ''), '修改原文公式应被拒绝：' + JSON.stringify(ui.lastPolishResults[0]));
  // 对照组2：AI 删除了原文公式 → 拒绝，且诊断信息指出缺失的公式
  ui.window.labAPI.aiChat = async () => ({ ok: true, content: '原理公式非常适用。' });
  ui.lastPolishResults = [];
  await ui.runAiPolish();
  const r3 = ui.lastPolishResults[0];
  assert.ok(r3 && !r3.polished && /公式/.test(r3.error || ''), '删除原文公式应被拒绝：' + JSON.stringify(r3));
  assert.ok(r3.error.includes('$E = mc^2$'), '诊断应指出缺失的原文公式：' + r3.error);
  // 对照组3：AI 保留公式但改了写法（\%→%、\left(→(）→ 归一化等价放行并回填原文写法
  ui.window.labAPI.aiChat = async () => ({ ok: true, content: '原理公式为 $E = mc^2$，误差 $0.05\%$ 内适用。' });
  ui.lastPolishResults = [];
  await ui.runAiPolish();
  const r4 = ui.lastPolishResults[0];
  assert.ok(r4 && !!r4.polished, '写法差异应放行：' + JSON.stringify(r4));
  assert.ok(r4.polished.includes('$0.05\%$'), '公式回填为原文写法：' + r4.polished);
});

test('AI polish retry re-runs only the failed item and keeps the rest of the round', async () => {
  const ui = uiContext();
  let oneCalls = 0;
  Object.assign(ui, {
    currentSections: { one: 'A first', two: 'A second' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}, {value:'sec:two'}] : [] },
    window: { labAPI: { aiChat: async ({ messages }) => {
      const which = /「two」/.test(messages[1].content) ? 'two' : 'one';
      if (which === 'one' && ++oneCalls === 1) return { ok: false, error: '模拟失败' };
      return { ok: true, content: which === 'one' ? 'ONE 改写' : 'TWO 改写' };
    } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  assert.deepEqual(Array.from(ui.lastPolishResults, r => !!r.polished), [false, true], '首轮：one 失败、two 成功');
  assert.equal(ui.$('aiResultCard').style.display, 'none', '整轮润色隐藏结果卡');
  ui.$('aiResultCard').style.display = 'block';   // 真实应用中 renderAiResults 会把结果卡显示回来（此处 mock 为 no-op）
  await ui.runAiPolish('sec:one');   // 单项重润：只重跑失败项
  assert.equal(ui.$('aiResultCard').style.display, 'block', '重润不得隐藏结果卡（已成功文本保持可见）');
  assert.equal(oneCalls, 2, '重润只发起一次请求');
  assert.equal(ui.lastPolishResults.length, 2, '结果仍为两个对象');
  assert.equal(ui.lastPolishResults[0].polished, 'ONE 改写', '失败项重润成功');
  assert.equal(ui.lastPolishResults[1].polished, 'TWO 改写', '成功项保留上一轮结果');
  assert.ok(ui.lastPolishResults.every(r => r.scopeVal), '每项携带 scopeVal 供重润定位');
});

test('AI polish batch retry re-runs every failed item through the queue', async () => {
  const ui = uiContext();
  let round = 0;   // 0=首轮全部失败，1=重跑全部成功
  Object.assign(ui, {
    currentSections: { one: 'A first', two: 'A second', three: 'A third' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'},{value:'sec:two'},{value:'sec:three'}] : [] },
    window: { labAPI: { aiChat: async ({ messages }) => {
      const c = messages[1].content;
      const which = /「two」/.test(c) ? 'two' : /「three」/.test(c) ? 'three' : 'one';
      if (round === 0) return { ok: false, error: '模拟失败' };
      return { ok: true, content: which.toUpperCase() + ' 改写' };
    } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  assert.equal(Array.from(ui.lastPolishResults).filter(r => !!r.polished).length, 0, '首轮三个对象全部失败');
  round = 1;   // 之后所有重跑成功
  await ui.runAiPolish(['sec:three', 'sec:one', 'sec:two']);   // 批量重新润色（队列两路并行）
  assert.deepEqual(Array.from(ui.lastPolishResults, r => !!r.polished), [true, true, true], '批量重跑后全部成功');
  assert.deepEqual(Array.from(ui.lastPolishResults, r => r.polished), ['ONE 改写', 'TWO 改写', 'THREE 改写'], '结果按原顺序落位');
  assert.ok(Array.from(ui.lastPolishResults, r => r.scopeVal).every(v => v === 'sec:one' || v === 'sec:two' || v === 'sec:three'), 'scopeVal 保留');
});

test('AI polish retry feeds the rejection reason back to the model', async () => {
  const ui = uiContext();
  const seen = [];
  Object.assign(ui, {
    currentSections: { one: '原理公式为 $E = mc^2$ 且适用。' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}] : [] },
    window: { labAPI: { aiChat: async ({ messages }) => {
      seen.push(messages[1].content);
      if (seen.length === 1) return { ok: true, content: '原理公式为 $E = mc^3$ 且适用。' };   // 改了公式 → 被拒
      return { ok: true, content: '原理公式为 $E = mc^2$ 且适用。' };   // 带反馈重试后放行
    } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  assert.ok(ui.lastPolishResults[0] && !ui.lastPolishResults[0].polished, '首轮被公式校验拒绝');
  await ui.runAiPolish('sec:one');
  assert.ok(/【上一次尝试被系统拒绝——原因：删改了原文公式】/.test(seen[1]), '重试请求携带失败原因');
  assert.ok(seen[1].includes('$E = mc^2$'), '反馈包含必须逐字保留的公式清单');
  assert.ok(seen[1].includes('$E = mc^3$'), '反馈包含上次被拒的输出供参照');
  assert.ok(ui.lastPolishResults[0] && !!ui.lastPolishResults[0].polished, '带反馈的重润成功');
});

test('AI polish applies settings-enabled skills without per-run checkboxes', async () => {
  const ui = uiContext();
  let systemPrompt = '';
  Object.assign(ui, {
    currentSections: { one: '原文内容' }, skillsCache: [
      { id: 's1.md', name: '技能一', content: '技能一指令内容' },
      { id: 's2.md', name: '技能二', content: '技能二指令内容' },
    ],
    loadSettings: () => ({ hasApiKey: true, skillStates: { 's2.md': false } }),
    getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}] : [] },
    window: { labAPI: { aiChat: async ({ messages }) => { systemPrompt = messages[0].content; return { ok: true, content: '改写' }; } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  assert.ok(systemPrompt.includes('技能一指令内容'), '启用的技能应注入提示词');
  assert.ok(!systemPrompt.includes('技能二指令内容'), '停用的技能不得注入');
});

test('save-vision-sample stores the training triplet and lists/marks samples', t => {
  const h = mainHarness(t);
  const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64');
  const expId = '薄透镜焦距的测量（凸透镜）';
  const save = h.handlers.get('save-vision-sample')({}, {
    expId, ts: '20260920_120000', photoDataUrl: png,
    aiData: { fields: { f_auto: { value: [15.0], confidence: 'high' } }, student: { name: '张三' } },
    proofreadData: { fields: { f_auto: { value: [15.02] } } },
  });
  assert.equal(save.ok, true, save.error);
  const dir = path.join(h.root, '识图数据', expId, '20260920_120000');
  assert.ok(fs.existsSync(path.join(dir, 'photo.png')), '图片应落盘');
  assert.equal(JSON.parse(read(path.join(dir, 'ai.json'))).fields.f_auto.confidence, 'high', 'AI 识别数据原样保存');
  assert.equal(JSON.parse(read(path.join(dir, 'proofread.json'))).fields.f_auto.value[0], 15.02, '人工校对数据保存');
  assert.equal(JSON.parse(read(path.join(dir, 'meta.json'))).submitted, false);
  // 非法标识（含穿越）必须拒绝
  assert.equal(h.handlers.get('save-vision-sample')({}, { expId: '../evil', ts: 'x', photoDataUrl: png, aiData: {}, proofreadData: {} }).ok, false);
  assert.equal(h.handlers.get('save-vision-sample')({}, { expId: 'ok', ts: 'a/b', photoDataUrl: png, aiData: {}, proofreadData: {} }).ok, false);
  // 列表 + 提交标记
  const list = h.handlers.get('list-vision-samples')({});
  assert.equal(list.ok, true);
  assert.equal(list.samples.length, 1);
  assert.equal(list.samples[0].exp, expId);
  assert.equal(h.handlers.get('mark-vision-submitted')({}, { expId, ts: '20260920_120000' }).ok, true);
  assert.equal(h.handlers.get('list-vision-samples')({}).samples[0].submitted, true);
});

test('renderField accepts an override data source for the review UI', async () => {
  const ui = uiContext();
  ui.escapeHtml = (s) => String(s);
  load(ui, 'function renderField(fld, dataOverride)', 'function onFormInput()');
  const html = ui.renderField({ key: 'k1', label: '标签', type: 'number' }, { k1: 42 });
  assert.ok(html.includes('data-key="k1"') && html.includes('value="42"'), '覆盖值应渲染进数据格：' + html);
});

// 核对页（#recogFields）由同一个 renderField 渲染，输入框与主表单共用 data-key/data-idx；
// 弹窗关闭只摘 .show 类、DOM 仍留在文档里。历史缺陷：readFormData 用整篇文档选择器读数组，
// 把残留的核对页输入一并读走 → 数组长度翻倍 → 保存/生成报「数组长度错误」。
test('readFormData is scoped to the main data form', () => {
  const start = renderer.indexOf('function readFormData()');
  const body = renderer.slice(start, renderer.indexOf('async function saveFormData(', start));
  assert.ok(!/document\.querySelector/.test(body), 'readFormData 不得使用整篇文档选择器（核对页残留会被读进来）');
  assert.match(body, /\$\('dataTableWrap'\)/, 'readFormData 必须把取值限定在主表单容器内');
});

test('readFormData reads array fields from the main form container only', () => {
  const ui = uiContext();
  ui.currentSchema = { groups: [{ fields: [
    { key: 'a1', type: 'array', length: 3, label: '数组' },
    { key: 'n1', type: 'number', label: '数字' },
  ] }] };
  const cell = (key, value, extra) => ({
    dataset: Object.assign({ key }, extra || {}), value, classList: { contains: () => false },
  });
  const cells = [cell('a1', '1', { idx: '0' }), cell('a1', '2', { idx: '1' }), cell('a1', '3', { idx: '2' })];
  const numberEl = cell('n1', '7');
  // 主表单容器只暴露自己的格子（文档里另有一份同名残留节点，不在这个容器内）
  ui.$ = (id) => (id === 'dataTableWrap' ? {
    querySelector: (sel) => (sel.includes('n1') ? numberEl : null),
    querySelectorAll: (sel) => (sel.includes('a1') && sel.includes('data-idx') ? cells : []),
  } : null);
  load(ui, 'function readFormData()', 'async function saveFormData(');
  const data = ui.readFormData();
  // vm 领域里造的数组与测试领域原型不同，deepEqual 会因原型失败，这里按值比较
  assert.equal(data.a1.length, 3, '数组长度必须等于主表单格子数（残留核对页不得混入）');
  assert.deepEqual(Array.from(data.a1), [1, 2, 3]);
  assert.equal(data.n1, 7);
});

test('vision contribution upload assembles photo + ai + proofread + manifest with privacy strip', async () => {
  const ui = uiContext();
  const uploaded = [], submitted = [];
  let credFiles = null;
  Object.assign(ui, {
    TextEncoder, atob,
    currentExp: { id: '刚体转动惯量的测量', path: 'x', reportFile: 'r.docx' },
    $: (id) => (id === 'cvVisionList' ? {
      innerHTML: '', style: {},
      // 模拟列表里有一个勾选中的样本（collectCVVisionSel 从 DOM 收集）
      querySelectorAll: () => [{
        dataset: { key: '刚体转动惯量的测量/20260920_120000' },
        querySelector: (sel) => (sel === '.cv-vision-pick' ? { checked: true, disabled: false } : null),
      }],
      querySelector: () => null,
    } : {
      style: {}, value: '', textContent: '', innerHTML: '',
      classList: { toggle: () => {}, add: () => {}, remove: () => {} },
      checked: id === 'chkContributeAgree',
      querySelectorAll: () => [], querySelector: () => null,
    }),
    window: { labAPI: {
      getAppVersion: async () => '9.9.9',
      listVisionSamples: async () => ({ ok: true, samples: [] }),
      readVisionSample: async () => ({
        ok: true,
        photoDataUrl: 'data:image/jpeg;base64,AAAA',
        aiData: { fields: { a: { value: 1 } }, student: { name: '张三', id: '2021001' } },
        proofreadData: { fields: { a: { value: 2 } }, student: { name: '张三', id: '2021001' } },
      }),
      contributeGetCredentials: async (p) => {
        credFiles = p.files;
        return { ok: true, items: p.files.map(f => ({ key: f.key, putUrl: 'https://cos/' + f.key })) };
      },
      contributeUpload: async (p) => { uploaded.push(p); return { ok: true }; },
      markVisionSubmitted: async (p) => { submitted.push(p); return { ok: true }; },
    } },
  });
  load(ui, 'let cvMode = ', 'let dangerStep');
  // 状态是脚本级词法绑定，外部预设属性会被声明遮蔽：改为调用 slice 内部函数设置
  ui.switchCVTab('vision');
  ui.collectCVVisionSel();
  await ui.doContributeUpload();
  assert.equal(credFiles.length, 4, '每个样本 4 个文件：' + JSON.stringify(credFiles.map(f => f.key)));
  const keys = credFiles.map(f => f.key);
  assert.ok(keys.every(k => k.startsWith('contributions/vision/刚体转动惯量的测量/20260920_120000/')), '对象键按 vision 前缀：' + keys.join('、'));
  assert.ok(keys.some(k => k.endsWith('/photo.jpg')) && keys.some(k => k.endsWith('/ai.json'))
    && keys.some(k => k.endsWith('/proofread.json')) && keys.some(k => k.endsWith('/manifest.json')), '三件套 + manifest 齐全');
  const aiFile = uploaded.find(p => p.putUrl.endsWith('/ai.json'));
  const aiObj = JSON.parse(Buffer.from(aiFile.data).toString('utf8'));
  assert.ok(!aiObj.student, '默认移除学生信息');
  assert.equal(aiObj.fields.a.value, 1, '识别数据保留');
  const manifest = JSON.parse(Buffer.from(uploaded.find(p => p.putUrl.endsWith('/manifest.json')).data).toString('utf8'));
  assert.equal(manifest.kind, 'vision');
  assert.equal(manifest.masked, false);
  assert.equal(submitted.length, 1, '上传成功后标记已提交');
});

function mainHarness(t, failUpdateCopy = false, realChild = false, fakeNetwork = null, fakeKeyStore = null) {
  const root = fixture(t), handlers = new Map(), rawHandlers = new Map(), listeners = new Map(), rawListeners = new Map(), children = [], kills = [];
  // main.js installs process-level crash handlers.  Each isolated evaluation needs
  // to remove only the handlers it added so the regression runner stays leak-free.
  const processHandlers = new Map(['uncaughtException', 'unhandledRejection'].map(event => [event, new Set(process.listeners(event))]));
  t.after(() => {
    for (const [event, before] of processHandlers) {
      for (const listener of process.listeners(event)) if (!before.has(listener)) process.removeListener(event, listener);
    }
  });
  let ready;
  const copied = [];
  const sent = [];                      // 主进程推给渲染层的事件（ai-chat-chunk 等）
  const webContents = { mainFrame: { url: require('node:url').pathToFileURL(path.join(__dirname, '../src/index.html')).href }, on: () => {}, setWindowOpenHandler: () => {}, send: (channel, payload) => sent.push({ channel, payload }) };
  const testKeys = require('node:crypto').generateKeyPairSync('ed25519');
  const mainFile = path.join(__dirname, '../main.js');
  const nativeRequire = createRequire(mainFile);
  const fakeElectron = {
    app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.5',
      whenReady: () => ({ then: fn => { ready = fn; } }), on: () => {}, requestSingleInstanceLock: () => true },
    clipboard: { writeText: text => copied.push(text) },
    shell: { openPath: async () => '', showItemInFolder: () => {} },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    BrowserWindow: function() { this.webContents = webContents; this.on = () => {}; this.loadURL = () => {}; },
    session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } },
    ipcMain: {
      handle: (name, fn) => { rawHandlers.set(name, fn); handlers.set(name, (event, ...args) => fn({ sender: webContents, senderFrame: webContents.mainFrame }, ...args)); },
      on: (name, fn) => { rawListeners.set(name, fn); listeners.set(name, (event, ...args) => fn({ sender: webContents, senderFrame: webContents.mainFrame }, ...args)); },
    },
  };
  const childTools = {
    spawn: realChild ? require('node:child_process').spawn : () => {
      const child = new EventEmitter();
      Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 1234, exitCode: null });
      children.push(child); return child;
    },
    execFile: realChild ? require('node:child_process').execFile : (exe, args, options, callback) => {
      kills.push({ exe, args });
      const cb = typeof options === 'function' ? options : callback;
      if (exe === 'taskkill') setImmediate(() => {
        children.at(-1).exitCode = 1;
        children.at(-1).emit('close', 1);
        cb?.(null, '');
      });
      else setImmediate(() => cb?.(null, ''));
    },
  };
  const fileTools = { ...fs, readFileSync: (file, ...args) => String(file).endsWith('update-public-key.pem') ? testKeys.publicKey.export({ type: 'spki', format: 'pem' }) : fs.readFileSync(file, ...args), copyFileSync: (from, to) => {
    if (failUpdateCopy && from.includes('_staging')) throw Error('simulated update copy failure');
    fs.copyFileSync(from, to);
  } };
  const mockedRequire = name => name === 'electron' ? fakeElectron
    : name === 'child_process' ? childTools
      : name === 'fs' ? fileTools
        : (fakeNetwork && name === './src/main/network') ? fakeNetwork
          : (fakeKeyStore && name === './src/main/key-store') ? fakeKeyStore
            : nativeRequire(name);
  const controls = new Function('require', '__dirname', read(mainFile) + '\nreturn { unzipScript: UNZIP_SCRIPT, extractDelta: extractDeltaFromSSELine, extractReasoning: extractReasoningFromSSELine, setPackage: value => { downloadedPackage = value; }, merge: (stage, target, bases) => { const warnings = []; mergeDataTree(stage, target, EXPERIMENTS_DIR, warnings, true, bases); return warnings; } };')(mockedRequire, path.dirname(mainFile));
  ready();
  const authorize = (zip, files, removed, version) => {
    const crypto = require('node:crypto');
    const manifest = { dataVersion: version || '2.0.0', minAppVersion: '1.7.5', url: 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/test.zip', size: fs.statSync(zip).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), files, notes: 'test' };
    if (removed) manifest.removed = removed;
    manifest.signature = crypto.sign(null, Buffer.from(require('../src/main/update-package').canonical(manifest)), testKeys.privateKey).toString('base64');
    controls.setPackage({ path: zip, manifest });
  };
  return { root, handlers, rawHandlers, listeners, rawListeners, children, kills, authorize, merge: controls.merge, unzipScript: controls.unzipScript, copied, sent, extractDelta: controls.extractDelta, extractReasoning: controls.extractReasoning };
}

test('main process rejects concurrent generation and cancels by killing the python tree', async t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const first = h.handlers.get('run-generate')({}, exp, {}, {}, {});
  const duplicate = await h.handlers.get('run-generate')({}, exp, {}, {}, {});
  assert.equal(duplicate.ok, false);
  assert.equal(h.children.length, 1);
  const cancelled = await h.handlers.get('cancel-generate')();
  const result = await first;
  assert.equal(cancelled.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  // 报告生成改为纯 Python（无 Word COM）：取消只需结束 python 进程树，不再有任何外部进程清理脚本
  assert.equal(h.kills.filter(k => k.exe === 'taskkill').length, 1);
  assert.equal(h.kills.filter(k => k.exe !== 'taskkill').length, 0);
});

test('deleting an already removed report is idempotent', t => {
  const h = mainHarness(t);
  const report = path.join(h.root, '实验数据', '实验脚本', '长度与体积的测量', '已删除.docx');
  // reportPath 必须先确认父目录确实是一个实验；目标 DOCX 本身故意不存在。
  put(path.join(path.dirname(report), 'generate.py'), 'print(1)');
  const result = h.handlers.get('delete-report')({}, report);
  assert.deepEqual(result, { ok: true, alreadyGone: true });
});

test('a failed photo replacement keeps the prior photo intact', t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  assert.equal(h.handlers.get('save-table-image')({}, exp, png).ok, true);
  const saved = path.join(h.root, '实验数据', '实验脚本', '长度与体积的测量', '原始数据照片.png');
  assert.ok(fs.existsSync(saved));

  const atomic = require('../src/main/atomic-store');
  const originalWrite = atomic.writeFile;
  atomic.writeFile = () => { throw Error('simulated disk failure'); };
  try {
    const failed = h.handlers.get('save-table-image')({}, exp, 'data:image/jpeg;base64,/9g=');
    assert.equal(failed.ok, false);
    assert.ok(fs.existsSync(saved), '新图写入失败时旧图不能提前删除');
  } finally {
    atomic.writeFile = originalWrite;
  }
});

test('main process rejects data update during generation and reports old DOCX as failure', async t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const pending = h.handlers.get('run-generate')({}, exp, {}, {}, {});
  const update = await h.handlers.get('apply-data-package')({}, { filePath: 'invalid.zip', version: '2' });
  assert.equal(update.ok, false);
  const report = path.join(h.root, '实验数据/实验脚本/长度与体积的测量/old.docx');
  put(report, 'old report');
  fs.utimesSync(report, new Date(0), new Date(0));
  h.children[0].exitCode = 0;
  h.children[0].emit('close', 0);
  assert.equal((await pending).ok, false);
});

test('data package applies common and version together after successful extraction', async t => {
  const h = mainHarness(t), dataRoot = path.join(h.root, '实验数据');
  const zip = path.join(dataRoot, '_package.zip');
  put(zip, 'mock archive');
  h.authorize(zip, { '实验脚本/common/core.py': require('node:crypto').createHash('sha256').update('updated').digest('hex') });
  const pending = h.handlers.get('apply-data-package')({}, { filePath: zip, version: '2', notes: 'test' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'updated');
  h.children[0].emit('close', 0); // Extraction is mocked; merge and commit use real temporary files.
  const result = await pending;
  assert.equal(result.ok, true, result.error);
  assert.equal(read(path.join(dataRoot, '实验脚本/common/core.py')), 'updated');
  assert.equal(h.handlers.get('get-data-info')().localVersion, '2.0.0');
  assert.ok(fs.existsSync(result.backupPath));
});

test('data package copy failure keeps the complete old tree and version', async t => {
  const h = mainHarness(t, true), dataRoot = path.join(h.root, '实验数据');
  h.handlers.get('scan-experiments')();
  const target = path.join(dataRoot, '实验脚本');
  put(path.join(target, 'common/old.py'), 'keep');
  const state = store.readState(target);
  store.writeState(target, { ...state, manifest: { dataVersion: '1.0.0' } });
  const zip = path.join(dataRoot, '_package.zip');
  put(zip, 'mock archive');
  h.authorize(zip, { '实验脚本/common/core.py': require('node:crypto').createHash('sha256').update('new').digest('hex') });
  const pending = h.handlers.get('apply-data-package')({}, { filePath: zip, version: '2' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'new');
  h.children[0].emit('close', 0);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(read(path.join(target, 'common/old.py')), 'keep');
  assert.equal(h.handlers.get('get-data-info')().localVersion, '1.0.0');
});


test('IPC rejects an unknown sender before accessing the filesystem', t => {
  const h = mainHarness(t);
  const r = h.rawHandlers.get('read-docx-buffer')({ senderFrame: { url: 'https://example.invalid' } }, __filename);
  assert.equal(r.ok, false);
  assert.match(r.error, /不可信/);
  assert.equal(h.handlers.get('read-docx-buffer')({}, __filename).ok, false);
});


test('successive official variant updates use the prior official baseline and preserve real edits', t => {
  const h = mainHarness(t), stage = path.join(h.root, 'stage'), target = path.join(h.root, 'target');
  put(path.join(target, 'A/variants.json'), '["v0"]');
  put(path.join(stage, 'A/variants.json'), '["v1"]');
  const key = path.join('A', 'variants.json');
  h.merge(stage, target, { [key]: '["v0"]' });
  assert.equal(read(path.join(target, key)), '["v1"]');
  put(path.join(stage, key), '["v2"]');
  h.merge(stage, target, { [key]: '["v1"]' });
  assert.equal(read(path.join(target, key)), '["v2"]');
  put(path.join(target, key), '["personal"]');
  put(path.join(stage, key), '["v3"]');
  assert.equal(h.merge(stage, target, { [key]: '["v2"]' }).length, 1);
  assert.equal(read(path.join(target, key)), '["personal"]');
});

test('removed experiments are hidden from scan while user data is kept', async t => {
  const h = mainHarness(t), dataRoot = path.join(h.root, '实验数据');
  const victim = path.join(dataRoot, '实验脚本', '要下架实验');
  put(path.join(victim, 'generate.py'), 'print(1)');
  put(path.join(victim, 'data.json'), '{"a":1}');   // 用户已填数据（B 方案：必须保留）
  const zip = path.join(dataRoot, '_package.zip');
  put(zip, 'mock archive');
  const sha = require('node:crypto').createHash('sha256').update('x').digest('hex');
  h.authorize(zip, { '实验脚本/common/core.py': sha }, ['要下架实验']);   // 带下架清单的更新包
  const pending = h.handlers.get('apply-data-package')({}, { filePath: zip, version: '2', notes: 'test' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'x');
  h.children[0].emit('close', 0);
  const result = await pending;
  assert.equal(result.ok, true, result.error);
  const scan = h.handlers.get('scan-experiments')();
  assert.ok(!scan.experiments.some(e => e.name === '要下架实验'), '下架实验应从列表隐藏');
  assert.equal(read(path.join(victim, 'data.json')), '{"a":1}');          // 隐藏式下架：数据保留
  assert.ok(fs.existsSync(path.join(victim, 'generate.py')));             // 文件不删除
});

test('restored experiments reappear once a package omits the removal list', async t => {
  const h = mainHarness(t), dataRoot = path.join(h.root, '实验数据');
  const target = path.join(dataRoot, '实验脚本', '回归上架实验');
  put(path.join(target, 'generate.py'), 'print(1)');
  put(path.join(target, 'data.json'), '{"a":1}');
  const zip = path.join(dataRoot, '_package.zip');
  const sha = require('node:crypto').createHash('sha256').update('x').digest('hex');

  put(zip, 'mock archive 1');
  h.authorize(zip, { '实验脚本/common/core.py': sha }, ['回归上架实验']);      // 第一包：带下架清单
  const first = h.handlers.get('apply-data-package')({}, { filePath: zip, version: '2', notes: 't' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'x');
  h.children[0].emit('close', 0);
  assert.equal((await first).ok, true);
  assert.ok(!h.handlers.get('scan-experiments')().experiments.some(e => e.name === '回归上架实验'), '下架后应隐藏');

  put(zip, 'mock archive 2');
  h.authorize(zip, { '实验脚本/common/core.py': sha }, null, '2.0.1');        // 第二包：省略下架清单 = 无下架实验
  const second = h.handlers.get('apply-data-package')({}, { filePath: zip, version: '2.1', notes: 't' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'x');
  h.children[1].emit('close', 0);
  assert.equal((await second).ok, true);
  assert.ok(h.handlers.get('scan-experiments')().experiments.some(e => e.name === '回归上架实验'), '恢复上架后应重新可见');
  const state = JSON.parse(read(path.join(dataRoot, '实验脚本', '.resource-state.json')));
  assert.ok(!state.manifest || !state.manifest.removed, '恢复后本地下架名单应清空');
});

test('data packages deliver built-in skills into the user skills directory', async t => {
  const h = mainHarness(t), dataRoot = path.join(h.root, '实验数据');
  const zip = path.join(dataRoot, '_package.zip');
  put(zip, 'mock archive');
  const shaOf = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
  h.authorize(zip, {
    '实验脚本/common/core.py': shaOf('x'),
    'skills/新技能.md': shaOf('# 新技能'),
  }, null, '2.0.0');
  const pending = h.handlers.get('apply-data-package')({}, { filePath: zip, notes: 'test' });
  put(path.join(dataRoot, '_staging/实验脚本/common/core.py'), 'x');
  put(path.join(dataRoot, '_staging/skills/新技能.md'), '# 新技能');
  h.children[0].emit('close', 0);
  const result = await pending;
  assert.equal(result.ok, true, result.error);
  assert.equal(read(path.join(h.root, 'skills', '新技能.md')), '# 新技能', '包内技能应落到 userData/skills');
  assert.ok(!fs.existsSync(path.join(dataRoot, '实验脚本', 'skills')), '技能不得混入实验脚本树');
});

test('independent vision service never falls back to the chat endpoint', t => {
  // 审查报告 R10：独立识图模式下 visionApiUrl 为空时，旧实现会回退到主聊天地址 apiUrl，
  // 把独立密钥发到另一个服务（随后被"密钥绑定地址"拦下报错）。
  const h = mainHarness(t);
  const save = h.handlers.get('vision-credential-save');
  // 保存路径：provider 即识图服务，识图地址走 visionApiUrl（与识图请求同名，保证密钥绑定地址一致）
  const independentNoUrl = save({}, {
    key: 'sk-test', provider: 'custom', visionApiUrl: '', apiUrl: 'https://chat.example.com/v1',
  });
  assert.equal(independentNoUrl.ok, false);
  assert.match(independentNoUrl.error, /独立识图服务地址/, '自定义独立服务缺地址时应明确报错，而不是静默用主聊天地址');
  const independentWithUrl = save({}, {
    key: 'sk-test', provider: 'custom', visionApiUrl: 'https://vision.example.com/v1', apiUrl: 'https://chat.example.com/v1',
  });
  assert.ok(!/独立识图服务地址/.test(independentWithUrl.error || ''), '填了独立地址后不应再报地址缺失');
  const presetMode = save({}, {
    key: 'sk-test', provider: 'siliconflow', visionApiUrl: '', apiUrl: 'https://chat.example.com/v1',
  });
  assert.ok(!/独立识图服务地址/.test(presetMode.error || ''), '独立预设（自带地址）不受影响');
});

test('resolve-endpoints 解析真实接口地址（小米/继承/独立服务）', async t => {
  const h = mainHarness(t);
  const resolve = h.handlers.get('resolve-endpoints');
  // 小米：地址取自预设（此前 AI_PROVIDERS 缺 mimo，模型留空会回退自定义服务的 gpt-4o）
  const mimo = resolve({}, { provider: 'mimo', apiUrl: '' });
  assert.equal(mimo.ok, true, JSON.stringify(mimo));
  assert.equal(mimo.chat, 'https://api.xiaomimimo.com/v1');
  assert.equal(mimo.vision, 'https://api.xiaomimimo.com/v1', '未指定识图服务时按继承处理，地址与主对话一致');
  // 继承 + 自定义主地址：识图跟随主地址
  const inheritCustom = resolve({}, { provider: 'custom', apiUrl: 'https://chat.example.com/v1', visionProvider: 'inherit' });
  assert.equal(inheritCustom.vision, 'https://chat.example.com/v1');
  // 独立识图 + 有地址：用独立地址，不受主地址影响
  const independent = resolve({}, { provider: 'custom', apiUrl: 'https://chat.example.com/v1', visionProvider: 'custom', visionApiUrl: 'https://vision.example.com/v1' });
  assert.equal(independent.vision, 'https://vision.example.com/v1');
  assert.equal(independent.chat, 'https://chat.example.com/v1');
  // 独立识图 + 无地址：报错而不是回退主地址（R10）
  const broken = resolve({}, { provider: 'custom', apiUrl: 'https://chat.example.com/v1', visionProvider: 'custom', visionApiUrl: '' });
  assert.equal(broken.ok, false);
  assert.match(String(broken.visionError), /独立识图服务地址/);
});

test('startup restores a resource tree interrupted between renames', t => {
  const root = fixture(t), target = path.join(root, 'live'), transaction = path.join(root, '.resource-test');
  put(path.join(transaction, 'transaction.json'), JSON.stringify({ target }));
  put(path.join(transaction, 'previous/data.json'), '{"measurement":42}');
  assert.equal(store.recoverTree(target), true);
  assert.equal(read(path.join(target, 'data.json')), '{"measurement":42}');
});


test('actual ZIP extractor accepts normal resources and refuses traversal and compression bombs', async t => {
  const h = mainHarness(t), JSZip = require('jszip');
  const bundled = path.join(__dirname, '../python-runtime/python.exe');
  const python = fs.existsSync(bundled) ? bundled : 'python';
  for (const [name, content, expected] of [['common/core.py', 'print(1)', 0], ['../outside.py', 'bad', 1], ['large.md', 'A'.repeat(1024 * 1024), 1]]) {
    const zip = new JSZip(); zip.file(name, content);
    const file = path.join(h.root, 'extract-' + expected + '.zip');
    fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const dest = path.join(h.root, 'extracted'); fs.mkdirSync(dest, { recursive: true });
    const result = require('child_process').spawnSync(python, ['-B', '-c', h.unzipScript, file, dest], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
    assert.equal(result.status === 0, expected === 0, result.stderr);
    assert.equal(fs.existsSync(path.join(h.root, 'outside.py')), false);
  }
});


test('SSE line parser extracts streaming deltas for AI polish preview', t => {
  const h = mainHarness(t);
  const ex = h.extractDelta;
  assert.equal(ex('data: {"choices":[{"delta":{"content":"你"}}]}'), '你');
  assert.equal(ex('data: {"choices":[{"delta":{"content":"好"}}]}'), '好');
  assert.equal(ex('data: [DONE]'), '');
  assert.equal(ex('data: {"choices":[{"delta":{}}]}'), '');
  assert.equal(ex('event: ping'), '');
  assert.equal(ex('data: not-json'), '');
  assert.equal(ex(''), '');
});

test('SSE line parser extracts reasoning deltas for the thinking indicator', t => {
  const h = mainHarness(t);
  const ex = h.extractReasoning;
  assert.equal(ex('data: {"choices":[{"delta":{"reasoning_content":"让我想想"}}]}'), '让我想想');
  assert.equal(ex('data: {"choices":[{"delta":{"content":"正文"}}]}'), '', '正文不进思考通道');
  assert.equal(ex('data: {"choices":[{"delta":{"reasoning_content":""}}]}'), '');
  assert.equal(ex('data: [DONE]'), '');
  assert.equal(ex('event: ping'), '');
  assert.equal(ex('data: not-json'), '');
});

test('AI polish runs two scopes concurrently and keeps results in scope order', async () => {
  const ui = uiContext();
  let inflight = 0, maxInflight = 0;
  Object.assign(ui, {
    currentSections: { one: 'A first', two: 'A second' }, skillsCache: [],
    loadSettings: () => ({ hasApiKey: true }), getAiStylePrompt: () => '', renderAiResults: () => {},
    document: { querySelector: () => null, querySelectorAll: s => s.includes('aiScopeGroup') ? [{value:'sec:one'}, {value:'sec:two'}] : [] },
    window: { labAPI: { aiChat: async ({ messages }) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 15));
      inflight--;
      return { ok: true, content: /「two」/.test(messages[1].content) ? 'TWO 改写' : 'ONE 改写' };
    } } },
  });
  load(ui, 'async function runAiPolish(', '// 渲染多对象润色结果');
  await ui.runAiPolish();
  assert.equal(maxInflight, 2, '两个对象应两路并发');
  assert.deepEqual(Array.from(ui.lastPolishResults, r => r.polished), ['ONE 改写', 'TWO 改写'], '结果按勾选顺序落位');
});

test('copy link IPC accepts a share URL and refuses non-HTTPS clipboard payloads', t => {
  const h = mainHarness(t);
  assert.equal(h.handlers.get('copy-link')({}, 'https://pan.quark.cn/s/test').ok, true);
  assert.deepEqual(h.copied, ['https://pan.quark.cn/s/test']);
  assert.equal(h.handlers.get('copy-link')({}, 'file:///C:/private.txt').ok, false);
});

test('scan skips a corrupted experiment and reports it in warnings', t => {
  const h = mainHarness(t);
  const base = path.join(h.root, '实验数据', '实验脚本');
  const mkExp = (name, schema, data) => {
    const d = path.join(base, name);
    put(path.join(d, 'generate.py'), 'print(1)');
    put(path.join(d, 'schema.json'), JSON.stringify(schema));
    put(path.join(d, 'data.json'), JSON.stringify(data));
  };
  const goodSchema = { groups: [{ fields: [{ key: 'a', type: 'number', required: true, label: 'A' }] }] };
  mkExp('甲实验', goodSchema, { a: 1 });
  mkExp('乙实验', goodSchema, 'not-an-object');   // 合法 JSON 但非对象 → validate 报「数据应为对象」
  mkExp('丙实验', goodSchema, { a: 2 });
  const r = h.handlers.get('scan-experiments')();
  assert.ok(r && Array.isArray(r.experiments), 'scan 必须返回 {experiments, warnings}');
  const names = r.experiments.map(e => e.name);
  assert.ok(names.includes('甲实验') && names.includes('丙实验'), '正常实验应保留');
  assert.ok(!names.includes('乙实验'), '损坏实验应被跳过而不是拖垮列表');
  assert.ok(Array.isArray(r.warnings) && r.warnings.some(w => w.includes('乙实验')), 'warnings 应列出异常实验');
});

test('scan falls back to the builtin schema when a template is corrupted', t => {
  const h = mainHarness(t);
  const base = path.join(h.root, '实验数据', '实验脚本');
  const name = '重力加速度的测量';   // 与安装目录同名实验：兜底读出厂 schema
  // 预热：首次 scan 会触发 builtin→userData 同步（把出厂模板复制进 fixture），
  // 之后再损坏 schema 才能测到兜底路径（否则损坏文件会被同步覆盖）
  h.handlers.get('scan-experiments')();
  const d = path.join(base, name);
  put(path.join(d, 'generate.py'), 'print(1)');
  put(path.join(d, 'schema.json'), '{corrupted');   // schema 损坏且无 .bak（出厂复制品必崩场景）
  put(path.join(d, 'data.json'), '{}');
  const r = h.handlers.get('scan-experiments')();
  const names = r.experiments.map(e => e.name);
  assert.ok(names.includes(name), '出厂 schema 兜底成功则该实验仍显示');
  assert.ok(Array.isArray(r.warnings) && r.warnings.some(w => w.includes(name) && w.includes('模板损坏')), 'warnings 提示模板损坏');
});

// ── 感谢声明：名单读取（userData 副本优先 / 内置兜底）与界面接线 ──
const CREDITS_REL = ['实验数据', '实验脚本', 'common', 'credits.json'];

test('credits list reads the user copy first and falls back to the builtin one', t => {
  const h = mainHarness(t);
  const read_credits = h.handlers.get('read-credits');
  assert.ok(typeof read_credits === 'function', 'read-credits handler 已注册');

  // 未推送过名单时：读安装目录的出厂名单（六条初始署名）
  const builtin = read_credits();
  assert.equal(builtin.ok, true);
  assert.deepEqual(builtin.items.map(i => i.name), ['咕咕咕', '慕寒', '宇宙创生', 'mozhou周言', '怀山', '黑心肥宅黄鹤']);
  assert.equal(builtin.items[0].contribution, '应用推广');

  // userData 副本优先：数据包更新后的名单必须盖过出厂名单
  put(path.join(h.root, ...CREDITS_REL),
    JSON.stringify({ title: '感谢声明', items: [{ name: '甲', contribution: '架构' }, { name: '乙', contribution: '测试' }] }));
  assert.deepEqual(read_credits().items.map(i => i.name), ['甲', '乙']);

  // 异常数据不得打崩界面：非法条目丢弃、字段裁剪、条数截断
  put(path.join(h.root, ...CREDITS_REL), JSON.stringify({ items: [
    { name: '  丙  ', contribution: '  脚本  ' },
    { name: '', contribution: '无名字' },
    { name: 42, contribution: '类型错误' },
    { contribution: '缺名字' },
    ...Array.from({ length: 150 }, (_, i) => ({ name: 'X' + i, contribution: 'C' })),
  ] }));
  const cleaned = read_credits();
  assert.deepEqual(cleaned.items[0], { name: '丙', contribution: '脚本' }, '首尾空白被裁剪');
  assert.equal(cleaned.items.length, 100, '条数按上限截断（防异常数据撑爆界面）');

  // 结构不合法 / JSON 损坏 → 空态（不抛异常、不显示半截名单）
  put(path.join(h.root, ...CREDITS_REL), JSON.stringify({ items: 'not-an-array' }));
  assert.equal(read_credits().ok, true);
  assert.equal(read_credits().items, null);
  put(path.join(h.root, ...CREDITS_REL), '{corrupted');
  const broken = read_credits();
  assert.equal(broken.ok, true, '损坏文件不报错，按空态处理');
  assert.equal(broken.items, null);
});

test('settings thanks pane is wired above the danger entry', () => {
  const html = read(path.join(__dirname, '../src/index.html'));
  const preload = read(path.join(__dirname, '../preload.js'));
  const nav = html.indexOf('id="btnNavThanks"');
  assert.ok(nav > -1, '导航项 btnNavThanks 存在');
  assert.ok(nav < html.indexOf('id="btnNavDanger"'), '感谢声明排在「请勿点击」上方');
  assert.ok(nav > html.indexOf('id="btnNavNotice"'), '感谢声明排在「必读公告」下方');
  const pane = html.indexOf('id="paneThanks"');
  assert.ok(pane > html.indexOf('id="paneNotice"') && pane < html.indexOf('id="paneDanger"'), 'paneThanks 位于必读公告与请勿点击之间');
  assert.ok(html.indexOf('id="thanksList"') > pane, '名单容器 thanksList 存在');
  assert.match(renderer, /btnNavThanks'\)\.onclick = \(\) => \{ switchSettingsPane\('thanks'\); loadThanksPane\(\); \}/, 'renderer 绑定导航项并懒加载名单');
  assert.match(renderer, /\$\('paneThanks'\)\.classList\.toggle\('active', name === 'thanks'\)/, 'switchSettingsPane 切换 paneThanks');
  assert.match(preload, /readCredits: \(\) => ipcRenderer\.invoke\('read-credits'\)/, 'preload 暴露 readCredits');
  const css = read(path.join(__dirname, '../src/style.css'));
  for (const cls of ['.thanks-list', '.thanks-row', '.thanks-name', '.settings-nav-thanks']) {
    assert.ok(css.includes(cls), '样式 ' + cls + ' 存在');
  }
});

// ── 复制到剪贴板（AI 润色结果「复制结果」按钮）──
// 历史缺陷：渲染层用 navigator.clipboard.writeText，而本应用对所有网页权限一律拒绝
// （setPermissionCheckHandler 恒 false）+ 页面是 file:// 不透明源 → 必然失败，只弹「请手动选择复制」。
test('copy-text writes arbitrary clipboard text and refuses invalid payloads', t => {
  const h = mainHarness(t);
  const copy = h.handlers.get('copy-text');
  assert.equal(copy({}, '润色后的正文，含公式 $x^{2}$ 与换行\n第二行').ok, true);
  assert.deepEqual(h.copied, ['润色后的正文，含公式 $x^{2}$ 与换行\n第二行']);
  assert.equal(copy({}, 42).ok, false, '非字符串必须拒绝');
  assert.equal(copy({}, 'x'.repeat(512 * 1024 + 1)).ok, false, '超长内容必须拒绝');
  assert.equal(h.copied.length, 1, '被拒绝的调用不得写入剪贴板');
});

test('AI result copy goes through the main-process clipboard', () => {
  assert.match(renderer, /await window\.labAPI\.copyText\(r\.polished\)/, '复制结果按钮走主进程剪贴板');
  assert.ok(!/navigator\.clipboard\.writeText\s*\(/.test(renderer), '渲染层不得再调用 navigator.clipboard（本应用权限全拒，必然失败）');
  const preload = read(path.join(__dirname, '../preload.js'));
  assert.match(preload, /copyText: \(text\) => ipcRenderer\.invoke\('copy-text', text\)/, 'preload 暴露 copyText');
});

// ── 自定义报告目录（设置 → 报告管理）──
test('run-generate copies the report into the custom directory and keeps the original', async t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const customDir = path.join(h.root, '自定义报告');
  const pending = h.handlers.get('run-generate')({}, exp, {}, {}, {}, true, customDir);
  const report = path.join(h.root, '实验数据/实验脚本/长度与体积的测量/长度与体积的测量.docx');
  put(report, 'report bytes');
  h.children[0].exitCode = 0;
  h.children[0].emit('close', 0);
  const r = await pending;
  assert.equal(r.ok, true);
  const copiedPath = path.join(customDir, '长度与体积的测量', '长度与体积的测量.docx');
  assert.equal(fs.existsSync(copiedPath), true, '自定义目录里应有按实验名建子文件夹的副本');
  assert.equal(fs.readFileSync(copiedPath, 'utf8'), 'report bytes');
  assert.equal(fs.existsSync(report), true, '实验目录原件必须保留（预览/打开/报告列表仍用它）');
  assert.equal(r.copiedTo, copiedPath, '返回值带上复制目标路径');
  // 生成日志（app.log）里也要能看出这次复制
  const logText = fs.readFileSync(path.join(h.root, 'logs', 'app.log'), 'utf8');
  assert.match(logText, /generate \| 结束 \| .*复制=ok/, '生成结束行要带上复制结果');
});

test('an unusable custom report directory does not fail generation', async t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  // 指向内置数据目录（安装目录内）→ 必须被拒；生成本身仍应成功
  const bad = path.join(__dirname, '../物理实验/实验脚本');
  const pending = h.handlers.get('run-generate')({}, exp, {}, {}, {}, true, bad);
  put(path.join(h.root, '实验数据/实验脚本/长度与体积的测量/长度与体积的测量.docx'), 'report bytes');
  h.children[0].exitCode = 0;
  h.children[0].emit('close', 0);
  const r = await pending;
  assert.equal(r.ok, true, '自定义目录不可用时生成仍要成功');
  assert.equal(r.copiedTo, undefined);
  assert.match(r.logs, /\[自定义目录\] 复制失败/, '日志里要有告警');
  assert.equal(fs.existsSync(path.join(bad, '长度与体积的测量', '长度与体积的测量.docx')), false, '不得写进内置数据目录');
});

// AI / 识图请求的诊断日志：这条链路此前完全没有日志（响应异常偏大、模型空转、润色失败都查不到）。
// 现在每次请求结束都落一行：请求类型、模型、结果、实收字节、正文/思考字符数、耗时。
test('AI and OCR requests each write one diagnostic log line', async t => {
  const h = mainHarness(t);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  // 未配置密钥时请求必然失败，但日志照样要落一行（失败原因正是排查最需要的）
  const chat = await h.handlers.get('ai-chat')({}, {
    provider: 'custom', apiUrl: 'https://api.example.com/v1', model: 'test-model',
    messages: [{ role: 'user', content: 'hi' }], label: '结果分析',
  });
  assert.equal(chat.ok, false);
  const ocrRes = await h.handlers.get('ocr-recognize')({}, {
    visionProvider: 'inherit', provider: 'custom', visionApiUrl: 'https://api.example.com/v1',
    model: 'test-model', prompt: '抄录字段', imageDataUrl: png,
  });
  assert.equal(ocrRes.ok, false);
  const logText = fs.readFileSync(path.join(h.root, 'logs', 'app.log'), 'utf8');
  assert.match(logText, /ai-chat \| 结果分析 \| custom\/test-model \| 失败: .+ \| 字节=\d+ 正文=\d+ 思考=\d+ \| \d+ms/,
    'AI 请求要落一行含 类型/模型/结果/字节/正文/思考/耗时 的日志');
  assert.match(logText, /ocr \| inherit\/test-model \| 失败: .+ \| \d+ms/, '识图请求也要落一行');
});

// 提示词输入（按实验保存）+ 自定义思考题（题目硬编码、答案生成时由 AI 产出）
test('per-experiment user prompt and custom quiz are wired through', () => {
  const html = read(path.join(__dirname, '../src/index.html'));
  const preload = read(path.join(__dirname, '../preload.js'));
  const mainSrc = read(path.join(__dirname, '../main.js'));
  // 提示词输入
  assert.ok(html.includes('id="aiUserPrompt"'), '润色面板要有提示词输入框');
  assert.match(renderer, /localStorage\.getItem\('userPrompts'\)/, '提示词按实验存本地');
  assert.match(renderer, /\$\('aiUserPrompt'\)\.onblur = /, '失焦即保存');
  assert.match(renderer, /【用户自定义要求（优先遵循，但不得违反下方格式与知识库硬性约束）】/, '提示词要注入 system 提示词');
  assert.match(renderer, /getAiStylePrompt\(style\)\}\$\{skillBlock\}\$\{userPromptBlock\}/, '插入位置在技能块之后');
  // 自定义思考题
  assert.ok(html.includes('id="btnCustomQuiz"'), '数据卡片要有自定义思考题按钮');
  assert.ok(html.indexOf('id="btnCustomQuiz"') < html.indexOf('id="btnRecognize"'), '按钮在「识别图片」左边');
  for (const id of ['customQuizModal', 'customQuizList', 'btnAddCustomQuiz', 'btnSaveCustomQuiz']) {
    assert.ok(html.includes(`id="${id}"`), '缺少控件 ' + id);
  }
  assert.match(renderer, /localStorage\.getItem\('customQuiz'\)/, '题目按实验存本地');
  assert.match(renderer, /await ensureCustomQuizAnswers\(genExp\)/, '单份生成前先取答案');
  assert.match(renderer, /await ensureCustomQuizAnswers\(q\.exp\)/, '批量生成逐实验取答案');
  assert.match(mainSrc, /customQuiz = null, customPlot = null\) => \{/, 'run-generate 接收 customQuiz');
  assert.match(mainSrc, /customQuiz: \(customQuiz && Array\.isArray\(customQuiz\.questions\)/, '主进程把它写进任务输入');
  assert.match(preload, /reportCopyDir, customQuiz, customPlot\)/, 'preload 透传 customQuiz');
  assert.match(renderer, /customQuizRequestIds/, '自动请求登记在独立集合（不被「取消润色」连带中止）');
  assert.match(renderer, /appConfirm\([\s\S]{0,200}okText: '继续生成'/, '失败时给「继续生成 / 停止」选择');
});

// 图表页的两个模式：预设（字段出图）/ 自定义（AI 写代码出图）——都走"页面预览 → 生成后插入"
test('chart page has preset/custom modes and the custom mode reuses the AI plot pipeline', () => {
  const html = read(path.join(__dirname, '../src/index.html'));
  const preload = read(path.join(__dirname, '../preload.js'));
  const mainSrc = read(path.join(__dirname, '../main.js'));
  const css = read(path.join(__dirname, '../src/style.css'));
  // UI：图表页三个按钮 + 两个弹窗；数据卡片不再有自定义画图入口
  for (const id of ['btnChartPreset', 'btnChartCustom', 'btnChartGenerate', 'chartModeHint',
    'chartPresetModal', 'chartCustomModal', 'customPlotReq', 'plotConsentRow', 'chkPlotConsent',
    'customInsertSection', 'customImageWidth', 'chartInsertModeHint']) {
    assert.ok(html.includes(`id="${id}"`), '缺少控件 ' + id);
  }
  assert.ok(!html.includes('id="btnCustomPlot"'), '数据卡片上的「自定义画图」应已移走');
  assert.ok(!html.includes('id="customPlotModal"'), '旧弹窗 id 应已改名到图表页');
  // 预设弹窗里保留原字段控件（id 不变，接线不动）
  for (const id of ['chartXField', 'chartYField', 'chartType', 'chartTitle', 'chartXLabel', 'chartYLabel',
    'chartInsertSection', 'chartImageWidth', 'btnChartRefresh']) {
    assert.ok(html.includes(`id="${id}"`), '预设弹窗缺少 ' + id);
  }
  assert.match(css, /\.chart-mode-btn\.active/, '模式按钮要有激活态');
  assert.match(css, /\.chart-preview-caption/, '图注要有样式');
  // 「图表插入」卡片和图表页在同一个 tab 里（从生成页移过来的）
  const chartTabHtml = html.slice(html.indexOf('id="tab-chart"'), html.indexOf('id="tab-generate"'));
  assert.ok(chartTabHtml.includes('id="chkInsertChart"'), '「图表插入」开关要在图表页里');
  assert.ok(!html.slice(html.indexOf('id="tab-generate"')).includes('id="chkInsertChart"'), '生成页不该再有这个开关');
  // 渲染层：模式状态 + 配置载体 + 两个弹窗
  assert.match(renderer, /let chartMode = ''/, '要有模式状态');
  assert.match(renderer, /async function loadChartConfig\(/, '要有统一的配置加载');
  assert.match(renderer, /function renderChartMode\(/, '要回显当前模式');
  assert.match(renderer, /async function saveChartConfigSafe\(/, '写配置要读-改-写（不覆盖另一个模式）');
  assert.match(renderer, /\$\('btnChartPreset'\)\.onclick = openChartPresetModal/, '预设按钮绑定');
  assert.match(renderer, /\$\('btnChartCustom'\)\.onclick = openChartCustomModal/, '自定义按钮绑定');
  assert.match(renderer, /async function saveChartPresetModal\(/, '预设弹窗保存');
  assert.match(renderer, /async function saveChartCustomModal\(/, '自定义弹窗保存');
  assert.match(renderer, /legacyCustomPlot\(/, '老版 localStorage 需求要迁移');
  // 自定义模式仍复用原 AI 管线，但改为持久化 + 预览（不再走生成时的 job 字段）
  assert.match(renderer, /PLOT_CONTRACT/, '绘图硬性约定要注入提示词');
  assert.match(renderer, /PLOT_BANNED/, '禁止模块的静态检查');
  assert.match(renderer, /PLOT_MAX_ATTEMPTS = 3/, '失败重试上限');
  assert.match(renderer, /customPlotRequestIds/, '绘图 AI 请求登记在独立集合');
  assert.match(renderer, /window\.labAPI\.runPlot\(exp\.path, code, runId\)/, '自定义模式仍用 run-plot 本机绘图');
  assert.match(renderer, /window\.labAPI\.saveCustomChart\(exp\.path, img\.path\)/, '生成后要持久化到实验目录');
  assert.match(renderer, /window\.labAPI\.cancelPlot\(activePlotRunId\)/, '取消要中止本机绘图');
  // 生成时路径已移除
  assert.ok(!/ensureCustomPlotFigures/.test(renderer), '生成时的 AI 画图路径应已移除');
  assert.ok(!/customPlot = cp\.none/.test(renderer), '不再向 run-generate 传 customPlot');
  // 主进程：配置回显 + 持久化 IPC + 插入按模式分支
  assert.match(mainSrc, /handle\('save-custom-chart'/, '持久化 IPC');
  assert.match(mainSrc, /customImageUrl: readCustomChartUrl\(p\)/, '读配置要带回显用的 dataUrl');
  assert.match(mainSrc, /const mode = cfg\.mode === 'custom' \? 'custom' : 'preset'/, '插入按模式分支');
  assert.match(mainSrc, /自定义图表尚未生成，请到「图表」页点「生成图表」/, '自定义图缺失要给中文提示');
  assert.match(mainSrc, /'--caption', String\(cfg\.caption\)/, '自定义模式带图注插入');
  assert.match(preload, /saveCustomChart: \(expPath, srcPath\)/, 'preload 透传 saveCustomChart');
  assert.match(preload, /runPlot: \(expPath, code, runId\)/, 'preload 透传 runPlot');
  // 技能作用域：绘图技能不参与润色
  assert.match(mainSrc, /scope: meta\.scope/, 'list-skills 返回 scope');
  assert.match(renderer, /sk\.scope !== 'plot' && skillStates\[sk\.id\] !== false/, '润色/思考题排除绘图技能');
  assert.match(renderer, /sk\.scope === 'plot' && skillStates\[sk\.id\] !== false/, '画图只取绘图技能');
});

// 数据包侧的图位机制仍然可用（旧版应用/旧数据包兼容）：run-plot 出的图经 job 字段交给报告脚本。
// 新 UI 不再走这条路径，但机制保留，所以这条端到端用例继续守着它。
test('custom plot job field still lands AI figures (legacy slot path, kept for compatibility)', async t => {
  const h = mainHarness(t, false, true);
  const exp = path.join(__dirname, '../物理实验/实验脚本/霍尔效应实验');
  const code = [
    'import numpy as np',
    'x = np.arange(1.0, 6.0)',
    'fig, ax = plt.subplots()',
    'ax.plot(x, 2 * x, "o-")',
    'save(fig, "fig1.png")',
    'caption("fig1.png", "图1 端到端测试图注")',
  ].join('\n');
  const run = await h.handlers.get('run-plot')({}, exp, code, 'e2e-run-1');
  assert.equal(run.ok, true, 'run-plot 应成功：' + JSON.stringify(run).slice(0, 400));
  assert.equal((run.images || []).length, 1, '应产出 1 张图');
  assert.equal(run.images[0].caption, '图1 端到端测试图注', '图注应被解析');
  assert.ok(fs.existsSync(run.images[0].path), '图片应真实存在：' + run.images[0].path);

  const gen = await h.handlers.get('run-generate')({}, exp,
    { name: '测试同学', id: '2026000001', class: '物理2401', date: '2026-09-22' },
    {}, {}, false, '', null, { images: run.images });
  assert.equal(gen.ok, true, '报告应生成成功：' + JSON.stringify(gen).slice(0, 400));
  const text = (await require('mammoth').extractRawText({ path: gen.reportFile })).value;
  assert.ok(text.includes('图1 端到端测试图注'), '报告里应有 AI 图注');
  assert.ok(!text.includes('图1 B–Im 关系曲线'), '内置图注不应再出现');
  assert.ok(!text.includes('图2 B–I 关系曲线'), '第二张内置图也应被替换掉');
  assert.ok(!fs.existsSync(run.images[0].path), '生成结束后绘图目录应被清理');
});

// 绘图代码的静态检查与代码块提取：挡住明显越界的模块，又不误伤正常绘图写法
test('custom plot extracts fenced code and blocks out-of-bounds modules only', () => {
  const ui = uiContext();
  load(ui, 'const PLOT_BANNED =', 'async function generateCustomChartPreview');
  // const 声明不会挂到 vm 全局上，显式导出后再断言
  vm.runInContext('globalThis.PLOT_BANNED = PLOT_BANNED;', ui);
  assert.equal(ui.extractPlotCode('```python\nimport matplotlib\nplt.plot([1], [2])\n```'),
    'import matplotlib\nplt.plot([1], [2])', '围栏代码块应被取出');
  assert.equal(ui.extractPlotCode('import matplotlib'), 'import matplotlib', '无围栏时整段即代码');
  for (const bad of ['import subprocess', 'os.system("dir")', 'import socket', 'shutil.rmtree("x")']) {
    assert.ok(ui.PLOT_BANNED.test(bad), '应拦下：' + bad);
  }
  for (const good of ['import matplotlib.pyplot as plt', 'pattern = re.compile("x")',
    'data = pd.DataFrame(DATA)', 'from scipy.optimize import curve_fit', 'ax.plot(x, y, "o-")',
    'fig.savefig(os.path.join(OUT_DIR, "fig1.png"))']) {
    assert.ok(!ui.PLOT_BANNED.test(good), '不该误伤：' + good);
  }
});

// 假流：连接建立后一直不产出数据；收到 abort 时按真实流的行为抛 AbortError
function stalledStream(destroyedRef) {
  return async (url, options = {}) => {
    const signal = options.signal;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise((_, reject) => {
          if (!signal) return;
          if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      }),
      destroy: () => { if (destroyedRef) destroyedRef.n++; },
    };
  };
}

// AI 请求静默不再自动中止：主进程推 stall 事件让渲染层弹窗（用户选继续/暂停）
test('ai chat stall pushes a warn event instead of aborting the request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const destroyed = { n: 0 };
  const fakeNetwork = {
    publicUrl: (raw) => new URL(raw),
    response: stalledStream(destroyed),
    json: async () => ({}),
    blocked: () => false, lookup: () => {}, download: async () => {},
  };
  const fakeKeyStore = { createKeyStore: () => ({ get: () => 'test-key', status: () => ({ configured: true }), save: () => ({ ok: true }) }) };
  const h = mainHarness(t, false, false, fakeNetwork, fakeKeyStore);
  const req = h.handlers.get('ai-chat')({}, {
    provider: 'custom', apiUrl: 'https://api.example.com/v1', model: 'm',
    messages: [{ role: 'user', content: 'hi' }], requestId: 'stall-1', label: '结果分析',
  });
  let settled = false;
  req.then(() => { settled = true; });

  t.mock.timers.tick(89000);
  await Promise.resolve();
  const early = h.sent.filter((m) => m.payload && m.payload.kind === 'stall');
  assert.equal(early.length, 0, '不到 90 秒不该提示');
  assert.equal(settled, false, '请求应仍在等待');

  t.mock.timers.tick(2000);
  await Promise.resolve();
  const after = h.sent.filter((m) => m.payload && m.payload.kind === 'stall');
  assert.equal(after.length, 1, '静默 90 秒要推一条 stall 事件');
  assert.equal(after[0].channel, 'ai-chat-chunk');
  assert.equal(after[0].payload.requestId, 'stall-1');
  assert.equal(after[0].payload.label, '结果分析', '事件要带任务名，弹窗才好写文案');
  assert.equal(settled, false, '提示不等于中止：请求必须继续等待');
  assert.equal(destroyed.n, 0, '不得销毁连接');

  t.mock.timers.tick(90000);
  await Promise.resolve();
  assert.equal(h.sent.filter((m) => m.payload && m.payload.kind === 'stall').length, 2,
    '用户选择继续等待后，仍无数据要每 90 秒再提示一次');

  // 用户选「暂停」＝渲染层调 aiChatCancel，请求才真正结束
  h.listeners.get('ai-chat-cancel')({}, 'stall-1');
  const res = await req;
  assert.equal(res.cancelled, true, '暂停后请求应标记为已取消');
});

// 识图与润色的并发额度分开算：两路润色跑满时，识图仍可发起（历史行为是被直接拒绝）
test('ocr has its own concurrency quota, separate from chat', async t => {
  const fakeNetwork = {
    publicUrl: (raw) => new URL(raw),
    response: stalledStream(null),                 // 流式请求一直不产出 → 占住额度
    json: () => new Promise(() => {}),             // 一次性请求也不返回 → 占住识图额度
    blocked: () => false, lookup: () => {}, download: async () => {},
  };
  const fakeKeyStore = { createKeyStore: () => ({ get: () => 'test-key', status: () => ({ configured: true }), save: () => ({ ok: true }) }) };
  const h = mainHarness(t, false, false, fakeNetwork, fakeKeyStore);
  const settledFlag = (p) => { const box = { done: false }; p.then(() => { box.done = true; }); return box; };
  const chatParams = (id) => ({
    provider: 'custom', apiUrl: 'https://api.example.com/v1', model: 'm',
    messages: [{ role: 'user', content: 'hi' }], requestId: id, label: '结果分析',
  });
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7pvvAAAAAElFTkSuQmCC';
  const ocrParams = (id) => ({
    prompt: '抄录表格', imageDataUrl: png1x1, provider: 'custom', apiUrl: 'https://api.example.com/v1',
    model: 'v', visionProvider: 'inherit', requestId: id,
  });

  const c1 = settledFlag(h.handlers.get('ai-chat')({}, chatParams('c1')));
  const c2 = settledFlag(h.handlers.get('ai-chat')({}, chatParams('c2')));
  await Promise.resolve();
  const third = await h.handlers.get('ai-chat')({}, chatParams('c3'));
  assert.equal(third.ok, false, '第 3 路润色仍应被拒（chat 额度 2）');
  assert.match(third.error, /AI 请求正在处理/);

  const o1 = settledFlag(h.handlers.get('ocr-recognize')({}, ocrParams('o1')));
  await Promise.resolve();
  assert.equal(o1.done, false, '两路润色跑满时识图必须被受理（历史行为：直接拒绝）');
  const o2 = settledFlag(h.handlers.get('ocr-recognize')({}, ocrParams('o2')));
  await Promise.resolve();
  assert.equal(o2.done, false, '识图第 2 路仍在额度内');
  const o3 = await h.handlers.get('ocr-recognize')({}, ocrParams('o3'));
  assert.equal(o3.ok, false, '识图额度 2 用满后第 3 路应被拒');
  assert.match(o3.error, /识图请求正在处理/);

  // 反方向也要成立：识图占着额度时，润色仍能开新请求（额度互不挤占）
  h.listeners.get('ai-chat-cancel')({}, 'c1');
  h.listeners.get('ai-chat-cancel')({}, 'c2');
  await Promise.resolve();
  const c4 = settledFlag(h.handlers.get('ai-chat')({}, chatParams('c4')));
  await Promise.resolve();
  assert.equal(c4.done, false, '识图在跑不影响润色额度');
  h.listeners.get('ai-chat-cancel')({}, 'c4');
});

// 静默提示弹窗：继续等待不动请求，暂停才取消
test('stall prompt offers continue-or-pause and only pause cancels', async () => {
  const ui = uiContext();
  let cancelled = null, asked = null;
  ui.window = { labAPI: { aiChatCancel: (id) => { cancelled = id; } } };
  ui.logEvent = () => {};
  load(ui, 'const AI_STALL_WARN_SECONDS = 90;', 'async function runAiPolish(');
  vm.runInContext('globalThis.aiPausedRequestIds = aiPausedRequestIds;', ui);   // const 声明不挂全局，显式导出
  ui.appConfirm = async (msg, opts) => { asked = { msg, opts }; return true; };   // 选「继续等待」
  await ui.promptAiStall('rid-1', '结果分析');
  assert.match(asked.msg, /结果分析/, '弹窗要写明是哪一类任务');
  assert.equal(asked.opts.okText, '继续等待');
  assert.equal(asked.opts.cancelText, '暂停');
  assert.equal(cancelled, null, '选继续等待时不得取消请求');

  ui.appConfirm = async () => false;                                             // 选「暂停」
  await ui.promptAiStall('rid-2', '结论');
  assert.equal(cancelled, 'rid-2', '选暂停时要取消该请求');
  assert.equal(ui.aiPausedRequestIds.has('rid-2'), true, '暂停的请求要登记，润色流程据此标记失败而不是丢弃');
  assert.equal(ui.aiPausedRequestIds.has('rid-1'), false, '选继续等待的请求不登记');
  // 润色流程里的落点：暂停 → 失败卡片（可重新润色），而不是像整轮取消那样静默丢弃
  assert.match(renderer, /aiPausedRequestIds\.has\(rid\)/, '润色流程要识别"用户暂停"的请求');
  assert.match(renderer, /已暂停等待模型响应（可点「重新润色」重试）/, '暂停要给可重试的失败提示');
  assert.match(renderer, /if \(kind === 'stall'\) \{[\s\S]{0,120}promptAiStall/, 'stall 事件要在"只处理润色请求"判断之前处理');

  // 多路同时卡住：弹窗串行排队（appConfirm 是单槽，不能同时弹两个互相覆盖）
  let dialogs = 0, maxConcurrent = 0, open = 0;
  ui.appConfirm = async () => {
    dialogs++; open++; maxConcurrent = Math.max(maxConcurrent, open);
    await new Promise(r => setImmediate(r));
    open--;
    return true;
  };
  await Promise.all([ui.promptAiStall('a', 'A'), ui.promptAiStall('b', 'B')]);
  assert.equal(dialogs, 2, '两个等待事件都要弹（排队而不是丢弃）');
  assert.equal(maxConcurrent, 1, '同一时刻只能有一个等待弹窗');
});

// 图表预览 / 插入报告（队友 PR #5 合入）：接线 + 打包安全 + 与自定义目录的同步
test('chart preview / insert chart are wired and packaged-safe', () => {
  const mainSrc = read(path.join(__dirname, '../main.js'));
  const preload = read(path.join(__dirname, '../preload.js'));
  const html = read(path.join(__dirname, '../src/index.html'));
  // IPC 与透传
  for (const ch of ['run-chart-preview', 'read-chart-config', 'save-chart-config', 'insert-chart-into-report']) {
    assert.match(mainSrc, new RegExp(`handle\\('${ch}'`), '缺少 IPC ' + ch);
  }
  for (const api of ['chartPreview', 'readChartConfig', 'saveChartConfig', 'insertChartIntoReport']) {
    assert.match(preload, new RegExp(`${api}: `), 'preload 缺少 ' + api);
  }
  assert.match(preload, /insertChartIntoReport: \(docxPath, expPath, reportCopyDir\)/, '插图要把自定义目录一起传下去');
  assert.ok(html.includes('id="btnChartGenerate"') && html.includes('id="chkInsertChart"'), '图表页与「插入图表」开关要在');
  // 打包安全：脚本从 src/main 读、经 stdin 注入、不得再出现 cwd: __dirname
  assert.match(mainSrc, /runChartHelper\('chart-preview\.py'/, '预览走统一的图表辅助调用');
  assert.match(mainSrc, /runChartHelper\('insert-chart-into-docx\.py'/, '插图走统一的图表辅助调用');
  assert.match(mainSrc, /fs\.readFileSync\(path\.join\(__dirname, 'src', 'main', sourceName\)/, '脚本源码从 src/main 读（随 asar 打包）');
  assert.match(mainSrc, /\['-B', '-X', 'utf8', '-', \.\.\.args\]/, '源码经 stdin 注入执行');
  assert.ok(!/cwd: __dirname/.test(mainSrc), '不得再用 cwd: __dirname（打包后指向 asar，不是真实目录）');
  assert.ok(!/path\.join\(__dirname, 'scripts'/.test(mainSrc), '不得再从 scripts/ 找运行时脚本');
  assert.match(mainSrc, /'--scripts-root', EXPERIMENTS_DIR/, '脚本要拿到实验脚本根（common/ 的 sys.path）');
  assert.ok(!/chart_insert_temp/.test(mainSrc), '临时图不再写进用户实验目录');
  // 行为兼容
  assert.match(mainSrc, /reportPath\(docxPath\)/, '插图前校验报告路径');
  assert.match(mainSrc, /reportCopyDir = ''/, '插图处理器接收自定义报告目录');
  assert.match(renderer, /await maybeInsertChart\(genExp, result\)/, '单份生成后插图');
  assert.match(renderer, /else await maybeInsertChart\(q\.exp, r\)/, '批量生成也插图');
  assert.match(renderer, /\$\('btnChartRefresh'\)\.onclick = \(\) => applyChartConfigToUi\(\)/, '预设弹窗里的刷新字段只回填控件');
  // 两个脚本：不得依赖 __file__（stdin 注入下没有意义），Word 占用要给中文提示
  const previewPy = read(path.join(__dirname, '../src/main/chart-preview.py'));
  assert.ok(!/abspath\(__file__\)/.test(previewPy), 'chart-preview.py 不得依赖 __file__');
  assert.match(previewPy, /--scripts-root/, 'chart-preview.py 要接受实验脚本根');
  const insertPy = read(path.join(__dirname, '../src/main/insert-chart-into-docx.py'));
  assert.match(insertPy, /报告文件正被占用/, 'Word 占用要给中文提示');
  assert.ok(!fs.existsSync(path.join(__dirname, '../scripts/chart_preview.py')), '旧位置脚本应已删除');
});

test('chart preview and insert run real python and sync the custom report dir', async t => {
  const h = mainHarness(t, false, true);            // 真 python（走 stdin 注入的辅助脚本）
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  // 1) 预览：真实实验数据 → base64 PNG
  const prev = await h.handlers.get('run-chart-preview')({}, {
    expPath: exp, xField: 'D', yField: 'd_shi', chartType: 'scatter', title: '端到端测试图',
  });
  assert.equal(prev.ok, true, '预览应成功：' + JSON.stringify(prev).slice(0, 300));
  assert.match(prev.dataUrl, /^data:image\/png;base64,/, '应返回 base64 PNG');
  assert.ok(fs.existsSync(prev.path), '预览 PNG 应存在');

  // 2) 生成一份真实报告（后续插图用它）
  const gen = await h.handlers.get('run-generate')({}, exp,
    { name: '测试同学', id: '2026000001', class: '物理2401', date: '2026-09-23' },
    {}, {}, false, '', null, null);
  assert.equal(gen.ok, true, '报告应生成成功：' + JSON.stringify(gen).slice(0, 300));

  // 3) 写入图表配置（与「图表」页保存的同一份），再把图插进报告并同步到自定义目录
  const expCopy = path.join(h.root, '实验数据', '实验脚本', '长度与体积的测量');
  const copyDir = path.join(h.root, '自定义报告');
  put(path.join(expCopy, '.chart-config.json'),
    JSON.stringify({ xField: 'D', yField: 'd_shi', chartType: 'scatter', insertSection: '实验结果分析', imageWidth: 12 }));
  const ins = await h.handlers.get('insert-chart-into-report')({}, gen.reportFile, exp, copyDir);
  assert.equal(ins.ok, true, '插图应成功：' + JSON.stringify(ins).slice(0, 300));
  assert.equal(ins.section, '实验结果分析', '回报的插入章节');
  const chartLog = (() => {
    try {
      return fs.readFileSync(path.join(h.root, 'logs', 'app.log'), 'utf8').split('\n')
        .filter(l => l.includes('chart')).slice(-3).join(' | ');
    } catch (e) { return '(无日志)'; }
  })();
  assert.ok(ins.copiedTo && fs.existsSync(ins.copiedTo),
    '带图表的版本应同步到自定义目录：' + ins.copiedTo + ' | 日志: ' + chartLog);
  assert.equal(fs.statSync(ins.copiedTo).size, fs.statSync(gen.reportFile).size, '自定义目录副本应与实验目录那份一致');

  // 4) 临时图表图片要清理，不留中间产物
  const leftovers = fs.readdirSync(path.join(h.root, '.chart-previews')).filter(f => f.startsWith('insert_'));
  assert.equal(leftovers.length, 0, '临时图表图片应被清理：' + leftovers);
});

// 自定义模式的端到端：AI 出的图先持久化到实验目录，再按配置插进报告并同步自定义目录
test('custom-mode chart persists to the experiment dir and is inserted with a caption', async t => {
  const h = mainHarness(t, false, true);            // 真 python
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  // 1) 先造一张"AI 生成的图"放进 run-plot 的隔离目录（模拟 run-plot 的产物）。
  // 夹具用仓库里已入库的真 PNG（src/icon.png）：python-docx 会真的解析 PNG 分块，
  // 手工拼的最小 PNG 会被它的分块解析器拒掉。
  const plotDir = path.join(h.root, 'plot-cache', 'manual-run-1', 'out');
  fs.mkdirSync(plotDir, { recursive: true });
  const srcPng = path.join(plotDir, 'fig1.png');
  fs.copyFileSync(path.join(__dirname, '../src/icon.png'), srcPng);
  // 2) 持久化：应落到实验目录的隐藏文件，并删掉源 run 目录
  const saved = await h.handlers.get('save-custom-chart')({}, exp, srcPng);
  assert.equal(saved.ok, true, '持久化应成功：' + JSON.stringify(saved).slice(0, 300));
  assert.match(saved.dataUrl, /^data:image\/png;base64,/, '应返回预览 dataUrl');
  const persisted = path.join(h.root, '实验数据', '实验脚本', '长度与体积的测量', '.chart-custom.png');
  assert.equal(path.resolve(saved.path), path.resolve(persisted), '应落到实验目录的 .chart-custom.png');
  assert.ok(fs.existsSync(persisted), '持久化文件应存在');
  assert.ok(!fs.existsSync(path.join(h.root, 'plot-cache', 'manual-run-1')), '源 run 目录应被清掉（不再经过 run-generate）');

  // 3) 生成报告 → 自定义模式插图（带图注）
  const gen = await h.handlers.get('run-generate')({}, exp,
    { name: '测试同学', id: '2026000001', class: '物理2401', date: '2026-09-23' },
    {}, {}, false, '', null, null);
  assert.equal(gen.ok, true, '报告应生成成功：' + JSON.stringify(gen).slice(0, 300));
  const expCopy = path.join(h.root, '实验数据', '实验脚本', '长度与体积的测量');
  const copyDir = path.join(h.root, '自定义报告');
  put(path.join(expCopy, '.chart-config.json'), JSON.stringify({
    mode: 'custom', requirement: '画一张测试图', imagePath: persisted,
    caption: '图1 自定义模式端到端测试', insertSection: '实验结果分析', imageWidth: 12,
  }));
  const ins = await h.handlers.get('insert-chart-into-report')({}, gen.reportFile, exp, copyDir);
  assert.equal(ins.ok, true, '自定义模式插图应成功：' + JSON.stringify(ins).slice(0, 300));
  assert.equal(ins.mode, 'custom', '回报里要标明模式');
  assert.ok(ins.copiedTo && fs.existsSync(ins.copiedTo), '带图表的版本应同步到自定义目录');
  const text = (await require('mammoth').extractRawText({ path: gen.reportFile })).value;
  assert.ok(text.includes('图1 自定义模式端到端测试'), '报告里应写入图注');
  assert.ok(fs.existsSync(persisted), '插入后用户那张图必须还在（不能被当临时文件删掉）');

  // 4) 图缺失时要给明确中文提示，而不是静默失败
  fs.unlinkSync(persisted);
  const again = await h.handlers.get('insert-chart-into-report')({}, gen.reportFile, exp, '');
  assert.equal(again.ok, false, '图缺失应失败');
  assert.match(again.error, /自定义图表尚未生成/, '提示要引导用户回图表页重新生成：' + again.error);
});

// 等待弹窗的「停止」要分发到对应的取消通道（生成/画图/图表脚本/AI 请求各走各的）
test('job wait dialog stops via the matching cancel channel', async () => {
  const ui = uiContext();
  const calls = [];
  const asked = [];
  ui.window = {
    labAPI: {
      aiChatCancel: (id) => calls.push('ai:' + id),
      cancelPlot: (id) => calls.push('plot:' + id),
      cancelChartHelper: (id) => calls.push('chart:' + id),
    },
  };
  ui.logEvent = () => {};
  ui.cancelGenerate = () => calls.push('generate');
  load(ui, 'const AI_STALL_WARN_SECONDS = 90;', 'async function runAiPolish(');
  ui.appConfirm = async (msg, opts) => { asked.push(opts.cancelText); return false; };   // 一律选「停止」
  await ui.promptJobWait({ kind: 'plot', id: 'p1', label: '自定义画图', seconds: 120 });
  await ui.promptJobWait({ kind: 'chart', id: 'c1', label: '图表预览', seconds: 60 });
  await ui.promptJobWait({ kind: 'generate', label: '低电阻的测量', seconds: 300 });
  await ui.promptJobWait({ kind: 'ai', id: 'a1', label: '结果分析', seconds: 90 });
  assert.equal(JSON.stringify(calls), JSON.stringify(['plot:p1', 'chart:c1', 'generate', 'ai:a1']),
    '停止要分发到对应通道');
  assert.equal(JSON.stringify(asked), JSON.stringify(['停止', '停止', '停止', '暂停']),
    'AI 请求的按钮是「暂停」，长任务的是「停止」');
});

// 生成 / 画图 / 图表脚本的时间闸：到点只提示，绝不自己杀进程
test('job wait gates prompt instead of interrupting the job', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const waits = () => h.sent.filter(m => m.channel === 'job-wait');

  // ① 报告生成：5 分钟提示一次，不中止
  const gen = h.handlers.get('run-generate')({}, exp, {}, {}, {});
  let genSettled = false; gen.then(() => { genSettled = true; });
  await Promise.resolve();
  t.mock.timers.tick(5 * 60 * 1000);
  await Promise.resolve();
  assert.equal(waits().length, 1, '生成满 5 分钟要提示一次');
  assert.equal(waits()[0].payload.kind, 'generate');
  assert.equal(waits()[0].payload.label, '长度与体积的测量', '提示要带实验名');
  assert.equal(genSettled, false, '提示不等于中止：生成必须继续');
  assert.equal(h.kills.length, 0, '不得杀 python');
  t.mock.timers.tick(5 * 60 * 1000);
  await Promise.resolve();
  assert.equal(waits().length, 2, '用户继续等待后每 5 分钟再提示一次');
  // 用户选「停止」＝渲染层调 cancel-generate（沿用既有取消路径）
  const cancelled = await h.handlers.get('cancel-generate')({});
  assert.equal(cancelled.ok, true, '停止要能真的取消');
  assert.equal(h.kills.filter(k => k.exe === 'taskkill').length, 1, '只有用户停止才杀进程');

  // ② 自定义画图：120 秒提示一次，不杀
  const before = waits().length;
  const plot = h.handlers.get('run-plot')({}, exp, 'import matplotlib\n', 'plot-wait-1');
  let plotSettled = false, plotResult = null;
  plot.then((r) => { plotSettled = true; plotResult = r; });
  await Promise.resolve();
  t.mock.timers.tick(120000);
  await Promise.resolve();
  assert.equal(waits().length, before + 1, '绘图满 120 秒要提示一次');
  assert.equal(waits()[before].payload.kind, 'plot');
  assert.equal(waits()[before].payload.id, 'plot-wait-1', '提示要带 runId，停止时按 id 取消');
  assert.equal(plotSettled, false, '绘图仍在跑，实得 ' + JSON.stringify(plotResult));

  // ③ 图表辅助脚本：60 秒提示一次，不杀
  const before2 = waits().length;
  const prev = h.handlers.get('run-chart-preview')({}, {
    expPath: exp, xField: 'D', yField: 'd_shi', chartType: 'scatter',
  });
  let prevSettled = false; prev.then(() => { prevSettled = true; });
  await Promise.resolve();
  t.mock.timers.tick(60000);
  await Promise.resolve();
  assert.equal(waits().length, before2 + 1, '图表脚本满 60 秒要提示一次');
  assert.equal(waits()[before2].payload.kind, 'chart');
  const helperId = waits()[before2].payload.id;
  assert.ok(helperId, '提示要带 helper id');
  assert.equal(prevSettled, false, '图表脚本仍在跑');
  const chartWaits = () => waits().filter(m => m.payload.kind === 'chart' && m.payload.id === helperId);
  assert.equal(chartWaits().length, 1, '先只提示一次');
  // 停止：按 id 走 chart-helper-cancel（listen 是 fire-and-forget，用日志断言效果）
  h.listeners.get('chart-helper-cancel')({}, helperId);
  const logText = fs.readFileSync(path.join(h.root, 'logs', 'app.log'), 'utf8');
  assert.match(logText, /图表预览 已按用户要求停止/, '停止要落日志');
  t.mock.timers.tick(60000);
  await Promise.resolve();
  assert.equal(chartWaits().length, 2, '停止后仍按 60 秒节奏提示（假子进程不会真的退出）');
});

test('report pane keeps one action row with pick-directory, no open/clear buttons', () => {
  const html = read(path.join(__dirname, '../src/index.html'));
  const preload = read(path.join(__dirname, '../preload.js'));
  const css = read(path.join(__dirname, '../src/style.css'));
  for (const id of ['btnRefreshReports', 'btnPickReportDir', 'btnDeleteAllReports']) {
    assert.ok(html.includes(`id="${id}"`), '缺少控件 ' + id);
  }
  for (const gone of ['btnOpenReportDir', 'btnClearReportDir', 'customReportDirPath']) {
    assert.ok(!html.includes(`id="${gone}"`), '已移除的控件不该还在：' + gone);
  }
  assert.ok(html.includes('>选择保存位置</button>'), '按钮文案应为「选择保存位置」');
  // 三个按钮同一行，且删除在最右（行内 margin-left:auto）
  const row = html.indexOf('id="btnRefreshReports"');
  const pick = html.indexOf('id="btnPickReportDir"');
  const del = html.indexOf('id="btnDeleteAllReports"');
  assert.ok(row > -1 && row < pick && pick < del, '按钮顺序：刷新列表 → 选择保存位置 → 删除全部报告');
  assert.match(css, /#paneReports > \.skill-actions #btnDeleteAllReports \{ margin-left: auto; \}/, '删除全部报告靠右');
  assert.match(css, /#paneReports > \.skill-actions \{/, '按钮行按直接子级吸底（相对位置固定）');
  assert.ok(!/\.reports-list[^}]*overflow-y/.test(css), '列表不再自成滚动容器（整页只留一个滚动条）');
  assert.match(renderer, /\$\('btnPickReportDir'\)\.onclick = pickReportDir;/, '选择保存位置按钮已绑定');
  assert.match(renderer, /settings\.customReportDir = r\.dir;/, '选择后写入 appSettings');
  assert.match(renderer, /loadSettings\(\)\.customReportDir \|\| ''/, '生成时把自定义目录传给主进程');
  assert.match(preload, /pickDirectory: \(current\) => ipcRenderer\.invoke\('pick-directory', current\)/, 'preload 暴露 pickDirectory');
  assert.ok(!/openDirectory:/.test(preload), 'preload 不再暴露已删除的 openDirectory');
});

// AI 润色响应体异常偏大：历史行为是直接中止并报「AI 响应内容过大」；现改为只告警不中止。
test('oversized AI response warns instead of aborting the request', () => {
  const mainSrc = read(path.join(__dirname, '../main.js'));
  assert.ok(!/throw Error\('AI 响应内容过大'\)/.test(mainSrc), '不得再中止请求');
  assert.ok(!/response\.destroy\(\)/.test(mainSrc), '不得再销毁响应流');
  assert.match(mainSrc, /kind: 'warn'/, '超过阈值要发出告警事件');
  assert.match(mainSrc, /OVERFLOW_KEEP/, '文本累积仍要有上限（防空转流无限吃内存）');
  // 渲染层必须显式处理 warn，且分支要在「只跟随最先发起的一路」闸门之前，否则非跟随请求的告警会被丢弃
  const warnIdx = renderer.indexOf("if (kind === 'warn')");
  const followIdx = renderer.indexOf('if (requestId !== aiFollowedRequestId) return;');
  assert.ok(warnIdx > -1, '渲染层要处理 warn');
  assert.ok(followIdx > -1 && warnIdx < followIdx, 'warn 分支必须在跟随闸门之前');
  assert.match(renderer, /showToast\('warning', '目前模型可能空转或跑飞'/, '提示文案');
});
