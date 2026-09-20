'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { inside } = require('./security');
const { publicUrl } = require('./network');
const MAX_PACKAGE = 64 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
function compare(a, b) {
  if (![a, b].every(v => /^\d+\.\d+\.\d+$/.test(v))) throw Error('版本必须为 x.y.z');
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
function canonical(m) {
  const files = Object.fromEntries(Object.entries(m.files || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const removed = Array.isArray(m.removed)
    ? [...new Set(m.removed.filter(x => typeof x === 'string'))].sort() : [];
  if (removed.length) {
    // 下架清单仅在其非空时进入签名载荷：不带 removed 的包 canonical 与旧版逐字节一致
    return JSON.stringify({ dataVersion: m.dataVersion, minAppVersion: m.minAppVersion, url: m.url,
      size: m.size, sha256: m.sha256, notes: m.notes || '', removed, files });
  }
  return JSON.stringify({ dataVersion: m.dataVersion, minAppVersion: m.minAppVersion, url: m.url,
    size: m.size, sha256: m.sha256, notes: m.notes || '', files });
}
function verify(m, key, appVersion, currentVersion, host) {
  if (!m || typeof m !== 'object' || typeof m.signature !== 'string') throw Error('更新清单缺少发布签名，请维护者使用新版发布工具重新发布');
  if (compare(m.dataVersion, currentVersion) <= 0) throw Error('更新版本必须高于当前数据版本');
  if (compare(appVersion, m.minAppVersion) < 0) throw Error('请先更新应用，再更新实验数据');
  if (publicUrl(m.url).hostname !== host) throw Error('更新包来源不正确');
  if (!Number.isSafeInteger(m.size) || m.size < 1 || m.size > MAX_PACKAGE || !/^[a-f0-9]{64}$/.test(m.sha256)) throw Error('更新包大小或摘要无效');
  if (m.removed !== undefined) {
    if (!Array.isArray(m.removed) || m.removed.length > 200 ||
        m.removed.some(x => typeof x !== 'string' || !x || x.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(x))) {
      throw Error('更新包下架清单无效');
    }
  }
  const entries = Object.entries(m.files || {});
  if (!entries.length || entries.length > 4096) throw Error('更新包文件数量无效');
  const seen = new Set();
  for (const [file, hash] of entries) {
    // .txt：公式管线依赖 common/_vendor/latex2mathml/unimathsymbols.txt（导入时即读取，
    // 缺失会让报告生成失败），必须随数据包下发。**要求客户端先更新到含本条白名单的版本**
    // （数据包 minAppVersion 已相应抬高，老客户端会收到「请先更新应用」而不是清单错误）。
    // 另有 .md 同内容副本 + symbols_parser.py 回退作第二道保险（见 vendor-math-deps.py）。
    if (!file || file.length > 240 || /[\\:\x00-\x1f]/.test(file) || file.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p)) ||
        !/\.(py|json|md|png|jpg|jpeg|txt)$/i.test(file) || !/^[a-f0-9]{64}$/.test(hash) || seen.has(file.toLowerCase())) throw Error('更新包文件清单无效');
    seen.add(file.toLowerCase());
  }
  if (!crypto.verify(null, Buffer.from(canonical(m)), key, Buffer.from(m.signature, 'base64'))) throw Error('更新包发布签名验证失败');
  return JSON.parse(JSON.stringify(m));
}
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function verifyTree(root, manifest) {
  const found = new Set(); let total = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = inside(path.join(dir, entry.name), root);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile()) throw Error('更新包包含特殊文件');
      const rel = path.relative(root, file).replace(/\\/g, '/');
      total += fs.statSync(file).size;
      if (total > MAX_EXPANDED || !Object.hasOwn(manifest.files, rel) || hashFile(file) !== manifest.files[rel]) throw Error('更新包文件校验失败：' + rel);
      if (rel.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
      found.add(rel);
    }
  }
  walk(root);
  if (found.size !== Object.keys(manifest.files).length) throw Error('更新包缺少声明文件');
}
module.exports = { canonical, verify, verifyTree, compare, hashFile, MAX_PACKAGE, MAX_EXPANDED };
