'use strict';
const portalApi = window.schoolPortal;
const el = id => document.getElementById(id);
let notice = '', configured = false, available = false, corrupt = false, busy = false, loading = false;
const sensitiveIds = ['autofill', 'copyAccount', 'copyPassword'];
function updateButtons() {
  for (const id of sensitiveIds) el(id).disabled = busy || !configured || !available || (id === 'autofill' && loading);
  for (const id of ['reload', 'clearLogin', 'retry', 'manageCredentials', 'closeCredentials']) el(id).disabled = busy;
  el('saveCredentials').disabled = busy || !available;
  el('deleteCredentials').disabled = busy || !(configured || corrupt);
}
function setStatus(message) { notice = message; el('status').textContent = message; el('status').title = message; }
function clearInputs() { el('credentialAccount').value = ''; el('credentialPassword').value = ''; }
function credentialStatus(result) {
  configured = !!result.configured; available = !!result.available; corrupt = !!result.corrupt;
  el('credentialState').textContent = corrupt ? '保存的配置无法读取，请重新输入保存或删除。' : !available
    ? '系统加密不可用，已禁用保存、复制和自动填充。' : configured ? '已加密保存一组账号密码 · 内容不回显' : '尚未保存账号密码';
  updateButtons();
}
async function run(name, payload) {
  if (name !== 'state' && name !== 'credential-status') notice = '';
  try {
    const result = await portalApi.action(name, payload);
    if (!result.ok) setStatus(result.error || '操作未完成，请稍后重试。');
    else if (result.message) setStatus(result.message);
    return result;
  } catch (_) { const result = { ok: false, error: '操作未完成，请关闭窗口后重试。' }; setStatus(result.error); return result; }
}
for (const [id, action] of Object.entries({ back: 'back', reload: 'reload', clearLogin: 'clear-login', retry: 'home',
  autofill: 'autofill', copyAccount: 'copy-account', copyPassword: 'copy-password' })) el(id).onclick = () => run(action);
el('manageCredentials').onclick = async () => {
  const result = await run('manage-credentials');
  if (!result.ok || result.cancelled) return;
  credentialStatus(result); clearInputs(); el('credentialMessage').textContent = '';
  el('credentialsDialog').showModal(); el('credentialAccount').focus();
};
async function closeManager() {
  if (busy) return;
  clearInputs();
  const result = await run('close-credentials');
  if (result.ok) el('credentialsDialog').close();
}
el('closeCredentials').onclick = closeManager;
el('credentialsDialog').addEventListener('cancel', event => { event.preventDefault(); closeManager(); });
el('credentialForm').onsubmit = async event => {
  event.preventDefault();
  if (busy || !available) return;
  const payload = { username: el('credentialAccount').value, password: el('credentialPassword').value };
  clearInputs();
  const result = await run('save-credentials', payload);
  payload.username = ''; payload.password = '';
  if (result.ok && !result.cancelled) credentialStatus(result);
  el('credentialMessage').textContent = result.cancelled ? '未保存，请重新输入后再试。' : result.message || result.error || '';
};
el('deleteCredentials').onclick = async () => {
  const result = await run('delete-credentials');
  if (result.ok && !result.cancelled) { clearInputs(); credentialStatus(await run('credential-status')); }
  el('credentialMessage').textContent = result.message || result.error || '';
};
portalApi.onState(state => {
  busy = !!state.busy; loading = !!state.loading;
  if (state.loading || state.busy || state.error) notice = '';
  el('back').disabled = !state.canBack || busy;
  updateButtons();
  el('connection').textContent = state.secure ? 'HTTPS · 加密连接' : 'HTTP · 未加密';
  const status = state.clearing ? '正在清除登录状态…' : state.busy ? '正在处理…' : state.error ? '连接未完成' : state.loading ? '正在加载…' : notice || '学校网页';
  el('status').textContent = status; el('status').title = status;
  el('errorPanel').hidden = !state.error;
  el('errorText').textContent = state.error || '';
});
portalApi.onBlocked(() => setStatus('已阻止访问其他站点或本地地址。'));
portalApi.onDownloadBlocked(() => setStatus('当前内置窗口不支持下载文件，请在浏览器中完成下载。'));
run('state');
run('credential-status').then(result => { if (result.ok) credentialStatus(result); });
window.addEventListener('pagehide', clearInputs);
