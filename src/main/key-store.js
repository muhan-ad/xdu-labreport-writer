'use strict';
const path = require('path');
const fs = require('fs');
const atomic = require('./atomic-store');

function createKeyStore(dir, safeStorage) {
  const file = path.join(dir, 'credentials.json');
  function read() { return atomic.readJson(file, {}); }
  return {
    status: () => ({ configured: !!read().encrypted }),
    save(key, endpoint) {
      if (typeof key !== 'string' || key.length > 4096) throw Error('密钥格式无效');
      if (key && !safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用，密钥未保存');
      atomic.writeFile(file, JSON.stringify(key ? { encrypted: safeStorage.encryptString(key).toString('base64'), endpoint } : {}), 'utf8', false);
      if (fs.existsSync(file + '.bak')) fs.unlinkSync(file + '.bak');
      return { configured: !!key };
    },
    get(endpoint) {
      const state = read();
      if (!state.encrypted) throw Error('请先配置 API Key');
      if (state.endpoint !== endpoint) throw Error('服务地址已变化，请重新保存该服务的 API Key');
      return safeStorage.decryptString(Buffer.from(state.encrypted, 'base64'));
    },
  };
}
module.exports = { createKeyStore };
