'use strict';
const crypto = require('crypto');
const MARKER = 'web application/x.labreport-school-credential';
const OS_FORMAT = name => `electron application/osclipboard;format="${name}"`;
const CLIPBOARD_TTL = 30000;

function createCredentialClipboard({ clipboard, ClipboardItem, platform = process.platform,
  schedule = setTimeout, cancel = clearTimeout }) {
  let owned = null, timer = null, writing = null;
  const digest = (text, key) => crypto.createHmac('sha256', key).update(text).digest('hex');
  async function clearOwned(expected) {
    if (writing) { try { await writing; } catch (_) {} }
    if (expected !== undefined && owned !== expected) return;
    const current = owned;
    if (!current) return;
    try {
      const items = await clipboard.read();
      const item = items.find(value => value.types.includes(MARKER));
      if (!item) return;
      const marker = await (await item.getType(MARKER)).text();
      const text = await clipboard.readText();
      // 用户已复制其他内容时不清除；计时器也不保留账号密码明文。
      if (owned === current && marker === current.token && digest(text, current.key) === current.hash) clipboard.clear();
    } finally {
      if (owned === current) { owned = null; if (timer) cancel(timer); timer = null; }
    }
  }
  return {
    async write(text) {
      const next = { token: crypto.randomUUID(), key: crypto.randomBytes(32) };
      next.hash = digest(text, next.key);
      const data = { 'text/plain': new Blob([text]), [MARKER]: new Blob([next.token]) };
      if (platform === 'win32') {
        // 与文本一次性提交，禁止 Windows 剪贴板历史和跨设备同步。
        for (const name of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'ExcludeClipboardContentFromMonitorProcessing'])
          data[OS_FORMAT(name)] = new Blob([new Uint8Array(4)]);
      }
      const operation = (async () => {
        await clipboard.write([new ClipboardItem(data)]);
        if (timer) cancel(timer);
        owned = next;
        timer = schedule(() => { clearOwned(next).catch(() => {}); }, CLIPBOARD_TTL);
        timer?.unref?.();
      })();
      writing = operation;
      try { await operation; } finally { if (writing === operation) writing = null; }
    },
    clearOwned,
    hasOwned: () => !!(owned || writing),
  };
}
module.exports = { createCredentialClipboard, MARKER, OS_FORMAT, CLIPBOARD_TTL };
