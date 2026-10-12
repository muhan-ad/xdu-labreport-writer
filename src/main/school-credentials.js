'use strict';
const fs = require('fs');
const path = require('path');
const atomic = require('./atomic-store');
const { getSystem } = require('./school-systems');

function validateCredentials(value) {
  if (!value || typeof value.username !== 'string' || typeof value.password !== 'string'
    || !value.username.trim() || value.username.length > 512 || !value.password || value.password.length > 4096
    || /[\0\r\n]/.test(value.username + value.password)) throw Error('请输入有效的账号和密码');
  return { username: value.username.trim(), password: value.password };
}

function createSchoolCredentials(dir, safeStorage, platform = process.platform) {
  const file = path.join(dir, 'credentials.json');
  function read() {
    try {
      if (!fs.existsSync(file)) return {};
      if (fs.statSync(file).size > 128 * 1024) throw Error();
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      const valid = value => value && typeof value.encrypted === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.encrypted);
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error();
      if (state.version === 1 && valid(state)) return { report: { encrypted: state.encrypted } };
      if (state.version === 2 && state.systems && typeof state.systems === 'object' && !Array.isArray(state.systems)) {
        for (const [id, value] of Object.entries(state.systems)) { getSystem(id); if (!valid(value)) throw Error(); }
        return state.systems;
      }
      if (Object.keys(state).length === 0) return {};
      throw Error();
    } catch (_) { throw Error('学校账号存储无法读取，请重新保存或删除后重试'); }
  }
  function recoverableRead() { try { return read(); } catch (_) { return {}; } }
  function write(systems) { atomic.writeFile(file, JSON.stringify({ version: 2, systems }), 'utf8', false); }
  async function available() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return safeStorage.isAsyncEncryptionAvailable ? safeStorage.isAsyncEncryptionAvailable() : true;
  }
  return {
    async status(id = 'report') {
      getSystem(id);
      const enabled = await available();
      try { return { configured: !!read()[id]?.encrypted, available: enabled }; }
      catch (_) { return { configured: false, available: enabled, corrupt: true }; }
    },
    async save(value, id = 'report') {
      const system = getSystem(id);
      const credentials = validateCredentials(value);
      if (!await available()) throw Error('系统加密不可用，账号密码未保存');
      try {
        const plaintext = JSON.stringify({ site: new URL(system.url).hostname, systemId: id, ...credentials });
        const encrypted = safeStorage.encryptStringAsync
          ? await safeStorage.encryptStringAsync(plaintext) : safeStorage.encryptString(plaintext);
        // 整组信息加密；临时文件也只有密文，不生成旧凭据备份。
        const systems = recoverableRead();
        systems[id] = { encrypted: encrypted.toString('base64') }; write(systems);
        return { configured: true, available: true };
      } catch (_) { throw Error('加密保存失败，原账号配置未更改'); }
    },
    async get(id = 'report') {
      const system = getSystem(id);
      if (!await available()) throw Error('系统加密不可用，无法使用已保存账号');
      const state = read()[id] || {};
      if (!state.encrypted) throw Error('请先在账号密码管理中保存账号和密码');
      try {
        const encrypted = Buffer.from(state.encrypted, 'base64');
        const plaintext = safeStorage.decryptStringAsync
          ? (await safeStorage.decryptStringAsync(encrypted)).result : safeStorage.decryptString(encrypted);
        const value = JSON.parse(plaintext);
        if (value.site !== new URL(system.url).hostname || (value.systemId ? value.systemId !== id : id !== 'report')) throw Error();
        return validateCredentials(value);
      } catch (_) { throw Error('已保存账号无法解密，请重新保存'); }
    },
    remove(id = 'report') {
      getSystem(id);
      // 仅替换本功能的密文记录，不碰报告、其他密钥或用户文件。
      const systems = recoverableRead(); delete systems[id]; write(systems);
      return { configured: false };
    },
  };
}
module.exports = { createSchoolCredentials, validateCredentials };
