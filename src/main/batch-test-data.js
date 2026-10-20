 'use strict';
const fs = require('fs'), path = require('path');
const atomic = require('./atomic-store');
const validation = require('../shared/data-validation');
function fillAllTestData(dirs, backupDir) {
  const plans = dirs.map(dir => {
    const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const schema = read('schema.json'), fixture = read('test-data.json');
    const errors = validation.validate(schema, fixture);
    if (errors.length) throw Error(path.basename(dir) + '：' + errors.join('；'));
    const file = path.join(dir, 'data.json'), exists = fs.existsSync(file);
    const original = exists ? fs.readFileSync(file) : null;
    const data = exists ? JSON.parse(original.toString('utf8')) : {};
    for (const group of schema.groups || []) for (const field of group.fields || []) data[field.key] = fixture[field.key];
    return { dir, file, original, data };
  });
  fs.mkdirSync(backupDir, { recursive: true });
  // Complete every backup before changing the first measurement file.
  plans.forEach((p, i) => { if (p.original) atomic.writeFile(path.join(backupDir, i + '.json'), p.original, undefined, false); });
  atomic.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(plans.map((p,i) => ({ file:p.file, backup:p.original ? i+'.json' : null })), null, 2), 'utf8', false);
  const written = [];
  try {
    for (const p of plans) { written.push(p); atomic.writeFile(p.file, JSON.stringify(p.data, null, 2), 'utf8', false); }
  } catch (error) {
    for (const p of written.reverse()) {
      if (p.original) atomic.writeFile(p.file, p.original, undefined, false);
      else if (fs.existsSync(p.file)) fs.unlinkSync(p.file);
    }
    throw Error('填入失败，原数据已恢复：' + error.message);
  }
  return { count: plans.length };
}
module.exports = { fillAllTestData };
