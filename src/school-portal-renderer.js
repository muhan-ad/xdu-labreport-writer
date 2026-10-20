'use strict';
const portalApi = window.schoolPortal;
const el = id => document.getElementById(id);
let notice = '', configured = false, available = false, corrupt = false, busy = false, loading = false;
let currentSystemId = 'report', systemsKey = '', credentialRefreshNeeded = false;
const sensitiveIds = ['autofill'];
function updateButtons() {
  for (const id of sensitiveIds) el(id).disabled = busy || !configured || !available || (id === 'autofill' && loading);
  for (const id of ['reload', 'clearLogin', 'retry', 'manageCredentials', 'closeCredentials', 'openSettings', 'closeSettings', 'autoFillEnabled']) el(id).disabled = busy;
  el('systemSelect').disabled = busy || (el('credentialsDialog').open || el('portalSettings').open);
  el('saveCredentials').disabled = busy || !available;
  el('deleteCredentials').disabled = busy || !(configured || corrupt);
}
function setStatus(message) { notice = message; el('status').textContent = message; el('status').title = message; el('portalSettingsStatus').textContent = message; }
function clearInputs() { el('credentialAccount').value = ''; el('credentialPassword').value = ''; }
function credentialStatus(result) {
  configured = !!result.configured; available = !!result.available; corrupt = !!result.corrupt;
  el('credentialState').textContent = corrupt ? '保存的配置无法读取，请重新输入保存或删除。' : !available
    ? '系统加密不可用，已禁用保存和自动填充。' : configured ? '已加密保存一组账号密码 · 内容不回显' : '尚未保存账号密码';
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
  autofill: 'autofill' })) el(id).onclick = () => run(action);
el('manageCredentials').onclick = async () => {
  const result = await run('manage-credentials');
  if (!result.ok || result.cancelled) return;
  credentialStatus(result); clearInputs(); el('credentialMessage').textContent = '';
  el('portalSettings').close(); el('credentialsDialog').showModal(); updateButtons(); el('credentialAccount').focus();
};
async function closeManager() {
  if (busy) return;
  clearInputs();
  const result = await run('close-credentials');
  if (result.ok) { el('credentialsDialog').close(); await run('open-settings'); el('portalSettings').showModal(); updateButtons(); }
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
el('systemSelect').onchange = async () => {
  const result = await run('switch-system', { systemId: el('systemSelect').value });
  if (!result.ok || result.external) el('systemSelect').value = currentSystemId;
};
async function refreshCredentials(id = currentSystemId) {
  const result = await run('credential-status');
  if (result.ok && id === currentSystemId) credentialStatus(result);
}
portalApi.onState(state => {
  document.body.classList.toggle('portal-embedded',!!state.embedded);
  if (Array.isArray(state.systems)) {
    const key = JSON.stringify(state.systems);
    if (key !== systemsKey) {
      systemsKey = key; el('systemSelect').replaceChildren(...state.systems.map(system => {
        const option = document.createElement('option'); option.value = system.id; option.textContent = system.name; return option;
      }));
    }
  }
  const changed = !!state.systemId && state.systemId !== currentSystemId;
  if (state.systemId) { currentSystemId = state.systemId; el('systemSelect').value = currentSystemId; }
  el('domain').textContent = state.domain || '';
  el('credentialSystem').textContent = el('systemSelect').selectedOptions[0]?.textContent || '学校系统';
  if (changed) { configured = false; corrupt = false; clearInputs(); credentialRefreshNeeded = true; }

  if (typeof state.autoFillEnabled === 'boolean') el('autoFillEnabled').checked = state.autoFillEnabled;
  busy = !!state.busy; loading = !!state.loading;
  if (credentialRefreshNeeded && !busy) { credentialRefreshNeeded = false; refreshCredentials(currentSystemId); }
  if (state.loading || state.busy || state.error) notice = '';
  el('back').disabled = !state.canBack || busy;
  updateButtons();
  el('connection').textContent = state.secure ? 'HTTPS · 加密连接' : 'HTTP · 未加密';
  const status = state.clearing ? '正在清除登录状态…' : state.busy ? '正在处理…' : state.error ? '连接未完成' : state.loading ? '正在加载…' : notice || '学校网页';
  el('status').textContent = status; el('status').title = status;
  el('errorPanel').hidden = !state.error;
  el('errorText').textContent = state.error || '';
});
portalApi.onNotice(setStatus);
portalApi.onBlocked(target => setStatus(target ? `已阻止访问：${target}` : '已阻止访问其他站点或本地地址。'));
portalApi.onDownloadBlocked(() => setStatus('当前内置窗口不支持下载文件，请在浏览器中完成下载。'));
el('openSettings').onclick = async () => {
  if ((await run('open-settings')).ok) { el('portalSettings').showModal(); updateButtons(); }
};
async function closeSettings() {
  if (busy) return;
  if ((await run('close-settings')).ok) { el('portalSettings').close(); updateButtons(); }
}
el('closeSettings').onclick = closeSettings;
el('portalSettings').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
el('autoFillEnabled').onchange = async () => {
  const result = await run('set-auto-fill', { enabled: el('autoFillEnabled').checked });
  if (!result.ok) await run('state');
};
run('state');
refreshCredentials();
window.addEventListener('pagehide', clearInputs);

// Keep the local popup above the separate school WebContentsView.
document.addEventListener('unified-select-toggle',event=>{
 if(event.detail?.select?.id!=='systemSelect')return;
 void portalApi.action('dropdown-visibility',{open:!!event.detail.open}).catch(()=>{});
});
