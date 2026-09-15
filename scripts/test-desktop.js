'use strict';
const { spawnSync } = require('child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), ['tests/electron_smoke.js'], {
  cwd: require('path').join(__dirname, '..'), env, stdio: 'inherit', windowsHide: true, timeout: 200000,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
