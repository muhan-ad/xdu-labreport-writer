'use strict';
// 执行于网页隔离世界；只返回状态，不回传网页值或凭据。
function fillLoginForm(expectedUrl, username, password) {
  const siteUrl = raw => {
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname === 'wlsy.xidian.edu.cn'
        && !url.port && !url.username && !url.password;
    } catch (_) { return false; }
  };
  if (location.href !== expectedUrl || !siteUrl(location.href)) return { filled: false };
  const visible = input => {
    const rect = input.getBoundingClientRect(), style = getComputedStyle(input);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility === 'visible'
      && !input.disabled && !input.readOnly;
  };
  const cached = globalThis.__labreportSchoolLoginFields;
  const cachedAccount = cached?.account?.isConnected && visible(cached.account) ? cached.account : null;
  const passwordInputs = [...document.querySelectorAll('input[type="password"]')].filter(input => input !== cachedAccount && visible(input));
  if (passwordInputs.length !== 1 || passwordInputs[0].autocomplete === 'new-password') return { filled: false };
  const passwordInput = passwordInputs[0], form = passwordInput.form;
  if (form && !siteUrl(form.action || location.href)) return { filled: false };
  const inputs = [...(form ? form.elements : document.querySelectorAll('input'))].filter(input =>
    input instanceof HTMLInputElement && ['text', 'email', 'tel'].includes(input.type) && visible(input));
  const candidates = inputs.filter(input => !/captcha|verify|checkcode|validation|rand|验证码|校验码|动态码/i.test(
    `${input.name} ${input.id} ${input.placeholder}`) && input.autocomplete !== 'one-time-code');
  const named = candidates.filter(input => input.autocomplete === 'username' ||
    /user|account|student|login|xuehao|学号|账号|用户名|^(?:xh|sno|stu)$/i.test(`${input.name} ${input.id} ${input.placeholder}`.trim()));
  const account = cached?.password === passwordInput && cachedAccount ? cachedAccount
    : named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : null;
  if (!account || account.form !== passwordInput.form) return { filled: false };
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  // 管理界面不显示明文；填入网页的输入框也使用掩码，不点击提交。
  account.type = 'password';
  account.autocomplete = 'off';
  globalThis.__labreportSchoolLoginFields = { account, password: passwordInput };
  setValue.call(account, username); setValue.call(passwordInput, password);
  for (const input of [account, passwordInput]) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { filled: true };
}

function autofillScript(url, credentials) {
  return `(${fillLoginForm.toString()})(${JSON.stringify(url)},${JSON.stringify(credentials.username)},${JSON.stringify(credentials.password)})`;
}
module.exports = { fillLoginForm, autofillScript };
