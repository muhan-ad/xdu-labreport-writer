'use strict';
async function testApi(params, {endpoint, defaultModel, getKey, network, makeDeadline = () => AbortSignal.timeout(30000)}) {
  const start=Date.now();
  const deadline=makeDeadline();
  try {
    const base=endpoint(params), key=typeof params.key==='string' && params.key.trim() ? params.key.trim() : getKey(base);
    if (!key) return {ok:false,kind:'config',error:'当前地址未配置API密钥',elapsedMs:Date.now()-start};
    const result=await network.json(base+'/chat/completions',{method:'POST',signal:deadline,timeoutMs:30000,idleTimeoutMs:0,maxBytes:1024*1024,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:params.model || defaultModel(params.provider),messages:[{role:'user',content:'Reply with OK only.'}],max_tokens:128,stream:false})});
    if (result.error) return {ok:false,kind:'model',error:'服务返回模型调用错误',elapsedMs:Date.now()-start};
    if (typeof result.choices?.[0]?.message?.content !== 'string' || !result.choices[0].message.content.trim()) return {ok:false,kind:'empty',error:'已连接服务，但未取得有效回答',elapsedMs:Date.now()-start};
    return {ok:true,kind:'success',message:'连接成功，模型可正常调用',elapsedMs:Date.now()-start};
  } catch(e) {
    const message=String(e.code || '')+' '+String(e.message || '');
    let kind='network', error='连接失败，请检查网络或服务地址';
    if (deadline.aborted) {kind='timeout';error='测试超时（30秒），未取得完整回答';}
    else if (/401|403/.test(message)) {kind='auth';error='鉴权失败，请检查密钥及访问权限';}
    else if (/402/.test(message)) {kind='balance';error='API余额不足，请在服务商开放平台检查余额';}
    else if (/429/.test(message)) {kind='rate';error='服务限流或额度不足';}
    else if (/400|404|422/.test(message)) {kind='model';error='接口或模型不可用，请检查地址和模型名称';}
    else if (/timeout|timed out|超时/i.test(message) || e.name==='TimeoutError' || e.cause?.name==='TimeoutError') {kind='timeout';error='测试超时（30秒），未取得完整回答';}
    else if (/aborted|ECONNRESET|terminated|socket hang up/i.test(message)) {kind='interrupted';error='API响应连接中断';}
    else if (/密钥|credential|配置|公网|HTTPS|地址/.test(message)) {kind='config';error='API地址或密钥配置无效，请检查配置';}
    return {ok:false,kind,error,elapsedMs:Date.now()-start};
  }
}
module.exports={testApi};
