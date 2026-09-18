'use strict';
// 变体链路（应用层）冒烟：变体面板 → 选择 → 生成 → 核对报告内容确实按所选变体。
// 由 scripts/test-desktop.js 以 Electron 启动：electron tests/variant_smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labreport-variant-test-'));
app.setPath('userData', root);
app.on('browser-window-created', (_, win) => win.hide());
require('../main');

const EXP = '长度与体积的测量';
const SRC = path.join(__dirname, '..', '物理实验', '实验脚本', EXP);
const variants = JSON.parse(fs.readFileSync(path.join(SRC, 'variants.json'), 'utf-8'));
const SECTION_NAMES = ['实验原理', '实验方法', '误差分析', '结论'];

const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await delay(200); }
  return false;
}

// 指纹取「不含公式的最长片段」：公式在报告里会渲染成别的字符，不能参与比对
function fingerprint(text) {
  const segs = String(text).split(/\$[^$]*\$/).map(s => s.replace(/%%DATA:[^%]*%%/g, '').replace(/\s+/g, ''));
  segs.sort((a, b) => b.length - a.length);
  return (segs[0] || '').slice(0, 10);
}

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
};

app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length);
    const win = BrowserWindow.getAllWindows()[0];
    const ev = code => win.webContents.executeJavaScript(code);
    await until(() => ev('typeof experiments !== "undefined" && experiments.length > 0').catch(() => false));

    await ev(`selectExperiment(experiments.find(e => e.name === '${EXP}'))`);
    const loaded = await until(() => ev('currentSchema && currentVariants && Object.keys(currentVariants).length > 0'));
    if (!loaded) throw new Error('变体库未加载');

    const panel = await ev(`(() => {
      const card = document.getElementById('variantsCard');
      const sels = [...document.querySelectorAll('.variant-select')];
      return { visible: !!(card && card.style.display !== 'none'),
               sections: sels.map(s => s.dataset.section),
               options: sels.map(s => s.options.length),
               values: sels.map(s => s.value) };
    })()`);
    check('变体面板已显示', panel.visible);
    check('每个章节一个下拉', panel.sections.length === Object.keys(variants).length, panel.sections.join('/'));
    check('下拉含「随机 + 各套变体」', panel.options.every(n => n === variants[panel.sections[0]].length + 1),
      '选项数=' + JSON.stringify(panel.options));
    check('默认选中「随机」', panel.values.every(v => v === '-1'), JSON.stringify(panel.values));

    // 指定「变体 3」（下标 2）后生成
    await ev(`document.querySelectorAll('.variant-select').forEach(s => { s.value = '2'; s.dispatchEvent(new Event('change')); });`);
    const stored = await ev(`JSON.parse(localStorage.getItem('variantChoices') || '{}')['${EXP}']`);
    check('选择已持久化到 localStorage', !!stored && Object.values(stored).every(v => v === 2), JSON.stringify(stored));

    await ev('runGenerate()');
    const generated = await until(() => ev('!!(currentExp && currentExp.reportFile)'), 120000);
    check('生成成功', generated);
    const report = await ev('currentExp.reportFile');
    await delay(400);

    const zip = await JSZip.loadAsync(fs.readFileSync(report));
    const xml = await zip.file('word/document.xml').async('string');
    const text = xml.replace(/<[^>]+>/g, '');
    const flat = text.replace(/\s+/g, '');
    for (const section of SECTION_NAMES) {
      const list = variants[section];
      if (!Array.isArray(list)) continue;
      const want = fingerprint(list[2]);
      const other = fingerprint(list[0]);
      check(`「${section}」用的是所选变体`, flat.includes(want) && !flat.includes(other));
    }
    check('公式已转换（无残留反斜杠）', !/\\[a-zA-Z]{2,}/.test(text));
    check('章节齐全', SECTION_NAMES.every(s => text.includes(s)));
    console.log(failures ? 'FAILED: ' + failures + ' 项' : 'PASS: 变体面板可选、选择生效、报告内容与所选变体一致');
  } catch (e) {
    console.error('异常：', e && e.message);
    failures++;
  } finally {
    app.exit(failures ? 1 : 0);
  }
});
