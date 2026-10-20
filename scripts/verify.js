'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const bundled = path.join(root, 'python-runtime/python.exe');
const python = fs.existsSync(bundled) ? bundled : 'python';
const commands = [[process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.js')).sort().map(file => 'tests/' + file)]],
  [process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'src/course-selection')).filter(file => /^test_.*\.cjs$/.test(file)).map(file => 'src/course-selection/' + file)]],
  [python, ['-B', '-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'src/course-selection', '-p', 'test_*.py']],
  ...['smoke_test.py', 'validate_schema.py', ...fs.readdirSync(path.join(root,'tests')).filter(file => file.endsWith('_test.py') && file !== 'word_report_test.py').sort().map(file => 'tests/'+file)].map(file => [python, ['-B', '-X', 'utf8', file, ...(file === 'validate_schema.py' ? ['--fixtures'] : [])]])];
for (const [exe, args] of commands) {
  console.log('CHECK:', args.join(' '));
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 180000,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  if (result.error || result.status !== 0) { console.error(result.error?.message || '验证失败'); process.exit(result.status || 1); }
}
console.log('PASS: Node security/regression and Python static/calculation/formula checks');
