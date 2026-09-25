'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ocr = require('../src/main/ocr');

const root = path.resolve(__dirname, '..');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('OCR image parser accepts a signed PNG and rejects mismatched content', () => {
  const parsed = ocr.parseImageDataUrl(tinyPng);
  assert.equal(parsed.mime, 'image/png');
  assert.throws(() => ocr.parseImageDataUrl('data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'), /内容与声明格式不一致/);
  assert.throws(() => ocr.parseImageDataUrl('data:text/plain;base64,SGVsbG8='), /图片格式无效/);
});

test('OCR response extraction supports text and compatible content arrays', () => {
  assert.equal(ocr.extractContent({ choices: [{ message: { content: '{"fields":{}}' } }] }), '{"fields":{}}');
  assert.equal(ocr.extractContent({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.throws(() => ocr.extractContent({ choices: [] }), /空内容/);
});

test('OCR UI and all experiment photo hooks are present', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  for (const id of ['btnRecognize', 'recognizeModal', 'selectVisionProvider', 'inputVisionApiKey', 'chkEmbedDataPhoto']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const base = path.join(root, '物理实验', '实验脚本');
  const scripts = fs.readdirSync(base, { withFileTypes: true })
    .filter(item => item.isDirectory() && item.name !== 'common')
    .map(item => path.join(base, item.name, 'generate.py'))
    .filter(file => fs.existsSync(file));
  assert.equal(scripts.length, 27);
  for (const file of scripts) assert.match(fs.readFileSync(file, 'utf8'), /doc\.add_data_photo\(/, path.basename(path.dirname(file)));
});

test('OCR number parsing is strict about the whole string', () => {
  // 审查报告 R13：旧实现用 parseFloat 取前缀，"1.2abc"/"3.5V" 会被静默当成数值收下
  const { coerceNum } = require('../src/shared/ocr-number');
  assert.equal(coerceNum('1.2abc'), null);
  assert.equal(coerceNum('3.5V'), null);
  assert.equal(coerceNum('1.2.3'), null);
  assert.equal(coerceNum('abc'), null);
  assert.equal(coerceNum(''), null);
  assert.equal(coerceNum(2.5), 2.5);
  assert.equal(coerceNum(' -1.5 '), -1.5);
  assert.equal(coerceNum('2.7×10^-9'), 2.7e-9);
  assert.equal(coerceNum('1.5e-3'), 0.0015);
});

test('gravity photo average is recognized and the 8-by-9 photo table is transposed without dropping hole 9', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, '物理实验', '实验脚本', '重力加速度的测量', 'schema.json'), 'utf8'));
  const fields = schema.groups.flatMap(group => group.fields);
  assert.equal(fields.find(field => field.key === 'delta_instr').default, 0.01);
  assert.equal(fields.find(field => field.key === 'T_avg').length, 9);
  assert.ok(!fields.some(field => ['T0', 'h1', 'h2'].includes(field.key)), '交点是生成时计算值，不应在表单或识图核对页显示');

  const source = fs.readFileSync(path.join(root, 'src', 'ocr.js'), 'utf8');
  const context = vm.createContext({
    window: { ocrNumber: require('../src/shared/ocr-number') },
    coerceNum: require('../src/shared/ocr-number').coerceNum,
    RECOG_SCALAR_DEFAULT_TOL: 0.2,
  });
  vm.runInContext(source.slice(source.indexOf('function buildRecogPrompt('), source.indexOf('// 补全被截断的结尾')), context);
  vm.runInContext(source.slice(source.indexOf('function deriveArrayPattern('), source.indexOf('// ── 判断表单里某个字段当前是否为空')), context);
  const prompt = context.buildRecogPrompt(schema, false);
  assert.match(prompt, /单周期平均/);
  assert.match(prompt, /第9孔整列必须保留/);
  assert.doesNotMatch(prompt, /key="(?:T0|h1|h2)"/);

  const photoRows = Array.from({ length: 8 }, (_, repeat) =>
    Array.from({ length: 9 }, (_, hole) => 10 + hole + repeat / 100));
  const recognized = context.validateRecog({ fields: {
    delta_instr: { value: 5.45 },
    trials: { value: photoRows },
    T_avg: { value: Array.from({ length: 9 }, (_, hole) => 1 + hole / 10) },
  } }, schema);
  const trials = recognized.find(field => field.key === 'trials');
  const averages = recognized.find(field => field.key === 'T_avg');
  assert.equal(trials.value.length, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(trials.value[8])), photoRows.map(row => row[8]));
  assert.equal(averages.value.length, 9);
  assert.equal(recognized.find(field => field.key === 'delta_instr').value, null,
    '照片上的质心位置不得误识别为秒表精度并覆盖 0.01 默认值');
});

test('AI 服务页：两个配置入口就地展开，小米默认模型为 mimo-v2.5', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  const ocrUi = fs.readFileSync(path.join(root, 'src', 'ocr.js'), 'utf8');
  // 两个入口按钮 + 两个勾选项 + 两个默认收起的面板
  for (const id of ['btnOpenApiConfig', 'btnOpenVisionConfig']) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ['chkAiPolish', 'chkEmbedDataPhoto']) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ['panelApiConfig', 'panelVisionConfig']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*hidden|hidden[^>]*id="${id}"`), `${id} 默认收起`);
  }
  // 面板开关：互斥 + 进入页面收起
  assert.match(renderer, /function toggleAiConfigPanel/, '存在面板开关函数');
  assert.match(renderer, /name === 'ai'\) collapseAiConfigPanels\(\)/, '进入 AI 服务页时收起面板');
  // 小米模型默认值
  assert.match(renderer, /mimo: \[\s*\{ name: 'mimo-v2\.5', desc: '默认' \},\s*\{ name: 'mimo-v2\.5-pro'/, '小米快捷模型为 mimo-v2.5 / mimo-v2.5-pro');
  assert.match(renderer, /mimo: 'mimo-v2\.5'/, 'getDefaultModel 为小米提供默认模型（此前缺失会回退 deepseek）');
  // 继承态：地址栏灰显 + 自动填充
  assert.match(ocrUi, /urlInput\.disabled = inherited/, '继承时识图地址栏禁用（灰显）');
  assert.match(ocrUi, /refreshVisionInheritedUrl/, '继承时自动填充主 API 地址');
  assert.match(ocrUi, /settings\.visionApiUrl = \$\(\'inputVisionApiUrl\'\)\.dataset\.ownValue/, '继承态保存时不覆盖用户自填地址');
  assert.match(ocrUi, /inputVisionApiUrl'\)\.addEventListener\('input'/, '编辑中的专用地址应立即备份，切换面板不能覆盖');
});

test('识别弹窗样式：JS 用到的类在 ocr.css 里都有，且不再落到蓝色 fallback', () => {
  const raw = fs.readFileSync(path.join(root, 'src', 'ocr.css'), 'utf8');
  // 先剥掉注释，避免注释里的说明文字被当成真实引用（例如头部注释提到的 --primary）
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const ocrUi = fs.readFileSync(path.join(root, 'src', 'ocr.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  // 1) JS 渲染模板里出现的每个 recog-* 类都必须在 ocr.css 中有对应规则
  //    （类名漂移会让样式静默失效，曾发生过：JS 已改用 state-warn/state-fail，
  //     而 CSS 还写着 .recog-row.warn/.fail）
  const used = new Set();
  for (const m of ocrUi.matchAll(/["'`][^"'`]*\b(recog-[a-z][a-z0-9-]*)/g)) used.add(m[1]);
  for (const m of ocrUi.matchAll(/\b(recog-[a-z][a-z0-9-]*)\b/g)) used.add(m[1]);
  // 仅作 JS 钩子、无需专门样式的类：recog-pick 是每字段勾选框的钩子，
  // 视觉由 .review-pick input[type="checkbox"] 统一接管
  const JS_HOOK_ONLY = ['recog-pick'];
  const missing = [...used].filter(c => !JS_HOOK_ONLY.includes(c) && !new RegExp(`\\.${c}\\b`).test(css));
  assert.deepEqual(missing, [], 'ocr.css 缺少这些类的规则：' + missing.join(', '));
  // 2) 模板里点名要带的两个 class 不能丢（丢了会变成默认大黑字）
  assert.match(html, /id="recogLoadingText"[^>]*|class="recog-loading-text" id="recogLoadingText"/);
  assert.match(html, /class="recog-loading-text"[^>]*id="recogLoadingText"/, '识别中文字带 recog-loading-text');
  assert.match(html, /class="recog-summary"[^>]*id="recogSummary"/, '摘要带 recog-summary');
  // 3) 不允许再引用不存在的 --primary（否则整窗回到蓝色 fallback）
  assert.ok(!/--primary/.test(css), 'ocr.css 不应再出现 --primary');
  // 4) 关键状态类必须按 JS 实际使用命名（核对页 = 识别结果页：数据格 + 三态左边框）
  for (const cls of ['review-field[data-status="warn"]', 'review-field[data-status="fail"]', 'review-field.edited',
    'review-field.unpicked', 'review-pick', 'recog-field-reason',
    'recog-badge.ok', 'recog-badge.warn', 'recog-badge.fail']) {
    assert.ok(css.includes(cls), 'ocr.css 缺少 ' + cls);
  }
});

test('核对页不会重叠：告警原因独占一行 + 原图面板不超出分栏槽位', () => {
  // 用户报「识图结果严重重叠」。两个根因都在 ocr.css，且都是静默的（不报错、只是难看）：
  // 1) .review-field 少了 flex-wrap —— .recog-field-reason 是 flex:1 0 100%，在 nowrap 行里
  //    会把同行的 .form-field 压成 0 宽（数组格子竖着重叠、数值输入框直接消失）；
  // 2) .recog-image-pane 曾是 max-height:none —— 竖拍照片高出 .recog-split，
  //    溢出部分盖住字段列表下部和提示条。
  const raw = fs.readFileSync(path.join(root, 'src', 'ocr.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');   // 剥注释：说明文字里也提到这些关键字
  const flexBlocks = [...css.matchAll(/\.review-field\s*\{([^}]*)\}/g)].map(m => m[1]);
  const rowBlock = flexBlocks.find(b => /display:\s*flex/.test(b));
  assert.ok(rowBlock, '.review-field 必须是 flex 行（勾选框 + 数据格）');
  assert.match(rowBlock, /flex-wrap:\s*wrap/, 'review-field 要能换行：否则 100% 宽的原因文字会把输入框压成 0 宽');
  const reasonBlock = [...css.matchAll(/\.recog-field-reason\s*\{([^}]*)\}/g)].map(m => m[1])[0] || '';
  assert.match(reasonBlock, /flex:\s*1 0 100%/, '原因文字保持独占一整行');
  // 原图面板：不允许再回到 max-height:none，必须与 .recog-split 同高并让图片缩放
  assert.ok(!/\.recog-image-pane\s*\{[^}]*max-height:\s*none/.test(css), '原图面板不得 max-height:none（会溢出盖住核对结果）');
  const paneBlock = [...css.matchAll(/\.recog-image-pane\s*\{([^}]*)\}/g)].map(m => m[1]).join(' ');
  assert.match(paneBlock, /align-self:\s*stretch/, '原图面板与字段栏同高，不高出分栏');
  const imgBlock = [...css.matchAll(/\.recog-image-pane img\s*\{([^}]*)\}/g)].map(m => m[1])[0] || '';
  assert.match(imgBlock, /object-fit:\s*contain/, '原图按 contain 缩放进面板，不把面板撑高');
});

test('OCR recognition is bound to a session and cancellable', () => {
  // 审查报告 R13：识别请求必须能取消、晚到结果必须按会话丢弃、原图确认后才落盘
  const ocrUi = fs.readFileSync(path.join(root, 'src', 'ocr.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(ocrUi, /recogSession\s*=\s*\{\s*requestId/, '识别开始要登记会话（requestId + expId）');
  assert.match(ocrUi, /window\.labAPI\.ocrCancel\(/, '存在取消识别请求的调用');
  assert.match(ocrUi, /recogSession\.requestId !== requestId/, '结果回来要校验会话是否过期');
  assert.match(preload, /ocrCancel:/, 'preload 暴露 ocrCancel');
  assert.match(mainSrc, /listen\('ocr-cancel'/, '主进程有 ocr-cancel 监听');
  // 识图不再自动中断：有些实验的大表格识别本身就慢，而识图是非流式请求（模型算完前收不到数据），
  // 空闲超时必然先于总超时触发，线上已出现「网络连接超时」把用户拦下的情况。
  // 现在中止只由用户点「取消」触发（ocr-cancel），请求本身不设自动超时。
  const ocrHandler = mainSrc.slice(mainSrc.indexOf("handle('ocr-recognize'"), mainSrc.indexOf("handle('ai-chat'"));
  assert.match(ocrHandler, /timeoutMs:\s*0,\s*idleTimeoutMs:\s*0/, '识图请求不设自动超时');
  assert.ok(!/idleTimeoutMs:\s*[1-9]/.test(ocrHandler), '识图链路上不得再出现正数空闲超时');
  assert.ok(!/timeoutMs:\s*[1-9]/.test(ocrHandler), '识图链路上不得再出现正数总超时');
  assert.match(ocrHandler, /maxBytes:\s*OCR_MAX_BYTES/, '体积上限收敛为常量（只防模型跑飞）');
  assert.match(mainSrc, /const OCR_MAX_BYTES = 32 \* 1024 \* 1024/, '识图体积上限为 32MB 的安全阀');
  const netSrc = fs.readFileSync(path.join(root, 'src', 'main', 'network.js'), 'utf8');
  assert.match(netSrc, /timeoutMs === undefined \? 30000/, 'network.json 默认总超时仍是 30 秒（其它调用方不受影响）');
  assert.match(netSrc, /idleRaw > 0 \? idleRaw : 0/, 'network 支持 0 = 不设空闲超时');
  assert.match(netSrc, /maxBytes > 0 && size > maxBytes/, 'network 支持 0 = 不限体积');
  const startBody = ocrUi.slice(ocrUi.indexOf('async function startRecognition'), ocrUi.indexOf('function collectReviewValues'));
  assert.ok(!/saveTableImage/.test(startBody), '识别开始阶段不再提前保存原图');
  assert.match(ocrUi, /await window\.labAPI\.saveTableImage\(currentExp\.path, recogState\.originalDataUrl\)/, '确认后才保存原图');
});

// 识图回归（2.1.0 的两个线上缺陷）：
//  1) 核对页取值必须排除带 data-key 的勾选框（.recog-pick，value 恒为 'on'），否则 number 字段读成 null
//     导不进去、text 字段读成 "on"；
//  2) 关闭识别弹窗必须清空核对页并取消识别 —— 核对页输入与主表单共用 data-key，残留下来会被主表单
//     取值读到（数组长度翻倍 →「数组长度错误」，保存与生成全被拦）。
test('review page reading skips the pick checkbox and closing clears the review DOM', () => {
  const ocrUi = fs.readFileSync(path.join(root, 'src', 'ocr.js'), 'utf8');
  const rendererUi = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  assert.match(ocrUi, /wrap\.querySelectorAll\('\.field-input\[data-key\]'\)/,
    '核对页取值只收数据格（排除勾选框）');
  assert.match(ocrUi, /function closeRecognizeModal\(\)\s*\{\s*cancelRecognition\(\);\s*\$\('recogFields'\)\.innerHTML = '';\s*closeModal\('recognizeModal'\);/,
    '统一关闭出口：取消识别 + 清空核对页');
  assert.match(ocrUi, /const closeAndCancel = \(\) => closeRecognizeModal\(\)/, '× / 取消按钮走统一出口');
  assert.match(ocrUi, /closeRecognizeModal\(\);\s*if \(sampleSaved\)/, '导入完成后也走统一出口');
  assert.match(rendererUi, /overlay\.id === 'recognizeModal' && typeof closeRecognizeModal === 'function'/,
    '点遮罩关闭也走统一出口');
});
