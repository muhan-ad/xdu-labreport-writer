'use strict';

const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const VISION_PROVIDERS = Object.freeze({
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-VL-32B-Instruct' },
  bailian: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' },
  custom: { baseUrl: '', model: 'gpt-4o' },
});

function parseImageDataUrl(value) {
  const match = IMAGE_RE.exec(String(value || ''));
  if (!match) throw Error('图片格式无效，仅支持 JPEG、PNG 或 WebP');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Error('识别图片为空或超过 8MB 上限');
  const valid = hasImageSignature(match[1], bytes);
  if (!valid) throw Error('图片内容与声明格式不一致');
  return { mime: match[1], bytes, dataUrl: String(value) };
}

function hasImageSignature(mime, bytes) {
  return mime === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8
    : mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function visionPreset(provider) {
  return VISION_PROVIDERS[provider] || VISION_PROVIDERS.custom;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content.map(item => typeof item === 'string' ? item : item?.text || '').join('');
    if (text.trim()) return text;
  }
  throw Error('识图服务返回了空内容');
}

module.exports = { MAX_IMAGE_BYTES, VISION_PROVIDERS, parseImageDataUrl, hasImageSignature, visionPreset, extractContent };
