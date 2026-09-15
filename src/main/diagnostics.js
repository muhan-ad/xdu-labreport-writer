'use strict';

// Diagnostics: privacy-safe export of runtime logs for developer issue triage.
// Keep this module dependency-free so it can be unit-tested outside Electron.

// ── Sanitization ──

const KEY_RE = /sk-[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/g;
const SIGN_PAIR_RE = /(q-signature|q-ak)=[A-Za-z0-9%_.\-/]+/g;
const SECRET_PAIR_RE = /(secret(id|key)|api[_-]?key|password|token)\s*[=:]\s*[^\s,;]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 学号等 10-12 位纯数字长串（测量值通常 <10 位），无捕获组、无全局状态，掩码保留末 4 位
const LONG_DIGITS_RE = /[0-9]{10,12}/g;
// 本地绝对路径：C:\Users\<名>\... 与 file:///C:/...
const USERPATH_RE = /[A-Za-z]:[\\/][^\\/]+[\\/][^\\/:*?"<>|]+(?=[\\/,;\s:)"']|$)/g;

function sanitize(text, roots) {
  const knownRoots = roots || [];
  let out = String(text == null ? '' : text);
  // 已知根目录字面量置换成占位符（先于通用路径规则；反斜杠/正斜杠两种形态都替换）
  for (const r of knownRoots) {
    if (!r) continue;
    const raw = String(r);
    const fwd = raw.replace(/\\/g, '/');
    out = out.split(raw).join('{ROOT}');
    if (fwd !== raw) out = out.split(fwd).join('{ROOT}');
  }
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/g, 'Bearer ***');
  out = out.replace(/q-signature=[0-9a-f]{20,}/gi, 'q-signature=***');
  out = out.replace(/(q-ak|q-sign-time|q-key-time)=[A-Za-z0-9%_.\-/]+/g, '$1=***');
  out = out.replace(SECRET_PAIR_RE, '$1=***');
  out = out.replace(EMAIL_RE, '[EMAIL]');
  out = out.replace(LONG_DIGITS_RE, num => '****' + num.slice(-4));
  out = out.replace(USERPATH_RE, m => {
    const parts = m.split(/[\\/]/);
    const name = parts[parts.length - 1] || m;
    return '<路径>' + name;
  });
  return out;
}

function maskName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return '';
  if (s.length <= 1) return s + '*';
  return s[0] + '*'.repeat(Math.min(s.length - 1, 3));
}

// ── Build the export document ──

function buildDiagnostics(sources) {
  const p = sources || {};
  const L = [];
  const hr = '='.repeat(64);

  L.push('实验搭子 · 诊断日志');
  L.push(`导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  L.push(hr);

  L.push('【环境信息】');
  L.push(`应用版本：v${p.appVersion || '?'}`);
  L.push(`打包：${p.packaged === undefined ? '?' : p.packaged}`);
  L.push(`Electron：${p.electron || '?'} | Chrome：${p.chrome || '?'} | Node：${p.node || '?'}`);
  L.push(`平台：${p.platform || '?'} / ${p.arch || '?'} | 语言：${p.locales || '?'}`);
  L.push(`数据版本：本地 ${p.dataVersion || '?'}（内置 ${p.builtinVersion || '?'}）`);
  if (p.updateInfo) {
    L.push(`更新：当前 v${p.updateInfo.current || '?'}${p.updateInfo.hasUpdate ? ' → 可更新 v' + p.updateInfo.latest : '（已是最新）'}`);
  }
  L.push(hr);

  L.push('【配置摘要（已脱敏）】');
  L.push(`AI 供应商：${p.config ? p.config.provider || '?' : '?'} | 模型：${p.config ? p.config.model || '（默认）' : '?'}`);
  L.push(`API 地址：${p.config && p.config.apiUrl ? p.config.apiUrl : '（默认）'}`);
  L.push(`自动润色：${!!(p.config && p.config.aiPolish)} | 限定知识库：${!!(p.config && p.config.kbOnly)} | 开发者模式：${!!(p.config && p.config.developerMode)}`);
  L.push(`已启用技能：${(p.config && p.config.skills && p.config.skills.length) ? p.config.skills.join('、') : '（无）'}`);
  L.push(hr);

  L.push('【学生信息摘要（已掩码）】');
  L.push(`姓名：${maskName(p.student && p.student.name)} | 学号：${p.student && p.student.id ? '****' + String(p.student.id).slice(-4) : '（未填写）'}`);
  L.push(`班级：${maskName(p.student && p.student.class)} | 日期：${(p.student && p.student.date) || '—'}`);
  L.push(hr);

  L.push('【界面状态】');
  L.push(`实验总数：${p.expCount === undefined ? '?' : p.expCount} | 队列状态：${p.queueState || 'idle'}（长度 ${p.queueSize === undefined ? 0 : p.queueSize}）`);
  L.push(hr);

  L.push('【渲染进程最近错误】');
  const errs = Array.isArray(p.renderErrors) ? p.renderErrors : [];
  if (!errs.length) L.push('（无）');
  for (const e of errs.slice(-60)) {
    L.push(`[${e.time}] ${e.type || 'error'}: ${e.message}`);
    if (e.detail) L.push(`    ${e.detail}`);
  }
  L.push(hr);

  L.push('【运行日志（启动至今）】');
  const runLog = String(p.runLog || '（无）');
  L.push(runLog.trim() ? runLog : '（无）');
  L.push(hr);

  L.push('【最近生成日志（含测量数值，已脱敏路径）】');
  const genLogs = Array.isArray(p.generationLogs) ? p.generationLogs : [];
  if (!genLogs.length) L.push('（暂无生成记录）');
  genLogs.forEach((g, i) => {
    L.push(`--- 第 ${i + 1} 次（${g.time || '?'}，实验：${g.exp || '?'}，exit=${g.exitCode}, ok=${g.ok}）---`);
    L.push(String(g.logs || '').trim() || '（空）');
  });
  L.push(hr);

  return L.join('\n');
}

module.exports = { sanitize, maskName, buildDiagnostics };