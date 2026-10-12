'use strict';
// OpenAI-compatible discovery uses the same endpoint and protected transport as chat.
async function fetchModels(params, {endpoint, getKey, network, makeDeadline = () => AbortSignal.timeout(30000)}) {
  const deadline = makeDeadline();
  try {
    const base = endpoint(params);
    const key = typeof params.key === 'string' && params.key.trim() ? params.key.trim() : getKey(base);
    if (!key) return {ok:false,error:'当前地址未配置 API 密钥'};
    const result = await network.json(base + '/models', {
      method:'GET', signal:deadline, timeoutMs:30000, idleTimeoutMs:0, maxBytes:1024*1024,
      headers:{Authorization:'Bearer ' + key},
    });
    if (!Array.isArray(result.data)) return {ok:false,error:'服务未返回兼容的模型列表，请手动填写模型名称'};
    const models = [...new Set(result.data.map(x => x?.id).filter(x => typeof x === 'string' && x.trim() && x.length <= 256))].sort();
    if (!models.length) return {ok:false,error:'模型列表为空，请手动填写模型名称'};
    return {ok:true,models};
  } catch (e) {
    const message = String(e.code || '') + ' ' + String(e.message || '');
    let error = '获取失败，请检查网络、API 地址或手动填写模型名称';
    if (deadline.aborted) error = '获取模型超时（30秒）';
    else if (/401|403/.test(message)) error = '鉴权失败，请检查密钥及访问权限';
    else if (/429/.test(message)) error = '服务限流，请稍后重试';
    else if (/404|405/.test(message)) error = '该服务不支持获取模型列表，请手动填写模型名称';
    else if (/timeout|timed out|超时/i.test(message) || e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError') error = '获取模型超时（30秒）';
    else if (/密钥|credential|配置|公网|HTTPS|地址/.test(message)) error = 'API 地址或密钥配置无效，请检查配置';
    return {ok:false,error};
  }
}
module.exports = {fetchModels};
