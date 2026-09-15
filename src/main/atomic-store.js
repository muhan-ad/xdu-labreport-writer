'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeFile(file, content, encoding = 'utf8', backup = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, content, encoding);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (backup && fs.existsSync(file)) {
      // Never replace a good recovery copy with corrupt JSON.
      if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
      writeFile(file + '.bak', fs.readFileSync(file), undefined, false);
    }
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file) && !fs.existsSync(file + '.bak')) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (original) {
    if (!fs.existsSync(file + '.bak')) throw new Error(`文件损坏，请从备份恢复：${path.basename(file)}`);
    const text = fs.readFileSync(file + '.bak', 'utf8');
    const result = JSON.parse(text);
    if (fs.existsSync(file)) fs.renameSync(file, file + '.corrupt-' + crypto.randomUUID());
    writeFile(file, text, 'utf8', false);
    return result;
  }
}
module.exports = { writeFile, readJson };
