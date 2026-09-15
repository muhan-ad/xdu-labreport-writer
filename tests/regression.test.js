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
  const controls = new Function('require', '__dirname', read(mainFile) + '\nreturn { unzipScript: UNZIP_SCRIPT, setPackage: value => { downloadedPackage = value; }, merge: (stage, target, bases) => { const warnings = []; mergeDataTree(stage, target, EXPERIMENTS_DIR, warnings, true, bases); return warnings; } };')(mockedRequire, path.dirname(mainFile));
  ready();
  const authorize = (zip, files) => {
    const crypto = require('node:crypto');
    const manifest = { dataVersion: '2.0.0', minAppVersion: '1.7.5', url: 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/test.zip', size: fs.statSync(zip).size,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), files, notes: 'test' };
    manifest.signature = crypto.sign(null, Buffer.from(require('../src/main/update-package').canonical(manifest)), testKeys.privateKey).toString('base64');
    controls.setPackage({ path: zip, manifest });
  };
  return { root, handlers, rawHandlers, children, kills, authorize, merge: controls.merge, unzipScript: controls.unzipScript, copied };
}

test('main process rejects concurrent generation and cleans only the reported Word instance', async t => {
  const h = mainHarness(t);
  const exp = path.join(__dirname, '../物理实验/实验脚本/长度与体积的测量');
  const first = h.handlers.get('run-generate')({}, exp, {}, {}, {});
  const duplicate = await h.handlers.get('run-generate')({}, exp, {}, {}, {});
  assert.equal(duplicate.ok, false);
  assert.equal(h.children.length, 1);
  h.children[0].stdout.write('.LAB_WORD_INSTANCE:555:666\n');
  const cancelled = await h.handlers.get('cancel-generate')();
  const result = await first;
  assert.equal(cancelled.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.deepEqual(JSON.parse(h.kills.find(k => k.exe !== 'taskkill').args[2]), [[555, 666]]);
  assert.equal(h.kills.filter(k => k.exe === 'taskkill').length, 1);
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


test('copy link IPC accepts a share URL and refuses non-HTTPS clipboard payloads', t => {
  const h = mainHarness(t);
  assert.equal(h.handlers.get('copy-link')({}, 'https://pan.quark.cn/s/test').ok, true);
  assert.deepEqual(h.copied, ['https://pan.quark.cn/s/test']);
  assert.equal(h.handlers.get('copy-link')({}, 'file:///C:/private.txt').ok, false);
});
