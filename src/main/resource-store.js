const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const atomic = require('./atomic-store');

const STATE_FILE = '.resource-state.json';
const LEGACY_NEWTON_RINGS = {
  [path.join('平凸透镜曲率半径的测量', 'generate.py')]: [
    '90475480d6867828760e6c48a3249b144127c6f88710b25797726a3f38894709',
    '4701337344d2fdd7e84342e37fdeca012be220d00cf61def44a5165c3b12778f',
    '2b477a5ab0b8844c687eff8d94666b657263c3e4596fefe515740a0e27ffb07d',
  ],
  [path.join('平凸透镜曲率半径的测量', 'schema.json')]: [
    '62c488629c977541d2c80018f17537fea6bd43b849a9efa7081dc492062a93dd',
    '5876deca603aef7ade360c9cf034f1ce4dca8b000d4847d60c9991d8b62f414b',
  ],
  [path.join('平凸透镜曲率半径的测量', 'variants.json')]: [
    '785ce6ad10615008f06ac710b7872cf9b9722c135eb64c1d776c9eab633c71fa',
    '618ce0b33df3aa6db5920edf19c4a0d59d90aceab0eeda5920b38b86a53f70ec',
  ],
};

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

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resourceRevision(root) {
  const release = atomic.readJson(path.join(root, 'common', 'resource-release.json'), {});
  return Number.isSafeInteger(release.revision) && release.revision >= 0 ? release.revision : 0;
}

function packageOrigins(stagingRoot, previous = {}, version = '') {
  const result = { ...previous }, revision = resourceRevision(stagingRoot);
  for (const file of resourceFiles(stagingRoot)) {
    result[file] = { source: 'package', hash: hashFile(path.join(stagingRoot, file)), revision, version };
  }
  return result;
}

function syncBuiltin(builtin, target, fingerprint, appVersion, { force = false } = {}) {
  const state = readState(target);
  if (!force && state.builtinFingerprint === fingerprint && state.builtinHashes) return false;
  const hasDataPackage = Boolean(state.manifest?.dataVersion);
  const revision = resourceRevision(builtin);
  replaceTree(target, candidate => {
    const variantBases = {};
    const builtinHashes = {}, resourceOrigins = { ...(state.resourceOrigins || {}) }, syncWarnings = [];
    for (const file of resourceFiles(builtin)) {
      const source = path.join(builtin, file);
      const dest = path.join(candidate, file);
      const parts = file.split(path.sep);
      const isVariants = path.basename(file) === 'variants.json';
      const sourceHash = hashFile(source);
      builtinHashes[file] = sourceHash;
      if (isVariants) {
        // 数据包的变体基线属于数据包，安装升级不能改写其所有权记录。
        variantBases[file] = hasDataPackage && state.variantBases?.[file] !== undefined
          ? state.variantBases[file] : fs.readFileSync(source, 'utf8');
      }
      // Only migrate existing user experiments. New ones are copied on first write.
      if (parts[0] !== 'common' && !fs.existsSync(path.join(candidate, parts[0]))) continue;
      if (fs.existsSync(dest)) {
        const currentHash = hashFile(dest), origin = resourceOrigins[file];
        if (currentHash === sourceHash) {
          // 不接管较新热更新的所有权，否则下次同版本安装会把它当作旧内置文件。
          if (!origin || origin.source !== 'package' || revision > (origin.revision || 0)) {
            resourceOrigins[file] = { source: 'builtin', hash: sourceHash, revision, version: appVersion };
          }
          continue;
        }
        const unchangedBuiltin = (!origin || origin.source === 'builtin') && currentHash === state.builtinHashes?.[file];
        const unchangedPackage = origin?.source === 'package' && currentHash === origin.hash;
        const newerBuiltin = unchangedPackage && revision > (origin.revision || 0);
        const unknownLegacyPackage = hasDataPackage && !origin && !unchangedBuiltin;
        const userModified = origin && currentHash !== origin.hash && !unchangedBuiltin;
        const keepNewerPackage = unchangedPackage && !newerBuiltin;
        const keepNewerBuiltin = origin?.source === 'builtin' && currentHash === origin.hash && revision < (origin.revision || 0);
        const knownOldRingsResource = LEGACY_NEWTON_RINGS[file]?.includes(currentHash);
        if (!force && !knownOldRingsResource && (unknownLegacyPackage || userModified || keepNewerPackage || keepNewerBuiltin)) {
          if (unknownLegacyPackage || userModified) syncWarnings.push(file);
          continue;
        }
        if (knownOldRingsResource && isVariants) variantBases[file] = fs.readFileSync(source, 'utf8');
      }
      if (isVariants) {
        const text = fs.readFileSync(source, 'utf8');
        const previous = state.variantBases?.[file];
        if (fs.existsSync(dest)) {
          const userText = fs.readFileSync(dest, 'utf8');
          // Legacy files with unknown ownership are preserved conservatively.
          if (userText !== (previous ?? text) && !LEGACY_NEWTON_RINGS[file]?.includes(hashFile(dest))) continue;
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      resourceOrigins[file] = { source: 'builtin', hash: sourceHash, revision, version: appVersion };
      if (isVariants) variantBases[file] = fs.readFileSync(source, 'utf8');
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
    // 内置资源同步不等同于数据包更新；保留已验证的数据包版本和下架名单，
    // 否则应用升级会把热更新状态重置，导致下架实验重新出现在列表中。
    writeState(candidate, { ...state, builtinFingerprint: fingerprint, builtinHashes, builtinRevision: revision,
      resourceOrigins, syncWarnings, appVersion, variantBases });
  });
  return true;
}

module.exports = { readState, writeState, replaceTree, resourceVersion, syncBuiltin, recoverTree,
  resourceRevision, packageOrigins };
