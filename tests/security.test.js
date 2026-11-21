'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), vm = require('node:vm');
const security = require('../src/main/security'), network = require('../src/main/network');
const packages = require('../src/main/update-package'), atomic = require('../src/main/atomic-store');
const { createKeyStore } = require('../src/main/key-store');
const validation = require('../src/shared/data-validation');
function fixture(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-sec-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }

test('network accepts local models, LAN services and Fake-IP endpoints', () => {
  for (const url of ['http://localhost:11434/v1','http://127.0.0.1:8000','https://192.168.1.1','https://[::1]/','https://198.18.0.1','https://198.19.0.1','https://example.com/data']) assert.equal(network.publicUrl(url).href, new URL(url).href);
  for (const url of ['file:///C:/test','ftp://example.com','https://user:pass@example.com']) assert.throws(() => network.publicUrl(url));
});
test('local HTTP model receives requests through the production network client', async t => {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: req.url, body: JSON.parse(body) }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await network.json('http://127.0.0.1:' + server.address().port + '/v1/chat/completions', {
    method: 'POST', body: JSON.stringify({ model: 'local', messages: [] }),
  });
  assert.deepEqual(result, { path: '/v1/chat/completions', body: { model: 'local', messages: [] } });
});
test('DNS returns Fake-IP and private addresses supplied by the system resolver', async t => {
  const dns = require('node:dns'), original = dns.lookup;
  t.after(() => { dns.lookup = original; });
  for (const address of ['198.18.0.1', '198.19.0.1', '127.0.0.1', '192.168.1.1']) {
    dns.lookup = (host, options, cb) => cb(null, [{ address, family: 4 }]);
    const result = await new Promise((resolve, reject) => network.lookup('service.test', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
    assert.deepEqual(result, [{ address, family: 4 }]);
  }
});
test('file boundary rejects parent escapes and directory junctions', t => {
  const dir = fixture(t), outside = fixture(t);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'marker');
  assert.throws(() => security.inside(path.join(outside, 'private.txt'), dir));
  fs.symlinkSync(outside, path.join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => security.inside(path.join(dir, 'link/private.txt'), dir));
});
test('HTML preview removes active content and external resource URLs', () => {
  const html = security.cleanHtml('<a href="javascript:alert(1)">read</a><img src="https://remote.invalid/x" onerror="alert(1)"><script>alert(2)</script><iframe src="file:///C:/"></iframe><p>safe</p>');
  assert.ok(html.includes('safe')); assert.doesNotMatch(html, /javascript:|onerror|script|iframe|https:|file:/);
});
test('credentials are encrypted, endpoint-bound and never returned by status', t => {
  const dir = fixture(t);
  const cipher = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).map(x => x ^ 0x5a), decryptString: b => Buffer.from(b).map(x => x ^ 0x5a).toString() };
  const store = createKeyStore(dir, cipher);
  store.save('audit-secret', 'https://example.com');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8'), /audit-secret/);
  assert.deepEqual(store.status(), { configured: true });
  assert.throws(() => store.get('https://different.example'));
  assert.equal(store.get('https://example.com'), 'audit-secret');
  store.save('', ''); assert.deepEqual(store.status(), { configured: false });
});
test('atomic JSON recovers a damaged primary from last valid backup', t => {
  const file = path.join(fixture(t), 'data.json');
  atomic.writeFile(file, '{"value":1}'); atomic.writeFile(file, '{"value":2}');
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(atomic.readJson(file), { value: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { value: 1 });
});
test('data validation permits drafts but rejects malformed numbers and dimensions', () => {
  const schema = { groups: [{ fields: [{ key: 'x', type: 'number', required: true, exclusiveMinimum: 0 }, { key: 'a', type: 'array', length: 2 }] }] };
  assert.deepEqual(validation.validate(schema, { x: null, a: [1, null] }, false), []);
  for (const x of [null, 0, -1, Infinity, NaN, '12']) assert.ok(validation.validate(schema, { x, a: [1, 2] }).length);
  assert.ok(validation.validate(schema, { x: 1, a: [1] }).length);
});
function manifest() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const m = { dataVersion: '2.0.0', minAppVersion: '1.7.5', url: 'https://example.com/a.zip', size: 100,
    sha256: 'a'.repeat(64), files: { '实验脚本/common/core.py': crypto.createHash('sha256').update('safe').digest('hex') }, notes: 'test' };
  const sign = x => ({ ...x, signature: crypto.sign(null, Buffer.from(packages.canonical(x)), keys.privateKey).toString('base64') });
  return { m: sign(m), keys, sign };
}
test('signed updates reject tampering, rollback, incompatible clients and foreign origins', () => {
  const { m, keys, sign } = manifest();
  const verify = x => packages.verify(x, keys.publicKey, '1.7.5', '1.0.0', 'example.com');
  assert.equal(verify(m).dataVersion, '2.0.0');
  for (const x of [{ ...m, signature: '' }, { ...m, notes: 'modified' }, sign({ ...m, dataVersion: '1.0.0' }), sign({ ...m, minAppVersion: '9.0.0' }), sign({ ...m, url: 'https://elsewhere.com/a.zip' }), sign({ ...m, files: { '../escape.py': 'a'.repeat(64) } })]) assert.throws(() => verify(x));
});
test('extracted update requires exactly the declared file bytes', t => {
  const root = fixture(t), { m } = manifest();
  fs.mkdirSync(path.join(root, '实验脚本/common'), { recursive: true });
  const file = path.join(root, '实验脚本/common/core.py'); fs.writeFileSync(file, 'safe');
  packages.verifyTree(root, m);
  fs.writeFileSync(file, 'changed'); assert.throws(() => packages.verifyTree(root, m));
  fs.writeFileSync(file, 'safe'); fs.writeFileSync(path.join(root, 'unexpected.py'), 'extra'); assert.throws(() => packages.verifyTree(root, m));
});
function cloud() {
  const context = { exports: {}, require, Buffer, process: { env: { BUCKET: 'audit-123', SECRET_ID: 'FAKE', SECRET_KEY: 'FAKE' } } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../cloud/contribute-credentials/index.js'), 'utf8'), context);
  return (files, ip = '203.0.113.8') => context.exports.main_handler({ httpMethod: 'POST', requestContext: { sourceIp: ip }, body: JSON.stringify({ files }) });
}
test('contribution protocol supports feedback and uses server-generated object names and signed size', async () => {
  const invoke = cloud();
  for (const key of ['contributions/feedbacks/date/feedback.json','contributions/variants/exp/date/data.json','contributions/reports/exp/date/report.docx',
    'contributions/vision/exp/date/photo.jpg','contributions/vision/exp/date/ai.json','contributions/vision/exp/date/proofread.json','contributions/vision/exp/date/manifest.json']) {
    const result = await invoke([{ key, size: 10 }]); assert.equal(result.statusCode, 200);
    const item = JSON.parse(result.body).items[0];
    assert.equal(item.key, key); assert.notEqual(item.objectKey, key);
    const url = new URL(item.putUrl);
    assert.match(url.searchParams.get('q-header-list'), /content-length/);
    assert.match(url.searchParams.get('q-header-list'), /x-cos-forbid-overwrite/);
  }
});
test('contribution protocol rejects traversal, oversized files and quota exhaustion', async () => {
  const invoke = cloud();
  assert.equal((await invoke([{ key: 'contributions/reports/../date/a.docx', size: 1 }])).statusCode, 400);
  assert.equal((await invoke([{ key: 'contributions/vision/../date/photo.jpg', size: 1 }])).statusCode, 400, '识图数据同样拒绝路径穿越');
  assert.equal((await invoke([{ key: 'contributions/vision/exp/date/photo.gif', size: 1 }])).statusCode, 400, '识图数据不允许 gif');
  const key = 'contributions/reports/exp/date/a.docx';
  assert.equal((await invoke([{ key, size: 21 * 1024 * 1024 }])).statusCode, 413);
  for (let i = 0; i < 20; i++) assert.equal((await invoke([{ key, size: 1 }])).statusCode, 200);
  assert.equal((await invoke([{ key, size: 1 }])).statusCode, 429);
});
