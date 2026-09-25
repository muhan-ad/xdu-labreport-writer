'use strict';
// Node 默认的全局 Agent 自带 5 秒 socket 空闲超时（http.globalAgent.options.timeout === 5000），
// 且 Agent.createSocket 里 `req.timeout || this.options.timeout` 会把它无条件套到每个连接上。
// 后果：识图这类非流式请求（模型算完之前连接上零字节）会被静默掐断，用户看到「网络连接超时」，
// 而调用方传的 idleTimeoutMs: 0 根本管不到它。network.js 因此必须改用自建的无超时 Agent，
// 同时保证调用方显式传入的空闲超时仍然生效（其它请求的安全网不能丢）。
const assert = require('node:assert');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const https = require('https');

// 桩掉 https.request：不发真实请求，只抓取实际传给它的选项（在 require network 之前打桩）
const captured = [];
https.request = function stubbedRequest(url, options, cb) {
  captured.push({ url, options });
  const req = new EventEmitter();
  req.end = () => {};
  req.destroy = () => {};
  const res = Readable.from([Buffer.from('{"ok":true}')]);
  res.statusCode = 200;
  res.headers = {};
  process.nextTick(() => cb(res));
  return req;
};

const network = require('../src/main/network');

test('connection pool carries no hidden socket timeout', () => {
  assert.ok(network.agent instanceof https.Agent, 'network 必须导出自建连接池');
  assert.ok(!network.agent.options.timeout,
    '自建 Agent 不得带 socket 空闲超时（Node 全局 Agent 默认 5 秒会掐死识图这类非流式长请求）');
  assert.equal(network.agent.options.keepAlive, true, '保持连接复用，不能退化成每次请求都重新握手');
});

test('every request runs on that agent instead of the global one', async () => {
  captured.length = 0;
  const out = await network.json('https://example.com/v1/chat/completions', { method: 'POST', body: '{}' });
  assert.deepEqual(out, { ok: true });
  assert.equal(captured.length, 1, '只应发出一次请求');
  assert.equal(captured[0].options.agent, network.agent, '请求必须走自建 Agent');
  assert.equal(captured[0].options.timeout, 15000, '未显式指定时仍是 15 秒空闲超时（其它调用方的安全网不变）');
});

test('explicit idleTimeoutMs 0 leaves the socket with no timeout at all', async () => {
  captured.length = 0;
  await network.json('https://example.com/v1/chat/completions', {
    method: 'POST', body: '{}', timeoutMs: 0, idleTimeoutMs: 0,
  });
  assert.ok(!('timeout' in captured[0].options) || captured[0].options.timeout === undefined,
    '显式传 0 时连接上不得再有任何超时（识图/对话只能由用户主动取消）');
});

test('a positive idleTimeoutMs still arms the socket timeout', async () => {
  captured.length = 0;
  await network.json('https://example.com/v1/x', { idleTimeoutMs: 7000 });
  assert.equal(captured[0].options.timeout, 7000, '显式指定的空闲超时要能覆盖 Agent 默认值');
});
