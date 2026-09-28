'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createSchoolCredentials, validateCredentials } = require('../src/main/school-credentials');
const { createCredentialClipboard, MARKER, OS_FORMAT, CLIPBOARD_TTL } = require('../src/main/credential-clipboard');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-vault-test-')), key = crypto.randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    async encryptStringAsync(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(bytes) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
      return { result: Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') };
    },
  };
  return { dir, storage, file: path.join(dir, 'credentials.json'), vault: createSchoolCredentials(dir, storage, 'win32') };
}

test('encrypts entire account/password, no plaintext, no backups; survives restart', async () => {
  const h = fixture(), value = { username: 'TEST_ONLY_ACCOUNT', password: 'TEST_ONLY_SECRET' };
  assert.equal((await h.vault.status()).configured, false);
  await h.vault.save(value);
  for (const file of fs.readdirSync(h.dir)) assert.doesNotMatch(fs.readFileSync(path.join(h.dir, file), 'utf8'), /TEST_ONLY|username|password/);
  assert.deepEqual(fs.readdirSync(h.dir), ['credentials.json']);
  assert.deepEqual(await createSchoolCredentials(h.dir, h.storage, 'win32').get(), value);
  assert.deepEqual(await h.vault.status(), { configured: true, available: true });
  h.vault.remove(); assert.equal((await h.vault.status()).configured, false);
  await assert.rejects(h.vault.get(), /请先/);
});

test('encryption unavailable or basic_text never writes plaintext or overwrites existing ciphertext', async () => {
  const h = fixture(); await h.vault.save({ username: 'account', password: 'secret' });
  const old = fs.readFileSync(h.file);
  h.storage.isEncryptionAvailable = () => false;
  await assert.rejects(h.vault.save({ username: 'new', password: 'new-secret' }), /不可用/);
  assert.ok(fs.readFileSync(h.file).equals(old));
  h.storage.isEncryptionAvailable = () => true; h.storage.getSelectedStorageBackend = () => 'basic_text';
  const insecure = createSchoolCredentials(h.dir, h.storage, 'linux');
  await assert.rejects(insecure.save({ username: 'new', password: 'new-secret' }), /不可用/);
  await assert.rejects(insecure.get(), /不可用/);
});

test('invalid input, corruption and decrypt exceptions are safe and recoverable', async () => {
  for (const value of [null, {}, { username: '', password: 'x' }, { username: 'x', password: '' },
    { username: 'x\n', password: 'x' }, { username: 'x', password: 'x'.repeat(4097) }]) assert.throws(() => validateCredentials(value));
  const h = fixture(); fs.writeFileSync(h.file, '{bad json');
  assert.equal((await h.vault.status()).corrupt, true);
  await h.vault.save({ username: 'account', password: 'secret' });
  h.storage.decryptStringAsync = async () => { throw Error('secret content leaked'); };
  await assert.rejects(h.vault.get(), error => !/secret|leaked/.test(error.message));
  h.vault.remove(); assert.equal((await h.vault.status()).configured, false);
});

function clipboardFixture() {
  let items = [], scheduled = null, wait = 0, clears = 0;
  class Item {
    constructor(data) { this.data = data; this.types = Object.keys(data); }
    async getType(type) { return this.data[type]; }
  }
  const clipboard = { read: async () => items, readText: async () => items[0] ? (await items[0].getType('text/plain')).text() : '',
    write: async data => { items = data; }, clear: () => { clears++; items = []; } };
  const guard = createCredentialClipboard({ clipboard, ClipboardItem: Item, platform: 'win32',
    schedule: (fn, ms) => { scheduled = fn; wait = ms; return { unref() {} }; }, cancel: () => {} });
  return { guard, clipboard, Item, items: () => items, wait: () => wait, clears: () => clears, scheduled: () => scheduled };
}

test('sensitive clipboard text and history/cloud exclusion formats are committed together', async () => {
  const h = clipboardFixture(); await h.guard.write('TEST_PASSWORD');
  assert.equal(h.wait(), CLIPBOARD_TTL); assert.equal(await h.clipboard.readText(), 'TEST_PASSWORD');
  assert.ok(h.items()[0].types.includes(MARKER));
  for (const name of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard'])
    assert.deepEqual(new Uint8Array(await (await h.items()[0].getType(OS_FORMAT(name))).arrayBuffer()), new Uint8Array(4));
  await h.guard.clearOwned(); assert.equal(h.clears(), 1); assert.equal(h.guard.hasOwned(), false);
});

test('30 second timer clears its own clipboard but preserves subsequent user content', async () => {
  const h = clipboardFixture(); await h.guard.write('TEST_PASSWORD');
  h.scheduled()(); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.clears(), 1);
  await h.guard.write('TEST_ACCOUNT');
  await h.clipboard.write([new h.Item({ 'text/plain': new Blob(['user new copy']) })]);
  await h.guard.clearOwned(); assert.equal(await h.clipboard.readText(), 'user new copy'); assert.equal(h.clears(), 1);
});

test('old timer cannot clear a newer copy; close cleanup waits for pending writes', async () => {
  const h = clipboardFixture(); await h.guard.write('first copy'); const oldTimer = h.scheduled();
  await h.guard.write('new copy'); oldTimer(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await h.clipboard.readText(), 'new copy'); assert.equal(h.clears(), 0);
  await h.guard.clearOwned();
  const write = h.clipboard.write; let release;
  h.clipboard.write = async items => { await new Promise(resolve => { release = resolve; }); await write(items); };
  const pendingWrite = h.guard.write('pending secret'); assert.equal(h.guard.hasOwned(), true);
  const pendingClear = h.guard.clearOwned(); release(); await pendingWrite; await pendingClear;
  assert.equal(await h.clipboard.readText(), ''); assert.equal(h.guard.hasOwned(), false);
});
