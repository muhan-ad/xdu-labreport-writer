// main.js — Electron 主进程
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, session, protocol, clipboard, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync, execFile } = require('child_process');
const mammoth = require('mammoth');
const resourceStore = require('./src/main/resource-store');
const { cleanupScript } = require('./src/main/word-process');
const diagnostics = require('./src/main/diagnostics');
const atomic = require('./src/main/atomic-store');
const dataValidation = require('./src/shared/data-validation');
const security = require('./src/main/security');
const network = require('./src/main/network');
const updatePackage = require('./src/main/update-package');
const { createKeyStore } = require('./src/main/key-store');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
// Keep the legacy top-level origin so existing student/settings storage is preserved.
const APP_URL = pathToFileURL(path.join(__dirname, 'src/index.html')).href;
protocol.registerSchemesAsPrivileged([{ scheme: 'labapp', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const keyStore = createKeyStore(app.getPath('userData'), safeStorage);
function handle(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (!security.trustedSender(event, mainWindow?.webContents, APP_URL)) return { ok: false, error: '拒绝不可信的调用来源' };
    try { return fn(event, ...args); } catch (e) { return { ok: false, error: e.message }; }
  });
}
function listen(name, fn) {
  ipcMain.on(name, (event, ...args) => {
    if (security.trustedSender(event, mainWindow?.webContents, APP_URL)) fn(event, ...args);
  });
}


// 生成日志缓冲（导出诊断用）：最近 3 次，每次 60KB
const generationLogBuffer = [];
function pushGenerationLog(entry) {
  const e = { time: new Date().toLocaleString('zh-CN', { hour12: false }), ...entry };
  if (typeof e.logs === 'string' && e.logs.length > 60 * 1024) e.logs = e.logs.slice(-60 * 1024);
  generationLogBuffer.push(e);
  if (generationLogBuffer.length > 3) generationLogBuffer.shift();
}

// ── 生成状态（支持取消）──
let activePython = null;            // 当前正在生成的 python 子进程
let generationBusy = false;
let resourceUpdating = false;

// ── GPU 硬件加速：已恢复启用。此前为省 ~100-160MB 内存而禁用，但软件渲染下
//    CSS 模糊、模态切换、列表/设置滚动会严重掉帧卡顿，流畅优先，故恢复。──

// ── 工具：解析命令对应的可执行文件绝对路径（where.exe 是独立 exe，不依赖 cmd.exe）──
function resolveExe(cmd) {
  try {
    const r = spawnSync('where.exe', [cmd], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout) {
      const lines = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const l of lines) {
        // 排除沙箱/内部运行时路径（应用进程在真实文件系统上，看不到这些路径）
        if (/\.exe$/i.test(l) && fs.existsSync(l)
            && !/sandbox_runtime|connector_runtime|codex-runtimes|\.zcode/i.test(l)) return l;
      }
      for (const l of lines) {
        if (fs.existsSync(l) && !/sandbox_runtime|connector_runtime|codex-runtimes|\.zcode/i.test(l)) return l;
      }
    }
  } catch (e) { /* 忽略 */ }
  return null;
}

// ── 工具：解析真实可用的 python.exe（优先应用自带运行时，其次 Store/常见安装）──
function resolvePythonExe() {
  // 0. 应用自带 Python 运行时（打包后: resources/python-runtime；dev: 项目根/python-runtime）
  const bundled = [
    path.join(process.resourcesPath || '', 'python-runtime', 'python.exe'),
    path.join(__dirname, 'python-runtime', 'python.exe'),
  ];
  for (const p of bundled) {
    if (p && fs.existsSync(p)) return p;
  }
  // 1. Microsoft Store Python（真实文件系统路径，alias 指向已安装的 Python）
  const storePy = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'python.exe');
  if (fs.existsSync(storePy)) return storePy;
  // 2. 常见安装位置
  const dirs = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
    'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310', 'C:\\Python39',
    'C:\\Program Files\\Python313', 'C:\\Program Files\\Python312', 'C:\\Program Files\\Python311',
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      if (/python\.exe$/i.test(dir) && dir.endsWith('python.exe')) return dir;
      for (const sub of fs.readdirSync(dir)) {
        const exe = path.join(dir, sub, 'python.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch (e) { /* 忽略 */ }
  }
  // 3. PATH 兜底（排除沙箱/内部运行时）
  return resolveExe('python');
}

// ── 项目根探测：dev 模式 __dirname 即项目根；打包模式从 app.asar 逐级向上找源目录 ──
// 实验脚本/配置文件必须位于真实可写文件系统（Python 子进程需要访问并写入 docx/xlsx）
// 注意：不能用 fs.existsSync 判断 dev 模式——打包版 files 含物理实验，asar 视角下 existsSync 恒为 true
function findProjectRoot() {
  // 1. dev 模式（npm start）：app.isPackaged 为 false，__dirname 就是项目根
  if (!app.isPackaged) return __dirname;
  // 2. 打包（自包含）：物理实验 与 python-runtime 已作为 extraResources 打进
  //    可写的安装目录 resources/ 下，数据读写都在此处，无需外部源目录。
  const resRoot = process.resourcesPath;
  if (resRoot && fs.existsSync(path.join(resRoot, '物理实验', '实验脚本'))) {
    return resRoot;
  }
  // 3. 兜底（旧行为）：从 asar 向上找磁盘上的源目录
  let dir = path.dirname(__dirname);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '物理实验', '实验脚本'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resRoot || __dirname;
}
const PROJECT_ROOT = findProjectRoot();
const EXPERIMENTS_DIR = path.join(PROJECT_ROOT, '物理实验', '实验脚本');
let mainWindow = null;
// 关闭前未保存提示状态
let isDataDirty = false;
let allowClose = false;

// ── 轻量日志落盘（排查用）：userData/logs/app.log，>1MB 时保留末尾 512KB ──
let logFilePath = null;
function getLogFile() {
  if (logFilePath) return logFilePath;
  try {
    logFilePath = path.join(app.getPath('userData'), 'logs', 'app.log');
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  } catch (e) {
    logFilePath = path.join(PROJECT_ROOT, 'app.log');   // 兜底回安装目录
  }
  return logFilePath;
}
function log(msg) {
  try {
    const file = getLogFile();
    const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}\n`;
    if (fs.existsSync(file)) {
      const st = fs.statSync(file);
      if (st.size > 1024 * 1024) {
        const tail = fs.readFileSync(file, 'utf-8').slice(-512 * 1024);
        atomic.writeFile(file, tail, 'utf-8');
      }
    }
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) { /* 日志失败不影响主功能 */ }
}

// ── 全局异常捕获：只记录，不接管进程生命周期 ──
process.on('uncaughtException', (err) => {
  try { log(`[fatal] uncaughtException: ${String(err && err.stack || err).slice(0, 500)}`); } catch (e) { /* 忽略 */ }
});
process.on('unhandledRejection', (reason) => {
  try { log(`[fatal] unhandledRejection: ${String(reason && reason.stack || reason).slice(0, 500)}`); } catch (e) { /* 忽略 */ }
});
app.on('render-process-gone', (event, webContents, details) => {
  try { log(`[fatal] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`); } catch (e) { /* 忽略 */ }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '实验搭子',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadURL(APP_URL);
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => { mainWindow = null; });

  // 关闭前提示未保存的数据
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    if (!isDataDirty) {
      if (generationBusy || resourceUpdating || activeDataReq || aiAbortControllers.size || activeUploads.size) {
        e.preventDefault(); app.quit();
      }
      return;
    }
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: '未保存的修改',
      message: '当前实验有未保存的测量数据',
      detail: '关闭应用将丢失未保存的修改。',
      buttons: ['取消', '保存后退出', '直接退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) {
      // 保存后退出：通知渲染进程保存，保存成功后由渲染进程确认关闭
      mainWindow.webContents.send('app-save-and-close');
    } else if (choice === 2) {
      // 直接退出
      allowClose = true;
      mainWindow.close();
    }
  });
}

// ── IPC: 未保存数据状态 / 确认关闭 ──
listen('data-modified', (_, dirty) => {
  isDataDirty = !!dirty;});

// ── IPC: 渲染进程事件转发到日志 ──
listen('log-event', (_, msg) => {
  log(`[renderer] ${msg}`);
});

listen('app-confirm-close', () => {
  allowClose = true;
  if (mainWindow) mainWindow.close();
});

if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
app.whenReady().then(() => {
  log(`app started | packaged=${app.isPackaged} | PROJECT_ROOT=${PROJECT_ROOT} | EXPERIMENTS_DIR=${EXPERIMENTS_DIR}`);
  protocol.handle('labapp', request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('', { status: 403 });
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (relative.startsWith('main/') || !/\.(html|js|css|png|ico|mp3)$/i.test(relative)) return new Response('', { status: 403 });
      const file = security.inside(path.join(__dirname, 'src', relative), path.join(__dirname, 'src'));
      return electronNet.fetch(pathToFileURL(file).href);
    } catch (_) { return new Response('', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', event => {
  if (quitting || !(generationBusy || resourceUpdating || activeDataReq || aiAbortControllers.size || activeUploads.size)) return;
  event.preventDefault();
  quitting = true;
  activeDataReq?.abort();
  for (const controller of aiAbortControllers.values()) controller.abort();
  for (const controller of activeUploads) controller.abort();
  (async () => {
    await cancelGeneration();
    // Atomic resource replacement is synchronous; extraction is bounded and must finish before exit.
    while (resourceUpdating) await new Promise(resolve => setTimeout(resolve, 100));
    allowClose = true; app.quit();
  })().catch(e => { log('退出清理失败：' + e.message); quitting = false; });
});

// ── 实验数据目录（热更新支持）──
// 数据包下载解压到 userData，扫描时 userData 有有效清单则优先于安装目录（同名实验以 userData 为准）
// ── 用户自建变体库（userData/自建变体/<实验名>.json，结构与 variants.json 同构）──
function getCustomVariantsDir() {
  const dir = path.join(app.getPath('userData'), '自建变体');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 忽略 */ }
  return dir;
}

// 自建变体库认可的标准章节名（"实验结论"兼容 26 个实验中的键名差异）
const CUSTOM_SECTION_NAMES = ['实验原理', '实验方法', '误差分析', '结论', '实验结论'];

// 实验名 → 自建库文件绝对路径；非法名返回 null
function customVariantPathFor(expId) {
  const name = String(expId || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
  if (!name || name === '.' || name === '..') return null;
  return path.join(getCustomVariantsDir(), name + '.json');
}

function readCustomVariantsFile(expId) {
  const p = customVariantPathFor(expId);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const v = atomic.readJson(p);
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    return null;
  }
}

function hasCustomVariantsFor(expId) {
  const v = readCustomVariantsFile(expId);
  if (!v) return false;
  return CUSTOM_SECTION_NAMES.some(s => Array.isArray(v[s]) && v[s].length > 0);
}

function getDataRoots() {
  const udRoot = path.join(app.getPath('userData'), '实验数据', '实验脚本');
  const mfPath = path.join(app.getPath('userData'), '实验数据', 'data-manifest.json');
  // userData 根无条件激活：安装目录为只读出厂数据，用户的实验数据/报告一律落 userData
  resourceStore.recoverTree(udRoot);
  try { fs.mkdirSync(udRoot, { recursive: true }); } catch (e) { /* 忽略 */ }
  const roots = [];
  if (fs.existsSync(udRoot)) {
    roots.push({ dir: udRoot, source: 'userData' });
  }
  if (fs.existsSync(EXPERIMENTS_DIR)) {
    roots.push({ dir: EXPERIMENTS_DIR, source: 'builtin' });
  }
  return { roots, udRoot, mfPath };
}

// 递归复制目录（源/目标各受独立根边界约束）
function copyDirTo(src, dest, srcRoot, destRoot) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = ensureInside(path.join(src, f), srcRoot);
    const d = ensureInside(path.join(dest, f), destRoot);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDirTo(s, d, srcRoot, destRoot);
    else fs.copyFileSync(s, d);
  }
}

let builtinFingerprint = null;

function syncInstalledResources() {
  if (resourceUpdating || generationBusy) return;
  if (!fs.existsSync(EXPERIMENTS_DIR)) return;
  if (!builtinFingerprint) builtinFingerprint = resourceStore.resourceVersion(EXPERIMENTS_DIR);
  const { udRoot } = getDataRoots();
  resourceStore.syncBuiltin(EXPERIMENTS_DIR, udRoot, builtinFingerprint, app.getVersion());
}

// 用户数据隔离：写操作前若实验目录仍在安装目录（builtin），先镜像/同步到 userData 并返回新路径。
// - userData 无该实验：整目录镜像（含 data.json/variants.json 出厂值）
// - 已有副本：按热更新合并语义刷新（data.json 与用户改过的 variants.json 永不覆盖、报告 docx 不动）
// - 安装资源指纹变化时迁移公共库和现有实验，保持用户数据与自建内容
function ensureUserCopy(expPath) {
    if (resourceUpdating) throw new Error('实验资源更新中，请稍后重试');
    syncInstalledResources();
    const p = experimentPath(expPath);
    const builtinRoot = path.resolve(EXPERIMENTS_DIR);
    const { udRoot } = getDataRoots();
    const udRootRes = path.resolve(udRoot);
    if (!fs.existsSync(builtinRoot)) throw Error('内置实验资源缺失');
    if (p.startsWith(udRootRes + path.sep)) return p;          // 已在 userData
    if (!p.startsWith(builtinRoot + path.sep)) throw new Error('无效的实验目录');
    const name = path.relative(builtinRoot, p).split(path.sep).shift();
    if (!name || name === 'common' || name.startsWith('.')) return p;
    const src = ensureInside(path.join(builtinRoot, name), builtinRoot);
    if (!fs.existsSync(src)) return p;
    const dst = ensureInside(path.join(udRootRes, name), udRootRes);
    if (!fs.existsSync(dst)) {
      resourceStore.replaceTree(dst, candidate => copyDirTo(src, candidate, builtinRoot, candidate));
    }
    return dst;
}

function experimentPath(raw) {
  if (typeof raw !== 'string') throw Error('无效实验路径');
  const p = path.resolve(raw);
  const root = getDataRoots().roots.find(r => path.dirname(p).toLowerCase() === path.resolve(r.dir).toLowerCase());
  if (!root || path.basename(p).startsWith('.') || path.basename(p) === 'common') throw Error('未知实验目录');
  security.inside(p, root.dir);
  if (!fs.existsSync(path.join(p, 'generate.py'))) throw Error('实验入口不存在');
  return p;
}
function reportPath(raw) {
  if (typeof raw !== 'string' || !/\.docx$/i.test(raw)) throw Error('只允许访问实验报告 DOCX');
  const p = path.resolve(raw);
  experimentPath(path.dirname(p));
  security.inside(p, path.dirname(p));
  const st = fs.statSync(p);
  if (!st.isFile() || st.size > 32 * 1024 * 1024) throw Error('报告不存在或超过 32MB');
  return p;
}

function scanDirEntry(d, source) {
  const expPath = path.join(d.dir, d.name);
  const generatePy = security.inside(path.join(expPath, 'generate.py'), expPath);
  const errors = dataValidation.validate(atomic.readJson(security.inside(path.join(expPath, 'schema.json'), expPath)),
    atomic.readJson(security.inside(path.join(expPath, 'data.json'), expPath)));
  if (errors.length) throw Error(errors.join('；'));
  if (!fs.existsSync(generatePy)) return null;
  const files = fs.readdirSync(expPath);
  const hasDataJson = files.includes('data.json');
  const hasSchemaJson = files.includes('schema.json');
  const docx = files.find(f => f.endsWith('.docx') && !f.startsWith('~$') && !f.includes('.~saving'));
  return {
    id: d.name,
    name: d.name,
    path: expPath,
    hasData: hasDataJson || hasSchemaJson,
    hasReport: !!docx,
    dataFile: hasDataJson
      ? security.inside(path.join(expPath, 'data.json'), expPath)
      : (hasSchemaJson ? security.inside(path.join(expPath, 'schema.json'), expPath) : null),
    reportFile: docx ? path.join(expPath, docx) : null,
    source,
    hasCustomVariants: hasCustomVariantsFor(d.name),
  };
}

// ── IPC: 扫描实验列表 ──
handle('scan-experiments', () => {
  syncInstalledResources();
  const { roots } = getDataRoots();
  const results = [];
  const seen = new Set();
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root.dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === 'common' || d.name.startsWith('.') || seen.has(d.name)) continue;
      const entry = scanDirEntry({ dir: root.dir, name: d.name }, root.source);
      if (entry) { seen.add(d.name); results.push(entry); }
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return results;
});

// ── IPC: 窗口控制 ──
listen('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
listen('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
listen('window-close', () => { if (mainWindow) mainWindow.close(); });

// ── IPC: 读取 schema.json（方式三：表单模式）──
handle('read-schema', (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, 'schema.json'), expPath);
    if (!fs.existsSync(p)) return { ok: true, schema: null };
    return { ok: true, schema: atomic.readJson(p) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取 sample.json（内置测试数据快照，供「填入默认数据」恢复）──
handle('read-sample-data', (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, 'sample.json'), expPath);
    if (!fs.existsSync(p)) return { ok: true, data: null };
    return { ok: true, data: atomic.readJson(p) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取 data.json（方式三：表单数据真相）──
handle('read-data', (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, 'data.json'), expPath);
    if (!fs.existsSync(p)) return { ok: true, data: null };
    return { ok: true, data: atomic.readJson(p) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 写入 data.json（方式三：保存表单数据；用户数据落 userData 副本）──
handle('write-data', (_, expPath, data) => {
  try {
    const p = ensureUserCopy(expPath);
    if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) throw Error('测量数据过大');
    const schema = atomic.readJson(security.inside(path.join(p, 'schema.json'), p));
    const errors = dataValidation.validate(schema, data, false);
    if (errors.length) throw Error(errors.join('；'));
    atomic.writeFile(security.inside(path.join(p, 'data.json'), p), JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: p, dataFile: security.inside(path.join(p, 'data.json'), p) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取章节原文缓存（AI 按章节润色的数据源，由 run-generate 落盘）──
handle('read-sections', (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, '.lab_sections.json'), expPath);
    if (!fs.existsSync(p)) return { ok: true, sections: null };
    return { ok: true, sections: atomic.readJson(p) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: AI 润色技能文件管理（userData/skills，导入外部开源 Skill 文件）──
function getSkillsDir() {
  const dir = path.join(app.getPath('userData'), 'skills');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 忽略 */ }
  return dir;
}

// 解析 SKILL.md frontmatter（--- name/description ---）；无 frontmatter 时用文件名兜底
function parseSkillMeta(text, fallbackName) {
  let name = fallbackName, description = '', body = text;
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = String(line).match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      const v = kv[2].trim().replace(/^["']|["']$/g, '');
      if (k === 'name' && v) name = v;
      else if (k === 'description' && v) description = v;
    }
  }
  return { name, description, body: body.trim() };
}

handle('list-skills', () => {
  try {
    const dir = getSkillsDir();
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(md|markdown|txt)$/i.test(f)) continue;
      try {
        const meta = parseSkillMeta(fs.readFileSync(path.join(dir, f), 'utf-8'), path.basename(f, path.extname(f)));
        out.push({ id: f, name: meta.name, description: meta.description, content: meta.body });
      } catch (e) { /* 跳过损坏文件 */ }
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    return { ok: true, skills: out, dir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('import-skill', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入 Skill 文件',
      filters: [{ name: 'Skill 文件', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile', 'multiSelection'],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: true, imported: [], errors: [] };
    const dir = getSkillsDir();
    const imported = [];
    const errors = [];
    for (const src of filePaths) {
      try {
        const text = fs.readFileSync(src, 'utf-8');
        const meta = parseSkillMeta(text, path.basename(src, path.extname(src)));
        // 目标文件名：用技能名净化生成，重名自动加序号，不覆盖已有技能
        const base = (String(meta.name).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'skill').slice(0, 60);
        let target = base + '.md';
        let dup = 2;
        while (fs.existsSync(path.join(dir, target))) {
          target = base + '-' + dup + '.md';
          dup += 1;
        }
        fs.copyFileSync(src, path.join(dir, target));
        imported.push(meta.name);
      } catch (e) {
        errors.push(path.basename(src) + ': ' + e.message);
      }
    }
    return { ok: true, imported, errors };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 删除技能：仅允许技能文件夹内、扩展名合法的文件（拒绝路径分隔符与上级引用）
handle('delete-skill', (_, id) => {
  try {
    const dir = path.resolve(getSkillsDir());
    if (typeof id !== 'string' || !id || id.includes('..') || /[\\/]/.test(id)) {
      return { ok: false, error: '无效的技能标识' };
    }
    const p = path.resolve(dir, id);
    if (!p.startsWith(dir + path.sep) || !/\.(md|markdown|txt)$/i.test(p)) {
      return { ok: false, error: '仅允许删除技能文件夹内的技能文件' };
    }
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════
// 用户自建变体库（userData/自建变体，独立于实验目录与数据热更新）
// ═══════════════════════════════════════════════

// 列出所有有自建变体的实验
handle('list-custom-variants', () => {
  try {
    const dir = getCustomVariantsDir();
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const expId = f.slice(0, -5);
      const v = readCustomVariantsFile(expId);
      if (!v) continue;
      const sections = {};
      let count = 0;
      for (const s of CUSTOM_SECTION_NAMES) {
        if (Array.isArray(v[s]) && v[s].length) {
          sections[s] = v[s].length;
          count += v[s].length;
        }
      }
      if (count > 0) out.push({ expId, sections, count });
    }
    out.sort((a, b) => a.expId.localeCompare(b.expId, 'zh'));
    return { ok: true, list: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 读取某实验的自建变体（结构与 variants.json 同构）
handle('read-custom-variants', (_, expId) => {
  try {
    const v = readCustomVariantsFile(expId);
    return { ok: true, data: v };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 新增一条自建变体（同文本去重）
handle('save-custom-variant', (_, expId, section, text) => {
  try {
    if (!CUSTOM_SECTION_NAMES.includes(section)) return { ok: false, error: '无效的章节名' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '变体文本为空' };
    const p = customVariantPathFor(expId);
    if (!p) return { ok: false, error: '无效的实验名' };
    const v = readCustomVariantsFile(expId) || {};
    const arr = Array.isArray(v[section]) ? v[section] : [];
    if (!arr.includes(text)) arr.push(text);
    v[section] = arr;
    atomic.writeFile(p, JSON.stringify(v, null, 1), 'utf-8');
    return { ok: true, total: arr.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 删除一条自建变体；章节清空删键、文件清空删除
handle('delete-custom-variant', (_, expId, section, index) => {
  try {
    if (!CUSTOM_SECTION_NAMES.includes(section)) return { ok: false, error: '无效的章节名' };
    const p = customVariantPathFor(expId);
    if (!p) return { ok: false, error: '无效的实验名' };
    const v = readCustomVariantsFile(expId);
    if (!v) return { ok: true };
    const arr = Array.isArray(v[section]) ? v[section] : [];
    if (typeof index !== 'number' || index < 0 || index >= arr.length) {
      return { ok: false, error: '无效的变体序号' };
    }
    const text = arr[index];
    arr.splice(index, 1);
    if (arr.length) v[section] = arr; else delete v[section];
    const anyLeft = Object.values(v).some(a => Array.isArray(a) && a.length);
    if (anyLeft) atomic.writeFile(p, JSON.stringify(v, null, 1), 'utf-8');
    else if (fs.existsSync(p)) fs.unlinkSync(p);
    // 联动清理：删除自建库条目的同时，把该实验 variants.json 中同章节的同文本条目一并移除
    // （保存自建变体时实验里也追加了一份，库删了实验里不应残留“生成后的变体”）
    if (typeof text === 'string' && text) {
      try {
        const { roots } = getDataRoots();
        let expDir = null;
        for (const r of roots) {
          const cand = path.join(r.dir, expId);
          if (fs.existsSync(path.join(cand, 'variants.json'))) { expDir = cand; break; }
        }
        if (expDir) {
          const work = ensureUserCopy(expDir);
          const vp = path.join(work, 'variants.json');
          const ev = JSON.parse(fs.readFileSync(vp, 'utf-8'));
          const cur = Array.isArray(ev[section]) ? ev[section] : [];
          const rmIdx = cur.indexOf(text);
          if (rmIdx >= 0) {
            cur.splice(rmIdx, 1);
            if (cur.length) ev[section] = cur; else delete ev[section];
            atomic.writeFile(vp, JSON.stringify(ev, null, 1), 'utf-8');
          }
        }
      } catch (e) { /* 联动清理失败不阻塞库删除 */ }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 导出：单实验（save 对话框）或全部（选文件夹逐实验写 自建变体_<实验名>.json）
handle('export-custom-variants', async (_, payload) => {
  try {
    const exportAll = !!(payload && payload.exportAll);
    const dir = getCustomVariantsDir();
    let targetIds = [];
    if (exportAll) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const expId = f.slice(0, -5);
        if (hasCustomVariantsFor(expId)) targetIds.push(expId);
      }
    } else {
      const one = String((payload && payload.expId) || '');
      if (one && hasCustomVariantsFor(one)) targetIds = [one];
    }
    if (!targetIds.length) {
      return { ok: false, error: exportAll ? '自建变体库为空' : '该实验没有自建变体' };
    }
    if (exportAll) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: '选择存放自建变体的文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (canceled || !filePaths || !filePaths.length) return { ok: true, canceled: true, count: 0 };
      const destDir = filePaths[0];
      let n = 0;
      const errors = [];
      for (const eid of targetIds) {
        try {
          fs.copyFileSync(path.join(dir, eid + '.json'), path.join(destDir, '自建变体_' + eid + '.json'));
          n += 1;
        } catch (e) {
          errors.push(eid + ': ' + e.message);
        }
      }
      return { ok: true, canceled: false, count: n, errors };
    }
    const expId = targetIds[0];
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出自建变体',
      defaultPath: path.join(app.getPath('documents'), '自建变体_' + expId + '.json'),
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: true, canceled: true };
    const v = readCustomVariantsFile(expId);
    if (!v) return { ok: false, error: '读取自建变体失败' };
    atomic.writeFile(filePath, JSON.stringify(v, null, 1), 'utf-8');
    return { ok: true, canceled: false, count: 1 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 导入（批量）：多选 .json，文件名取实验名（前导「自建变体_」自动剥离），结构校验后合并去重
handle('import-custom-variants', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入自建变体文件（可多选批量导入）',
      filters: [{ name: '自建变体 JSON', extensions: ['json'] }],
      properties: ['openFile', 'multiSelection'],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: true, imported: [], errors: [] };
    // 已安装的全部实验名（内置 + userData 双根）
    const known = new Set();
    const { roots } = getDataRoots();
    for (const r of roots) {
      try {
        for (const dEntry of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (dEntry.isDirectory() && dEntry.name !== 'common' && !dEntry.name.startsWith('.')) known.add(dEntry.name);
        }
      } catch (e) { /* 忽略 */ }
    }
    const imported = [];
    const errors = [];
    for (const src of filePaths) {
      try {
        let expId = path.basename(src, path.extname(src));
        if (expId.startsWith('自建变体_')) expId = expId.slice('自建变体_'.length);
        if (!known.has(expId)) {
          errors.push(path.basename(src) + ': 未找到匹配实验「' + expId + '」');
          continue;
        }
        const v = JSON.parse(fs.readFileSync(src, 'utf-8'));
        if (!v || typeof v !== 'object') {
          errors.push(path.basename(src) + ': 文件结构无效');
          continue;
        }
        const existing = readCustomVariantsFile(expId) || {};
        let added = 0;
        for (const [section, texts] of Object.entries(v)) {
          if (!CUSTOM_SECTION_NAMES.includes(section)) continue;
          if (!Array.isArray(texts)) continue;
          const arr = Array.isArray(existing[section]) ? existing[section] : [];
          for (const t of texts) {
            if (typeof t === 'string' && t.trim() && !arr.includes(t)) { arr.push(t); added += 1; }
          }
          if (arr.length) existing[section] = arr;
        }
        if (!added) {
          errors.push(path.basename(src) + ': 无新增条目（内容已存在或为空）');
          continue;
        }
        const p = customVariantPathFor(expId);
        if (!p) {
          errors.push(path.basename(src) + ': 无效的实验名');
          continue;
        }
        atomic.writeFile(p, JSON.stringify(existing, null, 1), 'utf-8');
        imported.push(expId);
      } catch (e) {
        errors.push(path.basename(src) + ': ' + e.message);
      }
    }
    return { ok: true, imported, errors };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('open-skills-folder', () => {
  const dir = getSkillsDir();
  shell.openPath(dir);
  return { ok: true, dir };
});

// ── IPC: 报告管理（设置页）──
// 列出全部实验目录下已生成的 .docx（含大小/修改时间），按时间倒序
handle('list-reports', () => {
  const out = [];
  try {
    const { roots } = getDataRoots();
    if (!roots.length) return { ok: true, reports: out };
    const seen = new Set();
    for (const root of roots) {
      if (root.source === 'userData') {
        // userData 优先：与其同名的实验直接跳过安装目录版本，避免重复
        for (const d of fs.readdirSync(root.dir, { withFileTypes: true })) {
          if (d.isDirectory()) seen.add(d.name);
        }
      }
      let dirs = [];
      try { dirs = fs.readdirSync(root.dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const d of dirs) {
        if (!d.isDirectory() || d.name === 'common' || d.name.startsWith('.')) continue;
        if (root.source === 'builtin' && seen.has(d.name)) continue;
        const expPath = path.join(root.dir, d.name);
        let files;
        try { files = fs.readdirSync(expPath); } catch (e) { continue; }
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.docx') || f.startsWith('~$') || f.includes('.~saving')) continue;
          try {
            const st = fs.statSync(path.join(expPath, f));
            out.push({ exp: d.name, file: f, path: path.join(expPath, f), size: st.size, mtime: st.mtimeMs });
          } catch (e) { /* 单个文件异常跳过 */ }
        }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return { ok: true, reports: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 删除报告：仅允许删除实验目录之内的 .docx（规范化路径并校验包含关系）
handle('delete-report', (_, filePath) => {
  try {
    filePath = reportPath(filePath);
    if (typeof filePath !== 'string' || !filePath) return { ok: false, error: '无效路径' };
    const p = path.resolve(filePath);
    const { roots } = getDataRoots();
    if (!p.toLowerCase().endsWith('.docx')) return { ok: false, error: '仅允许删除 .docx 报告' };
    const inside = roots.some(r => {
      const root = path.resolve(r.dir);
      return p !== root && p.startsWith(root + path.sep);
    });
    if (!inside) return { ok: false, error: '仅允许删除实验目录内的报告' };
    if (!fs.existsSync(p)) return { ok: true, alreadyGone: true };
    fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 在资源管理器中定位文件
handle('show-in-folder', (_, filePath) => {
  try {
    filePath = reportPath(filePath);
    if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取实验知识库(原理) —— AI 润色限定依据 ──
handle('read-rag', (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, 'rag', '原理.md'), expPath);
    if (!fs.existsSync(p)) return { ok: true, text: null };
    return { ok: true, text: fs.readFileSync(p, 'utf-8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: docx 转 HTML（用于报告预览/文本提取）──
handle('docx-to-html', async (_, filePath) => {
  try {
    filePath = reportPath(filePath);
    if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在' };
    const result = await mammoth.convertToHtml({ path: filePath });
    return { ok: true, html: security.cleanHtml(result.value), messages: result.messages };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取 docx 为 Buffer（用于 docx-preview 渲染）──
handle('read-docx-buffer', (_, filePath) => {
  try {
    filePath = reportPath(filePath);
    if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在' };
    const buffer = fs.readFileSync(filePath);
    return { ok: true, buffer: buffer.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 读取内置音频（src/ 下随包分发，任何环境均可播放）──
handle('read-audio-file', () => {
  try {
    const filePath = path.join(__dirname, 'src', 'do-not-click.mp3');
    if (!fs.existsSync(filePath)) return { ok: false, error: '音频文件不存在' };
    const buffer = fs.readFileSync(filePath);
    return { ok: true, mime: 'audio/mpeg', data: buffer.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════
// 实验数据热更新（COS 数据包 → userData，免重装）
// ═══════════════════════════════════════════════
const DATA_MANIFEST_URL = 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/data-manifest.json';
// 内置实验数据版本（未应用任何数据包时的基准版本，独立于应用版本号）
const DATA_BUILTIN_VERSION = '1.0.0';
let approvedManifest = null;
let downloadedPackage = null;

function readLocalDataManifest() {
  try {
    const state = resourceStore.readState(getDataRoots().udRoot);
    if (Object.hasOwn(state, 'manifest')) return state.manifest;
    return JSON.parse(fs.readFileSync(getDataRoots().mfPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// 路径边界断言：p 必须位于 root 内
function ensureInside(p, root) { return security.inside(p, root); }

// ── IPC: 实验数据版本信息（本地）
handle('get-data-info', () => {
  const mf = readLocalDataManifest();
  return {
    ok: true,
    localVersion: (mf && mf.dataVersion) || null,   // 无热更新数据时为空，即内置版本
    notes: (mf && mf.notes) || '',
    updatedAt: (mf && mf.updatedAt) || null,
    builtinVersion: DATA_BUILTIN_VERSION,
  };
});

// ── IPC: 检查实验数据更新（远端 data-manifest.json）
handle('check-data-update', async () => {
  const t0 = Date.now();
  approvedManifest = null;
  try {
    const u = assertPublicUrl(DATA_MANIFEST_URL);
    if (!(await checkPublicDns(u.hostname))) throw new Error('更新地址无法解析或指向本地地址');
    let mf;
    try {
      mf = await httpsGetJson(u.href);
    } catch (e) {
      // 云端尚未发布任何数据包（404）：视为已是最新，而非报错
      if (/HTTP 404/.test(e.message)) {
        log(`data-update | 远端无清单(404) | ${Date.now() - t0}ms`);
        const local = readLocalDataManifest();
        return {
          ok: true,
          hasUpdate: false,
          noRemote: true,
          localVersion: local ? String(local.dataVersion).replace(/^v/i, '') : DATA_BUILTIN_VERSION,
          remoteVersion: '',
        };
      }
      throw e;
    }
    const remote = String(mf.dataVersion || '').replace(/^v/i, '');
    const local = readLocalDataManifest();
    const localVer = local ? String(local.dataVersion).replace(/^v/i, '') : DATA_BUILTIN_VERSION;
    const hasUpdate = !!(remote && updatePackage.compare(remote, localVer) > 0);
    if (hasUpdate) approvedManifest = updatePackage.verify(mf,
      fs.readFileSync(path.join(__dirname, 'src/update-public-key.pem')), app.getVersion(), localVer, new URL(DATA_MANIFEST_URL).hostname);
    log(`data-update | 检查完成 | 本地=${localVer} 远端=${remote || '无'} 可更新=${hasUpdate} | ${Date.now() - t0}ms`);
    return {
      ok: true,
      hasUpdate,
      localVersion: localVer,
      remoteVersion: remote,
      notes: String(mf.notes || '').trim(),
      url: String(mf.url || '').trim(),
    };
  } catch (err) {
    log(`data-update | 检查失败 | ${err.message} | ${Date.now() - t0}ms`);
    return { ok: false, error: err.message, hasUpdate: false };
  }
});

// ── IPC: 下载实验数据包（zip，进度经 'data-update-progress' 回传）
let activeDataReq = null;
handle('download-data-package', async (event, payload) => {
  if (activeDataReq || resourceUpdating) return { ok: false, error: '更新任务正在运行' };
  if (!approvedManifest || payload?.url !== approvedManifest.url) return { ok: false, error: '请先检查并验证更新清单' };
  const manifest = JSON.parse(JSON.stringify(approvedManifest));
  const dir = path.join(app.getPath('userData'), '实验数据');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'package-' + crypto.randomUUID() + '.zip');
  const controller = new AbortController(); activeDataReq = controller;
  downloadedPackage = null;
  try {
    await network.download(manifest.url, dest, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      expectedSize: manifest.size, maxBytes: updatePackage.MAX_PACKAGE, allowedHost: new URL(DATA_MANIFEST_URL).hostname,
      progress: percent => event.sender.send('data-update-progress', { percent }) });
    if (updatePackage.hashFile(dest) !== manifest.sha256) throw Error('更新包摘要不匹配');
    downloadedPackage = { path: dest, manifest };
    return { ok: true, filePath: dest };
  } catch (e) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return { ok: false, error: e.message };
  } finally { if (activeDataReq === controller) activeDataReq = null; }
});
listen('cancel-data-download', () => activeDataReq?.abort());

// 用内置 Python 安全解压 zip（条目路径校验防 zip-slip）
const UNZIP_SCRIPT = [
  'import sys, zipfile, pathlib, stat',
  'z, dest = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()',
  'with zipfile.ZipFile(z) as zf:',
  '    entries = zf.infolist()',
  '    if len(entries) > 4096 or sum(i.file_size for i in entries) > 256*1024*1024: raise ValueError("archive too large")',
  '    seen = set()',
  '    for i in entries:',
  "        n = i.filename.replace(chr(92), '/')",
  "        if ':' in n or n.startswith('/') or any(x in ('.', '..') for x in n.split('/')): raise ValueError('bad path')",
  "        if n.lower() in seen: raise ValueError('duplicate path')",
  '        seen.add(n.lower())',
  "        if stat.S_ISLNK(i.external_attr >> 16) or i.file_size > 32*1024*1024 or i.file_size > max(i.compress_size,1)*500: raise ValueError('unsafe entry')",
  "        if not (dest / n).resolve().is_relative_to(dest): raise ValueError('path escape')",
  '    zf.extractall(dest)',
].join('\n');

function unzipSafe(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const pythonExe = resolvePythonExe() || 'python';
    if (!pythonExe) return reject(new Error('未找到内置 Python 运行时'));
    const proc = spawn(pythonExe, ['-c', UNZIP_SCRIPT, zipPath, destDir], { windowsHide: true, timeout: 60000 });
    let errOut = '';
    proc.stderr.on('data', (d) => { errOut = (errOut + d.toString()).slice(-4096); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('解压失败：' + errOut.trim().slice(-300)));
    });
  });
}

function copyDir(src, dest, boundRoot) {
  ensureInside(src, boundRoot);
  ensureInside(dest, boundRoot);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = ensureInside(path.join(src, name), boundRoot);
    const d = ensureInside(path.join(dest, name), boundRoot);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, boundRoot);
    else fs.copyFileSync(s, d);
  }
}

// 跨根复制：源按 srcRoot 校验、目标按 destRoot 校验（更新包 staging → 用户数据目录）
function copyDirAcross(src, srcRoot, dest, destRoot) {
  ensureInside(src, srcRoot);
  ensureInside(dest, destRoot);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = ensureInside(path.join(src, name), srcRoot);
    const d = ensureInside(path.join(dest, name), destRoot);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDirAcross(s, srcRoot, d, destRoot);
    else fs.copyFileSync(s, d);
  }
}

// 递归合并数据包目录到 userData：data.json 永不覆盖；variants.json 用户改过则保留
// skipDocs=true 时跳过 .docx（供 ensureUserCopy 使用，避免安装目录残留报告覆盖用户报告）
function mergeDataTree(stagingDir, udRoot, builtinRoot, warnings, skipDocs, bases = {}, relative = '') {
  if (!fs.existsSync(stagingDir)) return;
  for (const entry of fs.readdirSync(stagingDir)) {
    const src = ensureInside(path.join(stagingDir, entry), stagingDir);
    const st = fs.statSync(src);
    if (skipDocs && st.isFile() && entry.toLowerCase().endsWith('.docx')) continue;
    const dst = ensureInside(path.join(udRoot, entry), udRoot);
    if (st.isDirectory()) {
      if (entry === 'common') {
        // This merge runs only against the transaction's candidate tree.
        fs.rmSync(dst, { recursive: true, force: true });
        copyDirAcross(src, stagingDir, dst, udRoot);
        continue;
      }
      // 实验目录：先合并文件
      fs.mkdirSync(dst, { recursive: true });
      mergeDataTree(src, dst, path.join(builtinRoot, entry), warnings, skipDocs, bases, path.join(relative, entry));
      // data.json 保障：userData 无而安装目录有时，复制安装目录的用户数据
      const bd = ensureInside(path.join(builtinRoot, entry, 'data.json'), EXPERIMENTS_DIR);
      const dd = ensureInside(path.join(dst, 'data.json'), udRoot);
      if (fs.existsSync(bd) && !fs.existsSync(dd)) {
        fs.copyFileSync(bd, dd);
      }
    } else {
      const name = entry;
      const dstExists = fs.existsSync(dst);
      if (name === 'data.json') {
        if (!dstExists) fs.copyFileSync(src, dst);   // 新实验示例数据允许落盘；已有用户数据永不覆盖
        continue;
      }
      if (name === 'variants.json' && dstExists) {
        // 用户本地改过（与安装目录原版不同）则保留用户版
        const builtinV = ensureInside(path.join(builtinRoot, name), EXPERIMENTS_DIR);
        let userModified = false;
        try {
          const a = bases[path.join(relative, name)] ?? fs.readFileSync(builtinV, 'utf-8');
          const b = fs.readFileSync(dst, 'utf-8');
          userModified = a !== b;
        } catch (e) {
          userModified = true;
        }
        if (userModified) {
          warnings.push(`${entry.replace('.json', '')} 的变体已由用户修改，保留本地版本`);
          continue;
        }
      }
      fs.copyFileSync(src, dst);
    }
  }
}

// ── IPC: 应用数据包（解压 + 合并到 userData + 写 manifest）
handle('apply-data-package', async (_, payload) => {
  if (generationBusy || resourceUpdating) return { ok: false, error: '报告生成或资源更新中，请稍后重试' };
  syncInstalledResources();
  resourceUpdating = true;
  const t0 = Date.now();
  try {
    const zipPath = String((payload && payload.filePath) || '');
    if (!downloadedPackage || downloadedPackage.path !== zipPath) throw Error('请先下载已验证的更新包');
    const manifest = downloadedPackage.manifest;
    const version = manifest.dataVersion, notes = manifest.notes || '';
    updatePackage.verify(manifest, fs.readFileSync(path.join(__dirname, 'src/update-public-key.pem')),
      app.getVersion(), readLocalDataManifest()?.dataVersion || DATA_BUILTIN_VERSION, new URL(DATA_MANIFEST_URL).hostname);
    if (fs.statSync(zipPath).size !== manifest.size || updatePackage.hashFile(zipPath) !== manifest.sha256) throw Error('下载文件已变化');
    log(`data-package | 开始应用 v${version}`);
    if (!/\.zip$/i.test(path.basename(zipPath))) return { ok: false, error: '数据包应为 zip 文件' };
    const dataRoot = path.join(app.getPath('userData'), '实验数据');
    if (!ensureInside(zipPath, dataRoot)) return { ok: false, error: '无效的数据包路径' };
    if (!fs.existsSync(zipPath)) return { ok: false, error: '数据包文件不存在' };
    const { udRoot, mfPath } = getDataRoots();
    const staging = ensureInside(path.join(dataRoot, '_staging'), dataRoot);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await unzipSafe(zipPath, staging);
    updatePackage.verifyTree(staging, manifest);
    // 包内结构约定：zip 内直接是 实验脚本 树（本目录开头）
    const warnings = [];
    const stagingRoot = fs.existsSync(path.join(staging, '实验脚本'))
      ? path.join(staging, '实验脚本')
      : staging;
    const backupPath = resourceStore.replaceTree(udRoot, candidate => {
      const state = resourceStore.readState(candidate);
      mergeDataTree(stagingRoot, candidate, EXPERIMENTS_DIR, warnings, true, state.variantBases || {});
      const bases = { ...(state.variantBases || {}) };
      for (const file of Object.keys(manifest.files)) {
        const rel = file.replace(/^实验脚本\//, '');
        if (path.basename(rel) === 'variants.json') bases[rel.split('/').join(path.sep)] = fs.readFileSync(path.join(staging, file), 'utf8');
      }
      state.variantBases = bases;
      resourceStore.writeState(candidate, { ...state, manifest: {
        dataVersion: version, notes, updatedAt: new Date().toISOString(),
      } });
    });
    downloadedPackage = null;
    approvedManifest = null;
    // 清理
    fs.rmSync(staging, { recursive: true, force: true });
    try { fs.unlinkSync(zipPath); } catch (e) { /* 忽略 */ }
    log(`data-package | 应用完成 v${version} | ${Date.now() - t0}ms`);
    return { ok: true, warnings, backupPath };
  } catch (err) {
    log(`data-package | 应用失败 | ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    resourceUpdating = false;
  }
});

// ═══════════════════════════════════════════════
// 检查更新（Gitee Release / 自定义清单，国内用户高速可达）
// ═══════════════════════════════════════════════
const https = require('https');
const dns = require('dns');

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 拒绝 localhost / 环回 / 私有 / 链路本地 / 组播 / 保留地址，只允许公网主机
const isBlockedHost = network.blocked;
const assertPublicUrl = network.publicUrl;
function checkPublicDns(hostname) {
  return new Promise(resolve => network.lookup(hostname, { all: true }, err => resolve(!err)));
}
const httpsGetJson = network.json;

// ── IPC: 当前应用版本 ──
handle('get-app-version', () => app.getVersion());

// 检查更新：读取更新清单 latest.json（{ version, notes, downloads:[{name,url,hint}] }），仅做版本校对，
// 不下载不安装——把下载入口交给用户（浏览器打开对应链接）
handle('check-for-update', async (_, cfg) => {
  try {
    const manifestUrl = 'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/latest.json';
    const current = app.getVersion();
    if (!manifestUrl) {
      return { ok: false, error: '请先在设置中填写自定义更新清单地址' };
    }
    const u = assertPublicUrl(manifestUrl);
    if (!(await checkPublicDns(u.hostname))) {
      throw new Error('更新地址无法解析或指向本地地址');
    }
    const mf = await httpsGetJson(u.href);
    const latest = String(mf.version || '').replace(/^v/i, '');
    const hasUpdate = !!(latest && compareVersions(latest, current) > 0);
    log(`updates | 检查完成 | 当前=v${current} 最新=v${latest || '?'} 可更新=${hasUpdate}`);
    const downloads = [];
    for (const d of (Array.isArray(mf.downloads) ? mf.downloads : [])) {
      const name = String(d.name || '').trim();
      const rawUrl = String(d.url || '').trim();
      if (!name || !rawUrl) continue;
      try {
        const du = assertPublicUrl(rawUrl);
        if (!(await checkPublicDns(du.hostname))) continue;   // 非法/本地入口直接跳过
        downloads.push({ name, url: du.href, hint: String(d.hint || '').trim() });
      } catch (e) { /* 跳过非法下载入口 */ }
    }
    return {
      ok: true,
      hasUpdate,
      current,
      latest,
      notes: String(mf.notes || '').trim(),
      downloads,
    };
  } catch (err) {
    return { ok: false, error: err.message, hasUpdate: false };
  }
});

handle('copy-link', (_, rawUrl) => {
  try { const url = network.publicUrl(rawUrl); if (url.href.length > 4096) throw Error('链接过长'); clipboard.writeText(url.href); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
handle('open-data-file', async (_, rawPath) => {
  try {
    const dir = experimentPath(rawPath), file = security.inside(path.join(dir, 'data.json'), dir);
    if (fs.statSync(file).size > 1024 * 1024) throw Error('数据文件过大');
    const error = await shell.openPath(file); return error ? { ok: false, error } : { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: 浏览器打开下载链接（仅允许公网 http/https）──
handle('open-external', async (_, rawUrl) => {
  try {
    const u = assertPublicUrl(rawUrl);
    if (!(await checkPublicDns(u.hostname))) {
      return { ok: false, error: '链接无法解析或指向本地地址' };
    }
    await shell.openExternal(u.href);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════
// 贡献数据上传（COS 直传：凭证云函数返回预签名 PUT 地址，密钥不进应用）
// ═══════════════════════════════════════════════
// 凭证云函数 URL（腾讯云 SCF 函数 URL，POST {keys:[...]} 返回预签名 PUT 地址；密钥不进应用）
const CONTRIBUTE_FN_URL = 'https://1485394950-jr8mommpp1.ap-guangzhou.tencentscf.com';

const uploadTickets = new Map();
const activeUploads = new Set();
handle('contribute-get-credentials', async (_, payload) => {
  try {
    for (const [url, ticket] of uploadTickets) if (ticket.expires < Date.now()) uploadTickets.delete(url);
    if (uploadTickets.size > 100) throw Error('待上传任务过多');
    const files = payload?.files;
    if (!Array.isArray(files) || !files.length || files.length > 20 || files.some(f => !Number.isSafeInteger(f.size) || f.size < 1 || f.size > 20 * 1024 * 1024)) throw Error('上传文件数量或大小无效');
    const resp = await network.json(CONTRIBUTE_FN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    if (!resp.ok || !Array.isArray(resp.items) || resp.items.length !== files.length) throw Error('凭证服务协议不兼容，请联系维护者更新云函数');
    const items = resp.items.map(it => {
      const url = network.publicUrl(it.putUrl);
      if (url.hostname !== new URL(DATA_MANIFEST_URL).hostname || !url.pathname.startsWith('/contributions/') || !files.some(f => f.key === it.key && f.size === it.size)) throw Error('上传凭证内容无效');
      uploadTickets.set(url.href, { size: it.size, expires: Date.now() + 540000 });
      return { key: it.key, putUrl: url.href };
    });
    return { ok: true, items };
  } catch (e) { return { ok: false, error: e.message }; }
});
handle('contribute-upload', async (_, payload) => {
  if (activeUploads.size >= 2) return { ok: false, error: '正在上传，请稍后重试' };
  const controller = new AbortController(); activeUploads.add(controller);
  try {
    const url = network.publicUrl(payload?.putUrl).href;
    const ticket = uploadTickets.get(url);
    if (!ticket || ticket.expires < Date.now()) throw Error('上传凭证不存在或已过期');
    const data = payload.data;
    if (!(data instanceof Uint8Array || data instanceof ArrayBuffer)) throw Error('上传数据无效');
    const buf = Buffer.from(data);
    if (buf.length !== ticket.size) throw Error('上传文件与凭证大小不匹配');
    const res = await network.response(url, { method: 'PUT', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'x-cos-forbid-overwrite': 'true' }, body: buf });
    res.resume();
    await new Promise((resolve, reject) => { res.on('end', resolve); res.on('error', reject); });
    uploadTickets.delete(url);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { activeUploads.delete(controller); }
});

// ── IPC: 用默认程序打开文件 ──
handle('open-file', async (_, filePath) => {
  try {
    const error = await shell.openPath(reportPath(filePath));
    return error ? { ok: false, error } : { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
handle('report-text', async (_, filePath) => {
  try { return { ok: true, text: (await mammoth.extractRawText({ path: reportPath(filePath) })).value }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: 导出诊断日志（设置-开发者调试；单 .txt，统一脱敏）──
handle('export-diagnostics', async (_, payload) => {
  try {
    const p = payload || {};
    let runLog = '';
    try {
      if (fs.existsSync(getLogFile())) runLog = fs.readFileSync(getLogFile(), 'utf-8') || '';
    } catch (e) { /* 读失败按无日志处理 */ }
    const { udRoot } = getDataRoots();
    const manifest = readLocalDataManifest();
    const sources = {
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      locales: app.getLocale(),
      dataVersion: manifest ? manifest.dataVersion : null,
      builtinVersion: DATA_BUILTIN_VERSION,
      updateInfo: p.updateInfo || null,
      config: p.config || null,
      student: p.student || null,
      expCount: p.expCount,
      queueState: p.queueState,
      queueSize: p.queueSize,
      renderErrors: Array.isArray(p.renderErrors) ? p.renderErrors : [],
      runLog,
      generationLogs: generationLogBuffer,
    };
    const doc = diagnostics.buildDiagnostics(sources);
    const knownRoots = [EXPERIMENTS_DIR, udRoot, app.getPath('userData'), PROJECT_ROOT];
    const out = diagnostics.sanitize(doc, knownRoots);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出诊断日志',
      defaultPath: path.join(app.getPath('documents'), `诊断日志_${ts}.txt`),
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: true, canceled: true };
    atomic.writeFile(filePath, out, 'utf-8');
    log(`diagnostics | 已导出 ${path.basename(filePath)} | ${Buffer.byteLength(out)} 字节`);
    return { ok: true, canceled: false, path: filePath, size: Buffer.byteLength(out) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: 运行 generate.py 生成报告 ──
// variants.compose 向 stdout 打印的章节原文标记（供应用侧按章节润色/导入重生成）
const SECTIONS_MARKER = '.LAB_SECTIONS_JSON:';
handle('run-generate', async (_, expPath, studentInfo, variants, polish) => {
  if (generationBusy || resourceUpdating) return { ok: false, error: '已有任务正在运行，请稍后重试' };
  syncInstalledResources();
  generationBusy = true;
  const job = { cancelled: false, wordHandles: new Map(), cleanup: null, inputFile: null };
  const genT0 = Date.now();
  const genExpName = path.basename(String(expPath || ''));
  log(`generate | 开始 | 实验=${genExpName}`);
  try {
  // 生成报告属写操作：迁移/复用 userData 副本，报告与章节缓存不再落入安装目录
  expPath = ensureUserCopy(expPath);
  const generatePy = security.inside(path.join(expPath, 'generate.py'), expPath);
  const errors = dataValidation.validate(atomic.readJson(security.inside(path.join(expPath, 'schema.json'), expPath)),
    atomic.readJson(security.inside(path.join(expPath, 'data.json'), expPath)));
  if (errors.length) throw Error(errors.join('；'));
  if (!fs.existsSync(generatePy)) {
    log(`generate | 失败 | generate.py 不存在 | 实验=${genExpName}`);
    return { ok: false, error: 'generate.py 不存在', logs: [] };
  }

  // 构建环境变量（注入学生信息）
  const env = { ...process.env };
  // 强制 Python 管道输出为 UTF-8：中文 Windows 默认区域编码为 GBK，
  // 而本进程按 UTF-8 解码 stdout（data.toString()），不强制会导致日志与章节缓存乱码
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  if (studentInfo) {
    if (studentInfo.name) env.LAB_STUDENT_NAME = studentInfo.name;
    if (studentInfo.id) env.LAB_STUDENT_ID = studentInfo.id;
    if (studentInfo.class) env.LAB_STUDENT_CLASS = studentInfo.class;
    if (studentInfo.date) env.LAB_STUDENT_DATE = studentInfo.date;
  }
  const jobInput = JSON.stringify({ variants: variants || {}, polish: polish || {}, disabledSections: readSectionsConfig(expPath).disabled });
  if (Buffer.byteLength(jobInput) > 512 * 1024) throw Error('润色与变体内容过长，请减少后重试');
  job.inputFile = path.join(expPath, '.job-' + crypto.randomUUID() + '.json');
  atomic.writeFile(job.inputFile, jobInput, 'utf8', false);
  delete env.LAB_VARIANTS; delete env.LAB_POLISH;
  env.LAB_JOB_INPUT = job.inputFile;

  // 解析真实可用的 python.exe 直接 spawn（优先 Store Python，排除沙箱路径，不依赖 cmd.exe）
  const pythonExe = resolvePythonExe() || 'python';
  // 记录生成启动时间：用于判定 docx 是否为本次产物（防止旧报告被误判为成功）
  const startTs = Date.now();

  return await new Promise((resolve) => {
    const logs = [];
    let logSize = 0;
    logs.push = function(...entries) {
      for (const entry of entries) { const text = String(entry).slice(-128 * 1024); Array.prototype.push.call(this, text); logSize += text.length; }
      while (logSize > 128 * 1024 && this.length > 1) logSize -= this.shift().length;
      return this.length;
    };
    let capturedSections = null;   // compose() 打印的章节原文缓存
    let stdoutCarry = '';          // 跨 chunk 的行缓冲（标记行可能分块到达）
    const python = spawn(pythonExe, [generatePy], {
      cwd: expPath,
      shell: false,
      windowsHide: true,
      env,
    });
    activePython = python;
    python.job = job;
    const deadline = setTimeout(() => { log('生成超时，正在清理'); cancelGeneration(); }, 5 * 60 * 1000);
    python.once('close', () => clearTimeout(deadline));
    python.once('error', () => clearTimeout(deadline));
    python.stdout.setEncoding('utf8');
    python.stderr.setEncoding('utf8');

    python.stdout.on('data', (data) => {
      // 按行处理：截出章节缓存标记行（不进入展示日志），其余原样转发
      const lines = (stdoutCarry + data.toString()).split(/\r?\n/);
      stdoutCarry = lines.pop();
      if (stdoutCarry.length > 1024 * 1024) { job.cancelled = true; cancelGeneration(); stdoutCarry = ''; }
      const keep = [];
      for (const ln of lines) {
        const wordMatch = /^\.LAB_WORD_INSTANCE:(\d+):(\d+)$/.exec(ln);
        if (wordMatch) {
          job.wordHandles.set(Number(wordMatch[1]), Number(wordMatch[2]));
        } else if (ln.startsWith(SECTIONS_MARKER)) {
          try { capturedSections = JSON.parse(ln.slice(SECTIONS_MARKER.length)); } catch (e) { /* 坏行忽略 */ }
        } else {
          keep.push(ln);
        }
      }
      if (keep.length) {
        const out = keep.join('\n') + '\n';
        logs.push(out);
        if (mainWindow) mainWindow.webContents.send('generate-log', out);
      }
    });
    python.stderr.on('data', (data) => {
      logs.push(data.toString());
      if (mainWindow) {
        mainWindow.webContents.send('generate-log', data.toString());
      }
    });

    python.on('close', async (code) => {
      try {
      if (job.cleanup) await job.cleanup;
      if (activePython === python) activePython = null;
      // 冲刷行缓冲（子进程输出末尾可能无换行）
      if (stdoutCarry) {
        if (stdoutCarry.startsWith(SECTIONS_MARKER)) {
          try { capturedSections = JSON.parse(stdoutCarry.slice(SECTIONS_MARKER.length)); } catch (e) { /* 坏行忽略 */ }
        } else {
          logs.push(stdoutCarry);
        }
        stdoutCarry = '';
      }
      // 扫描生成的 docx（跳过 Word 属主文件与生成中/残留的临时报告）
      // 仅认本次任务新建/更新的文件（mtime >= startTs），避免把旧报告误判为本次成功
      let reportFile = null;
      let newestMtime = 0;
      const files = fs.readdirSync(expPath);
      for (const f of files) {
        if (f.endsWith('.docx') && !f.startsWith('~$') && !f.includes('.~saving')) {
          const full = path.join(expPath, f);
          let mt = 0;
          try { mt = fs.statSync(full).mtimeMs; } catch (e) { continue; }
          if (mt >= startTs && mt > newestMtime) { newestMtime = mt; reportFile = full; }
        }
      }
      // 退出码 0 但未产出新 docx：视为失败（多数情况是测量数据未填写完整，generate.py 打印缺失列表后静默退出）
      const ok = !job.cancelled && code === 0 && !!reportFile;
      log(`generate | 结束 | 实验=${genExpName} exit=${code} ok=${ok}${reportFile ? ' 报告=' + path.basename(reportFile) : ''} | ${Date.now() - genT0}ms`);
      try {
        pushGenerationLog({ exp: genExpName, exitCode: code, ok, logs: (logs || []).join('') });
      } catch (e) { /* 缓冲失败不影响结果 */ }
      // Only publish section sources belonging to a successfully saved report.
      if (ok && capturedSections && typeof capturedSections === 'object') {
        try {
          atomic.writeFile(security.inside(path.join(expPath, '.lab_sections.json'), expPath), JSON.stringify(capturedSections, null, 1), 'utf-8');
        } catch (e) { /* 缓存失败不影响生成结果 */ }
      }
      resolve({
        ok,
        exitCode: code,
        cancelled: job.cancelled,
        logs: logs.join(''),
        reportFile,
        sections: capturedSections || undefined,
        error: !ok && code === 0 && !reportFile
          ? '未生成报告文件，请查看日志中的缺失提示（通常为测量数据未填写完整）'
          : undefined,
      });
      } catch (error) {
        resolve({ ok: false, error: error.message, cancelled: job.cancelled, logs: logs.join('') });
      }
    });

    python.on('error', (err) => {
      if (activePython === python) activePython = null;
      resolve({ ok: false, error: err.message, cancelled: job.cancelled, logs: logs.join('') });
    });
  });
  } catch (error) {
    log(`generate | 异常 | 实验=${genExpName} | ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    if (job.inputFile && fs.existsSync(job.inputFile)) fs.unlinkSync(job.inputFile);
    generationBusy = false;
  }
});

// ── IPC: 取消生成（结束 python 进程树 + 清理其启动的 Word，保留用户手动打开的 Word）──
async function cancelGeneration() {
  const python = activePython;
  if (!python || python.exitCode !== null) {
    return { ok: false, reason: 'no-active' };
  }
  const job = python.job;
  job.cancelled = true;
  if (!job.cleanup) job.cleanup = (async () => {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 8000);
      python.once('close', () => { clearTimeout(timer); resolve(); });
      execFile('taskkill', ['/PID', String(python.pid), '/T', '/F'], () => {});
    });
    // Verify both HWND and PID, then terminate through a process handle (no PID difference scan).
    if (job.wordHandles.size) await new Promise(resolve => {
      execFile(resolvePythonExe() || 'python', ['-c', cleanupScript, JSON.stringify([...job.wordHandles])],
        { windowsHide: true, timeout: 10000 }, () => resolve());
    });
  })();
  await job.cleanup;
  return { ok: true };
}
handle('cancel-generate', cancelGeneration);

// ── AI 提供商预设 ──
const AI_PROVIDERS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  custom: {
    baseUrl: '',
    model: 'gpt-4o',
  },
};

// ── IPC: AI 对话（requestId 支持取消：ai-chat-cancel 中止对应请求）──
const aiAbortControllers = new Map();   // requestId -> AbortController
function aiEndpoint(params) {
  const preset = AI_PROVIDERS[params.provider] || AI_PROVIDERS.custom;
  const url = network.publicUrl(String(params.apiUrl || preset.baseUrl).replace(/\/+$/, ''));
  if (url.search || url.hash) throw Error('API 地址不能包含查询参数或片段');
  return url.href.replace(/\/+$/, '');
}
handle('credential-status', () => ({ ok: true, ...keyStore.status() }));
handle('credential-save', (_, payload) => {
  try { return { ok: true, ...keyStore.save(payload.key, payload.key ? aiEndpoint(payload) : '') }; }
  catch (e) { return { ok: false, error: e.message }; }
});
handle('ai-chat', async (_, params) => {
  if (!params || !Array.isArray(params.messages) || params.messages.length > 30 || Buffer.byteLength(JSON.stringify(params.messages)) > 256 * 1024)
    return { ok: false, error: 'AI 请求内容无效或过大' };
  const { provider, model, messages, temperature = 0.7 } = params;
  const requestId = String(params.requestId || crypto.randomUUID());
  if (aiAbortControllers.size >= 2 || aiAbortControllers.has(requestId)) return { ok: false, error: 'AI 请求正在处理，请稍后重试' };
  const controller = new AbortController();
  aiAbortControllers.set(requestId, controller);
  try {
    const baseUrl = aiEndpoint(params);
    const apiKey = keyStore.get(baseUrl);
    const data = await network.json(baseUrl + '/chat/completions', {
      method: 'POST', signal: controller.signal, timeoutMs: 120000, maxBytes: 2 * 1024 * 1024,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model: model || (AI_PROVIDERS[provider] || AI_PROVIDERS.custom).model,
        messages, temperature, stream: false }),
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw Error('AI 返回了空内容');
    return { ok: true, content, usage: data.usage };
  } catch (e) {
    return { ok: false, cancelled: controller.signal.aborted, error: controller.signal.aborted ? '已取消生成' : e.message };
  } finally { aiAbortControllers.delete(requestId); }
});

// 取消一次进行中的 AI 请求
listen('ai-chat-cancel', (_, requestId) => {
  const c = aiAbortControllers.get(String(requestId || ''));
  if (c) {
    try { c.abort(); } catch (e) { /* 忽略 */ }
    aiAbortControllers.delete(String(requestId || ''));
  }
});

// ── 变体组合：读取实验的 variants.json ──
handle('load-variants', async (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    const p = security.inside(path.join(expPath, 'variants.json'), expPath);
    if (!fs.existsSync(p)) {
      return { ok: true, variants: null };
    }
    const variants = atomic.readJson(p);
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── 变体组合：保存实验的 variants.json（AI 调整结果写回；用户数据落 userData 副本）──
handle('save-variants', async (_, expPath, variants) => {
  try {
    if (!variants || typeof variants !== 'object') {
      return { ok: false, error: '变体数据无效' };
    }
    const p = ensureUserCopy(expPath);
    atomic.writeFile(security.inside(path.join(p, 'variants.json'), p), JSON.stringify(variants, null, 1), 'utf-8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── 变体管理：实验级章节开关（sections-config.json，独立于表单数据）──
// 某些实验不需要「实验原理/实验方法」等章节：禁用后生成报告不再输出该章节结构。
// 章节键复用自建变体库的白名单（含「实验结论」兼容电表实验的键名差异），单一来源防漂移。
const SECTION_NAMES = CUSTOM_SECTION_NAMES;

function readSectionsConfig(expPath) {
  const p = security.inside(path.join(expPath, 'sections-config.json'), expPath);
  if (!fs.existsSync(p)) return { disabled: [] };
  const cfg = atomic.readJson(p);
  return { disabled: Array.isArray(cfg && cfg.disabled) ? cfg.disabled : [] };
}

handle('read-sections-config', async (_, expPath) => {
  try {
    expPath = experimentPath(expPath);
    return { ok: true, ...readSectionsConfig(expPath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('write-sections-config', async (_, expPath, disabled) => {
  try {
    if (!Array.isArray(disabled)) return { ok: false, error: '章节开关数据无效' };
    const p = ensureUserCopy(expPath);
    const clean = [];
    for (const s of disabled) {
      if (typeof s === 'string' && SECTION_NAMES.includes(s) && !clean.includes(s)) clean.push(s);
    }
    atomic.writeFile(security.inside(path.join(p, 'sections-config.json'), p),
      JSON.stringify({ disabled: clean }, null, 1), 'utf-8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
