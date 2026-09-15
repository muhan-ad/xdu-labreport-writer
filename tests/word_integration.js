const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cleanupScript } = require('../src/main/word-process');
const result = spawnSync(path.join(__dirname, '../python-runtime/python.exe'),
  ['-B', '-X', 'utf8', path.join(__dirname, 'word_smoke.py'), process.argv[2], cleanupScript],
  { stdio: 'inherit', windowsHide: true, timeout: 120000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
