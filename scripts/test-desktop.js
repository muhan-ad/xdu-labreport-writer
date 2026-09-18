'use strict';
// 桌面端冒烟：逐个用 Electron 启动 scripts 列表里的测试脚本（各自使用独立用户目录）
const { spawnSync } = require('child_process');
const path = require('path');
const SCRIPTS = ['tests/electron_smoke.js', 'tests/variant_smoke.js'];
let failed = null;
for (const file of SCRIPTS) {
  console.log('\n=== ' + file + ' ===');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [file], {
    cwd: path.join(__dirname, '..'), env, stdio: 'inherit', windowsHide: true, timeout: 300000,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0 && failed === null) failed = file;
}
if (failed) { console.error('\n桌面端冒烟失败：' + failed); process.exit(1); }
console.log('\nPASS: 桌面端冒烟全部通过（含变体链路）');
