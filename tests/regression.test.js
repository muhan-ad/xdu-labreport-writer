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
  load(ui, 'async function runAiPolish()', '// 渲染多对象润色结果');
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
  load(ui, 'async function runAiPolish()', '// 渲染多对象润色结果');
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
  load(ui, 'async function runAiPolish()', '// 渲染多对象润色结果');
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
  const controls = new Function('require', '__dirname', read(mainFile) + '\nreturn { unzipScript: UNZIP_SCRIPT, extractDelta: extractDeltaFromSSELine, setPackage: value => { downloadedPackage = value; }, merge: (stage, target, bases) => { const warnings = []; mergeDataTree(stage, target, EXPERIMENTS_DIR, warnings, true, bases); return warnings; } };')(mockedRequire, path.dirname(mainFile));
  ready();
  const authorize = (zip, files, removed, version) => {
    const crypto = require('node:crypto');
    const manifest = { dataVersion: version || '2.0.0', minAppVersion: '1.7.5', url: 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/test.zip', size: fs.statSync(zip).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), files, notes: 'test' };
    if (removed) manifest.removed = removed;
    manifest.signature = crypto.sign(null, Buffer.from(require('../src/main/update-package').canonical(manifest)), testKeys.privateKey).toString('base64');
    controls.setPackage({ path: zip, manifest });
  };
  return { root, handlers, rawHandlers, children, kills, authorize, merge: controls.merge, unzipScript: controls.unzipScript, copied, extractDelta: controls.extractDelta };
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

  // 未推送过名单时：读安装目录的出厂名单（四条初始署名）
  const builtin = read_credits();
  assert.equal(builtin.ok, true);
  assert.deepEqual(builtin.items.map(i => i.name), ['慕寒', '宇宙创生', 'mozhou周言', '怀山']);
  assert.equal(builtin.items[0].contribution, '应用架构');

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
