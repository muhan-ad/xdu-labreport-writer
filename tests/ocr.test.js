'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  assert.equal(scripts.length, 26);
  for (const file of scripts) assert.match(fs.readFileSync(file, 'utf8'), /doc\.add_data_photo\(/, path.basename(path.dirname(file)));
});
