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

function mainHarness(t, failUpdateCopy = false) {
  const root = fixture(t), handlers = new Map(), rawHandlers = new Map(), children = [], kills = [];
  let ready;
  const copied = [];
  const webContents = { mainFrame: { url: require('node:url').pathToFileURL(path.join(__dirname, '../src/index.html')).href }, on: () => {}, setWindowOpenHandler: () => {}, send: () => {} };
  const testKeys = require('node:crypto').generateKeyPairSync('ed25519');
  const mainFile = path.join(__dirname, '../main.js');
  const nativeRequire = createRequire(mainFile);
  const fakeElectron = {
    app: { isPackaged: false, getPath: () => root, getVersion: () => '1.7.5',
      whenReady: () => ({ then: fn => { ready = fn; } }), on: () => {}, requestSingleInstanceLock: () => true },
    clipboard: { writeText: text => copied.push(text) },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    BrowserWindow: function() { this.webContents = webContents; this.on = () => {}; this.loadURL = () => {}; },
    session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } },
    ipcMain: { handle: (name, fn) => { rawHandlers.set(name, fn); handlers.set(name, (event, ...args) => fn({ sender: webContents, senderFrame: webContents.mainFrame }, ...args)); }, on: () => {} },
  };
  const childTools = {
    spawn: () => {
      const child = new EventEmitter();
      Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), pid: 1234, exitCode: null });
      children.push(child); return child;
    },
    execFile: (exe, args, options, callback) => {
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
  const mockedRequire = name => name === 'electron' ? fakeElectron : name === 'child_process' ? childTools : name === 'fs' ? fileTools : nativeRequire(name);
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
  return { root, handlers, rawHandlers, children, kills, authorize, merge: controls.merge, unzipScript: controls.unzipScript, copied, extractDelta: controls.extractDelta, extractReasoning: controls.extractReasoning };
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
