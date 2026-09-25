'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const bundled = path.join(root, 'python-runtime/python.exe');
const python = fs.existsSync(bundled) ? bundled : 'python';
const commands = [[process.execPath, ['--test', 'tests/network.test.js', 'tests/regression.test.js', 'tests/security.test.js', 'tests/ocr.test.js']],
  ...['smoke_test.py', 'validate_schema.py', 'tests/calculation_test.py', 'tests/gravity_test.py', 'tests/electric_field_test.py', 'tests/omml_test.py', 'tests/quiz_polish_test.py', 'tests/custom_plot_test.py', 'tests/plot_runner_test.py', 'tests/chart_helper_test.py'].map(file => [python, ['-B', '-X', 'utf8', file]])];
for (const [exe, args] of commands) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180000 });
  if (result.error || result.status !== 0) { console.error(result.error?.message || '验证失败'); process.exit(result.status || 1); }
}
console.log('PASS: Node security/regression and Python static/calculation/formula checks');
