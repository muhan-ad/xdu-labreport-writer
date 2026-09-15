'use strict';
// Private key is kept outside the repository. Only the public key is shipped.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const JSZip = require('jszip');
const { canonical, MAX_PACKAGE, verify } = require('../src/main/update-package');
async function main() {
  const [command, keyPath, archive, version, url, output, notes = ''] = process.argv.slice(2);
  if (command === 'init') {
    if (!keyPath || fs.existsSync(keyPath)) throw Error('请指定不存在的仓库外私钥路径');
    const relative = path.relative(path.resolve(__dirname, '..'), path.resolve(keyPath));
    if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw Error('私钥必须保存在仓库外');
    if (fs.existsSync(path.join(__dirname, '../src/update-public-key.pem'))) throw Error('已存在公钥；轮换密钥需显式发布迁移，不能直接覆盖');
    const keys = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(path.resolve(keyPath)), { recursive: true });
    fs.writeFileSync(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(__dirname, '../src/update-public-key.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
    console.log('发布密钥已创建。请离线备份私钥，不要上传或提交私钥。'); return;
  }
  if (command !== 'sign' || !output) throw Error('用法：node scripts/release-data.js sign 私钥 ZIP 数据版本 HTTPS地址 输出清单 [说明]');
  const buf = fs.readFileSync(archive);
  if (buf.length > MAX_PACKAGE) throw Error('压缩包超过 64MB');
  const zip = await JSZip.loadAsync(buf, { checkCRC32: true });
  const files = {};
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw Error('不安全的 ZIP 路径');
    files[entry.name] = crypto.createHash('sha256').update(await entry.async('nodebuffer')).digest('hex');
  }
  const m = { dataVersion: version, minAppVersion: require('../package.json').version, url, size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'), notes, files };
  const key = fs.readFileSync(keyPath);
  m.signature = crypto.sign(null, Buffer.from(canonical(m)), key).toString('base64');
  const shippedKey = fs.readFileSync(path.join(__dirname, '../src/update-public-key.pem'));
  verify(m, shippedKey, m.minAppVersion, '0.0.0', new URL(url).hostname);
  fs.writeFileSync(output, JSON.stringify(m, null, 2));
  console.log('已生成并验证带签名的数据更新清单。');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
