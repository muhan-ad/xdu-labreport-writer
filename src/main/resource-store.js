const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const atomic = require('./atomic-store');

const STATE_FILE = '.resource-state.json';

function recoverTree(target) {
  if (fs.existsSync(target)) return false;
  const parent = path.dirname(path.resolve(target));
  if (!fs.existsSync(parent)) return false;
  const candidates = fs.readdirSync(parent).filter(n => n.startsWith('.resource-')).map(n => path.join(parent, n));
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const dir of candidates) {
    if (fs.lstatSync(dir).isSymbolicLink()) continue;
    const marker = path.join(dir, 'transaction.json'), previous = path.join(dir, 'previous');
    if (!fs.existsSync(marker) || !fs.existsSync(previous)) continue;
    let state; try { state = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch (_) { continue; }
    if (state.target !== path.resolve(target) || fs.lstatSync(previous).isSymbolicLink()) continue;
    fs.renameSync(previous, target);
    return true;
  }
  return false;
}

function readState(root) {
  const file = path.join(root, STATE_FILE);
  return atomic.readJson(file, {});
}

function writeState(root, state) {
  atomic.writeFile(path.join(root, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
}

function copyTree(source, dest, io = fs) {
  io.mkdirSync(dest, { recursive: true });
  for (const entry of io.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`用户资源含链接，已停止更新：${entry.name}`);
    const from = path.join(source, entry.name), to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to, io);
    else io.copyFileSync(from, to);
  }
}

// Build a complete replacement beside the live tree. Keep the previous tree for recovery.
function replaceTree(target, prepare, io = fs) {
  const parent = path.dirname(path.resolve(target));
  const prefix = path.join(parent, '.resource-');
  io.mkdirSync(parent, { recursive: true });
  const work = io.mkdtempSync(prefix);
  io.writeFileSync(path.join(work, 'transaction.json'), JSON.stringify({ target: path.resolve(target) }));
  const candidate = path.join(work, 'candidate');
  const backup = path.join(work, 'previous');
  let moved = false;
  try {
    if (io.existsSync(target)) copyTree(target, candidate, io);
    else io.mkdirSync(candidate);
    prepare(candidate);
    if (io.existsSync(target)) {
      io.renameSync(target, backup);
      moved = true;
    }
    try {
      io.renameSync(candidate, target);
    } catch (error) {
      if (moved) {
        try { io.renameSync(backup, target); }
        catch (rollback) {
          throw new Error(`替换失败且恢复受阻，旧数据保留在 ${backup}：${rollback.message}`);
        }
      }
      throw error;
    }
    // Only prune completed transactions for this exact target; retain two recovery copies.
    try {
      const old = io.readdirSync(parent).filter(n => n.startsWith('.resource-')).map(n => path.join(parent, n)).filter(dir => {
        const marker = path.join(dir, 'transaction.json');
        return !io.lstatSync(dir).isSymbolicLink() && io.existsSync(marker) &&
          JSON.parse(io.readFileSync(marker, 'utf8')).target === path.resolve(target) && io.existsSync(path.join(dir, 'previous'));
      }).sort((a, b) => io.statSync(b).mtimeMs - io.statSync(a).mtimeMs);
      for (const dir of old.slice(2)) {
        if (path.dirname(path.resolve(dir)) !== parent) throw Error('Invalid backup path');
        io.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) { /* Retention must never undo a successful commit. */ }
    return moved ? backup : null;
  } catch (error) {
    // All paths here are descendants of our own freshly created temporary directory.
    if (io.existsSync(candidate)) io.rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
}

// 参与版本指纹与内置同步的文件类型。
// 注意：这里是白名单，**漏掉扩展名会让该文件既不参与指纹、也不会同步到用户数据目录**
// （曾因此丢掉公式转换依赖的 216KB 符号表 unimathsymbols.txt，导致生成报告失败）。
// 新增资源类型时务必同步这里。
const RESOURCE_FILE_RE = /\.(py|json|md|txt|csv|ttf|otf|dat)$/i;

function resourceFiles(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
    if (entry.isSymbolicLink()) throw new Error('实验资源不支持链接文件');
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...resourceFiles(root, rel));
    else if (RESOURCE_FILE_RE.test(entry.name) && entry.name !== 'data.json') result.push(rel);
  }
  return result.sort();
}

function resourceVersion(root) {
  const hash = crypto.createHash('sha256');
  for (const file of resourceFiles(root)) {
    hash.update(file.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
  }
  return hash.digest('hex');
}

function syncBuiltin(builtin, target, fingerprint, appVersion) {
  const state = readState(target);
  if (state.builtinFingerprint === fingerprint) return false;
  replaceTree(target, candidate => {
    const variantBases = {};
    for (const file of resourceFiles(builtin)) {
      const source = path.join(builtin, file);
      const dest = path.join(candidate, file);
      const parts = file.split(path.sep);
      if (path.basename(file) === 'variants.json') variantBases[file] = fs.readFileSync(source, 'utf8');
      // Only migrate existing user experiments. New ones are copied on first write.
      if (parts[0] !== 'common' && !fs.existsSync(path.join(candidate, parts[0]))) continue;
      if (path.basename(file) === 'variants.json') {
        const text = fs.readFileSync(source, 'utf8');
        const previous = state.variantBases?.[file];
        if (fs.existsSync(dest)) {
          const userText = fs.readFileSync(dest, 'utf8');
          // Legacy files with unknown ownership are preserved conservatively.
          if (userText !== (previous ?? text)) continue;
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
    }
    // Remove stale Python bytecode so same-sized script replacements take effect.
    const purgeCache = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = path.join(dir, entry.name);
        if (entry.name === '__pycache__') fs.rmSync(child, { recursive: true, force: true });
        else purgeCache(child);
      }
    };
    purgeCache(candidate);
    writeState(candidate, { builtinFingerprint: fingerprint, appVersion, variantBases, manifest: null });
  });
  return true;
}

module.exports = { readState, writeState, replaceTree, resourceVersion, syncBuiltin, recoverTree };
