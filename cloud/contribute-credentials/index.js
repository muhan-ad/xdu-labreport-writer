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
const KEY_RE = /^contributions\/(variants|reports)\/[^/]+\/[^/]+\/[^/]+$/;

function cosSignPutUrl(key) {
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
  const headers = { 'content-type': 'application/octet-stream', 'host': host };

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
    let keys = [];
    try {
      const body = JSON.parse((event && typeof event.body === 'string') ? event.body : '{}');
      keys = Array.isArray(body.keys) ? body.keys : [];
    } catch (e) {
      return reply(400, { ok: false, error: 'body must be JSON' });
    }
    if (!keys.length || keys.length > 20) {
      return reply(400, { ok: false, error: 'keys count must be 1-20' });
    }
    const valid = [];
    for (const k of keys) {
      if (typeof k !== 'string' || !KEY_RE.test(k)) {
        return reply(400, { ok: false, error: 'invalid key: ' + String(k).slice(0, 120) });
      }
      valid.push(k);
    }
    const items = valid.map(function (k) { return { key: k, putUrl: cosSignPutUrl(k) }; });
    return reply(200, { ok: true, items: items, expires: EXPIRES });
  } catch (err) {
    return reply(500, { ok: false, error: err.message });
  }
};