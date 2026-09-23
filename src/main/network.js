'use strict';
const https = require('https');
const dns = require('dns');
const ipaddr = require('ipaddr.js');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

function blocked(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || /\.(localhost|local|lan)$/.test(h)) return true;
  if (!ipaddr.isValid(h)) return false;
  return ipaddr.process(h).range() !== 'unicast';
}
function publicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || blocked(u.hostname)) throw Error('地址必须为公网 HTTPS，且不能包含用户名或密码');
  return u;
}
function lookup(host, options, callback) {
  dns.lookup(host, { all: true }, (err, addresses) => {
    if (err || !addresses?.length || addresses.some(a => blocked(a.address))) return callback(err || Error('连接地址不是公网地址'));
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}
async function response(raw, options = {}, redirects = 0) {
  const url = publicUrl(raw);
  if (options.allowedHost && url.hostname !== options.allowedHost) throw Error('下载来源不在允许列表');
  // 空闲超时可单独配置：大模型（识图/对话）可能在首字节前安静思考几十秒，
  // 用固定的 15 秒会给"总期限还有富余"的请求误报网络超时（历史缺陷 R14）。
  // 显式传 0 表示不设空闲超时（识图这类非流式长请求在模型算完前没有任何数据，
  // 空闲计时必然先于总超时触发，中止交给用户「取消」）。
  const idleRaw = options.idleTimeoutMs === undefined ? 15000 : Number(options.idleTimeoutMs);
  const idleMs = idleRaw > 0 ? idleRaw : 0;
  const reqOptions = { ...options, lookup, headers: { 'User-Agent': 'labreport-writer', ...options.headers } };
  if (idleMs > 0) reqOptions.timeout = idleMs;
  const res = await new Promise((resolve, reject) => {
    const req = https.request(url, reqOptions, resolve);
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('网络连接超时')));
    req.end(options.body);
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    if (redirects >= 4 || (options.method && options.method !== 'GET')) throw Error('不允许此重定向');
    return response(new URL(res.headers.location, url).href, options, redirects + 1);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    res.resume(); throw Error(`HTTP ${res.statusCode}`);
  }
  return res;
}
async function json(url, options = {}) {
  // timeoutMs：默认 30 秒；显式传 0 表示不设总超时（长任务由调用方用 signal/用户取消来中止）
  const ms = options.timeoutMs === undefined ? 30000 : Number(options.timeoutMs);
  const timeout = ms > 0 ? AbortSignal.timeout(ms) : null;
  const signal = timeout && options.signal ? AbortSignal.any([timeout, options.signal])
    : (options.signal || timeout || undefined);
  const res = await response(url, { ...options, signal, idleTimeoutMs: options.idleTimeoutMs });
  const chunks = []; let size = 0;
  // maxBytes：默认 1MB；显式传 0 表示不限制
  const maxBytes = options.maxBytes === undefined ? 1024 * 1024 : Number(options.maxBytes);
  for await (const chunk of res) {
    size += chunk.length;
    if (maxBytes > 0 && size > maxBytes) { res.destroy(); throw Error('响应内容过大'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function download(url, dest, { signal, maxBytes, expectedSize, allowedHost, progress }) {
  const res = await response(url, { signal, allowedHost });
  let size = 0;
  const cap = new Transform({ transform(chunk, _, cb) {
    size += chunk.length;
    if (size > maxBytes || size > expectedSize) return cb(Error('更新包超出声明大小'));
    progress?.(Math.min(99, Math.round(size * 100 / expectedSize))); cb(null, chunk);
  } });
  try {
    await pipeline(res, cap, fs.createWriteStream(dest, { flags: 'wx' }), { signal });
    if (size !== expectedSize) throw Error('更新包大小与清单不一致');
  } catch (e) { if (fs.existsSync(dest)) fs.unlinkSync(dest); throw e; }
}
module.exports = { blocked, publicUrl, lookup, response, json, download };
