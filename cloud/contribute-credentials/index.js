'use strict';

// Contribution upload credential function (COS presigned PUT, zero dependencies).
// Secrets live only in this function's environment variables, never in the client app.

const crypto = require('crypto');

const BUCKET = process.env.BUCKET || '';
const REGION = process.env.REGION || 'ap-guangzhou';
// Accept both SECRET_ID/SECRET_KEY and the console-prefilled Secret_Id/Secret_Key spellings
const SECRET_ID = process.env.SECRET_ID || process.env.Secret_Id || '';
const SECRET_KEY = process.env.SECRET_KEY || process.env.Secret_Key || '';
const EXPIRES = 600;

// Allowed key shape: contributions/<variants|reports>/<exp>/<timestamp>/<file>
const KEY_RE = /^contributions\/(?:(?:variants|reports)\/[^/]+\/[^/]+\/[^/]+|feedbacks\/[^/]+\/[^/]+)$/;
const limits = new Map();
function takeQuota(ip, bytes) {
  const now = Date.now();
  for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
  const current = limits.get(ip) || { until: now + 3600000, count: 0, bytes: 0 };
  if (limits.size >= 2000 && !limits.has(ip)) return false;
  if (current.count >= 20 || current.bytes + bytes > 100 * 1024 * 1024) return false;
  current.count++; current.bytes += bytes; limits.set(ip, current); return true;
}


function cosSignPutUrl(key, size) {
  const host = BUCKET + '.cos.' + REGION + '.myqcloud.com';
  const now = Math.floor(Date.now() / 1000);
  const keyTime = now + ';' + (now + EXPIRES);
  const signKey = crypto.createHmac('sha1', SECRET_KEY).update(keyTime).digest('hex');

  const method = 'put';
  // COS verifies the signature against the RAW key path (UTF-8), while the URL itself must be percent-encoded
  const rawPathname = '/' + key;
  const encodedPathname = '/' + key.split('/').map(encodeURIComponent).join('/');
  const params = {
    'q-sign-algorithm': 'sha1',
    'q-ak': SECRET_ID,
    'q-sign-time': keyTime,
    'q-key-time': keyTime,
  };
  const headers = { 'content-type': 'application/octet-stream', 'content-length': String(size), 'x-cos-forbid-overwrite': 'true', 'host': host };

  const paramKeys = Object.keys(params).sort();
  const headerKeys = Object.keys(headers).sort();
  const httpParams = paramKeys.map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  const httpHeaders = headerKeys.map(function (k) { return k + '=' + encodeURIComponent(headers[k]); }).join('&');
  const httpString = method + '\n' + rawPathname + '\n' + httpParams + '\n' + httpHeaders + '\n';
  const httpStringHash = crypto.createHash('sha1').update(httpString).digest('hex');
  const stringToSign = 'sha1\n' + keyTime + '\n' + httpStringHash + '\n';
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');

  const qs = [
    'q-sign-algorithm=sha1',
    'q-ak=' + encodeURIComponent(SECRET_ID),
    'q-sign-time=' + encodeURIComponent(keyTime),
    'q-key-time=' + encodeURIComponent(keyTime),
    'q-header-list=' + headerKeys.join(';'),
    'q-url-param-list=' + paramKeys.join(';'),
    'q-signature=' + signature,
  ].join('&');
  return 'https://' + host + encodedPathname + '?' + qs;
}

exports.main_handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const reply = function (statusCode, obj) { return { statusCode: statusCode, headers: headers, body: JSON.stringify(obj) }; };
  try {
    if (event && event.httpMethod === 'OPTIONS') return reply(200, { ok: true });
    if (!BUCKET || !SECRET_ID || !SECRET_KEY) {
      return reply(500, { ok: false, error: 'env not configured' });
    }
    if (event?.httpMethod !== 'POST') return reply(405, { ok: false, error: 'POST required' });
    if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 32768) return reply(413, { ok: false, error: 'body too large' });
    let files = [];
    try {
      const body = JSON.parse((event && typeof event.body === 'string') ? event.body : '{}');
      files = Array.isArray(body.files) ? body.files : [];
    } catch (e) {
      return reply(400, { ok: false, error: 'body must be JSON' });
    }
    if (!files.length || files.length > 20) {
      return reply(400, { ok: false, error: 'keys count must be 1-20' });
    }
    const valid = [];
    let total = 0;
    const seen = new Set();
    for (const file of files) {
      const k = file.key;
      if (typeof k !== 'string' || k.length > 500 || !KEY_RE.test(k) || /[\\:\x00-\x1f]/.test(k) || k.split('/').some(p => p.startsWith('.') || /[. ]$/.test(p)) || !/\.(json|docx|jpg|jpeg|png)$/i.test(k) || seen.has(k)) {
        return reply(400, { ok: false, error: 'invalid key: ' + String(k).slice(0, 120) });
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 20 * 1024 * 1024) return reply(413, { ok: false, error: 'invalid file size' });
      total += file.size; seen.add(k); valid.push(file);
    }
    if (total > 40 * 1024 * 1024) return reply(413, { ok: false, error: 'batch too large' });
    // Only trust the platform request context, never X-Forwarded-For supplied by a client.
    const ip = event.requestContext?.sourceIp || event.requestContext?.identity?.sourceIp;
    if (!ip || !takeQuota(ip, total)) return reply(429, { ok: false, error: 'upload quota exceeded or source unavailable' });
    const submission = crypto.randomUUID();
    const items = valid.map(file => {
      const parts = file.key.split('/'); parts[parts.length - 2] = submission;
      const objectKey = parts.join('/');
      return { key: file.key, objectKey, size: file.size, putUrl: cosSignPutUrl(objectKey, file.size) };
    });
    return reply(200, { ok: true, items: items, expires: EXPIRES });
  } catch (err) {
    return reply(500, { ok: false, error: err.message });
  }
};