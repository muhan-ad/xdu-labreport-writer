'use strict';
const SYSTEMS = Object.freeze([
  { id: 'report', name: '物理实验报告提交系统', url: 'http://wlsy.xidian.edu.cn/wgyreport/wgyreport.dll/?id=stu', prefix: '/wgyreport/' },
  { id: 'course', name: '物理实验报告网络选课系统', url: 'http://wlsy.xidian.edu.cn/PhyEws/default.aspx', prefix: '/PhyEws/' },
  { id: 'exam', name: '物理实验试题库系统', url: 'http://wlsy.xidian.edu.cn/wgyexam/wgyexam.dll?id=stu', prefix: '/wgyexam/' },
  { id: 'simulation', name: '虚拟仿真系统', url: 'https://wlxnfzsy.xidian.edu.cn/', prefix: '/' },
]);
function getSystem(id = 'report') {
  const value = SYSTEMS.find(system => system.id === id);
  if (!value) throw Error('请选择有效的学校系统');
  return value;
}
function allowedUrl(raw) {
  try {
    const url = new URL(raw);
    return !url.username && !url.password && !url.port &&
      ((url.hostname === 'wlsy.xidian.edu.cn' && ['http:', 'https:'].includes(url.protocol)) ||
       (['wlxnfzsy.xidian.edu.cn', 'wlsytest.xidian.edu.cn', 'wlsyinfo.xidian.edu.cn'].includes(url.hostname) && url.protocol === 'https:'));
  } catch (_) { return false; }
}
function blockedTarget(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return url.protocol;
    // Never expose query parameters, fragments or user information carrying login secrets.
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 240);
  } catch (_) { return '无效地址'; }
}
function systemForUrl(raw) {
  if (!allowedUrl(raw)) return null;
  const url = new URL(raw);
  // The preview site is a navigation destination, not a credential target.
  // Its SSO links must work without forwarding another site's saved password.
  return SYSTEMS.find(s => new URL(s.url).hostname === url.hostname && url.pathname.toLowerCase().startsWith(s.prefix.toLowerCase())) || null;
}
function allowedRequest(details) {
  if (allowedUrl(details.url)) return true;
  if (/^(?:data:|blob:|about:blank$)/.test(details.url)) return true;
  try {
    const url = new URL(details.url);
    // The report login page loads these public UI assets. They are never credential targets.
    return url.protocol === 'https:' && url.hostname === 'cdn.falconsistemas.com.br' && !url.port && !url.username && !url.password &&
      url.pathname.startsWith('/falcon/') && ['script', 'stylesheet', 'image', 'font'].includes(details.resourceType);
  } catch (_) { return false; }
}
module.exports = { SYSTEMS, getSystem, allowedUrl, allowedRequest, systemForUrl, blockedTarget };
