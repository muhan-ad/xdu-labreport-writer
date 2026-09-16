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
  // 版本号/构建号保护：先提取占位，防 LONG_DIGITS_RE 把长构建号误伤成 ****
  // （示例：Word 构建 16.0.1772600000 的连续数字段会被当成学号打码）
  const versionTokens = [];
  out = out.replace(/((?:Build|文件版本|版本|apiVersion)\s*)(\d+(?:\.\d+){1,3})/gi, (m, prefix, ver) => {
    versionTokens.push(ver);
    return prefix + '\u0000VER' + (versionTokens.length - 1) + '\u0000';
  });
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
  // 用户目录（C:\Users\<名>）整体掩码：通用路径规则只匹配两段，会把用户名留在 <路径><名> 里
  out = out.replace(/([A-Za-z]:[\\/])Users[\\/][^\\/:*?"<>|\s,;]+/gi, (m, drive) => drive + '{USER}');
  out = out.replace(USERPATH_RE, m => {
    const parts = m.split(/[\\/]/);
    const name = parts[parts.length - 1] || m;
    return '<路径>' + name;
  });
  // 还原版本号占位（占位符含 \u0000，不会被上述任一规则改写）
  out = out.replace(/\u0000VER(\d+)\u0000/g, (m, i) => versionTokens[Number(i)] || '?');
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

  L.push('【Word 环境检测】');
  const w = (p.wordEnv && typeof p.wordEnv === 'object') ? p.wordEnv : {};
  L.push(`Word 已安装：${w.installed === undefined ? '（未获取）' : (w.installed ? '是' : '否')}`);
  L.push(`ProgramId：${w.curVer || '（未读取到）'} | COM CLSID 注册：${w.clsidPresent === undefined ? '（未获取）' : (w.clsidPresent ? '是' : '否')}`);
  L.push(`WPS 已安装：${w.wpsInstalled === undefined ? '（未获取）' : (w.wpsInstalled ? '是（注意：WPS 不支持 OMath 公式）' : '否')}`);
  L.push(`WINWORD.EXE：${w.exePath || '（未找到）'}${w.version ? `（文件版本 ${w.version}${w.bitness ? '，' + w.bitness : ''}）` : ''}`);
  L.push(`正在运行的 Word 进程数：${w.runningCount === undefined ? '（未获取）' : w.runningCount}`);
  L.push(`本应用实例数：${w.appProcessCount === undefined ? '（未获取）' : w.appProcessCount}`);
  const com = (w.com && typeof w.com === 'object') ? w.com : {};
  L.push(`COM 可启动（生成同路径冒烟）：${com.ok === undefined ? '（未获取）' : (com.ok ? `是（${com.version || '?'}${com.caption ? '，' + com.caption : ''}）` : `否（${com.error || '未知错误'}）`)}`);
  if (w.com && w.com.ok && w.com.version) L.push(`    → 版本 ${w.com.version} 支持 OMath 数学公式：${/^1[4-9]\.|^2\d\./.test(String(w.com.version)) ? '是（建议 Word 2016+，版本号 ≥ 16）' : '需确认（Word 2010+ 才支持公式）'}`);
  L.push(hr);

  L.push('【系统与运行时】');
  const s = (p.systemEnv && typeof p.systemEnv === 'object') ? p.systemEnv : {};
  L.push(`系统代码页(ACP)：${s.acp !== undefined ? s.acp : '（未获取）'}（936=GBK 中文；65001=UTF-8） | 区域 LCID：${s.lcid !== undefined ? s.lcid : '（未获取）'}`);
  L.push(`Python 首选编码：${s.preferredEncoding !== undefined ? s.preferredEncoding : '（未获取）'}（影响生成管道乱码判定）`);
  L.push(`生成用 Python：${s.pythonVersion || '（未获取）'} @ ${s.pythonExe || '（未获取）'}`);
  L.push(`最近生成登记的 Word 实例数：${Array.isArray(s.recentWordInstances) && s.recentWordInstances.length ? s.recentWordInstances.join('；') : '（无记录）'}`);
  L.push(hr);

  L.push('【数据与生成现场】');
  const d = (p.dataScene && typeof p.dataScene === 'object') ? p.dataScene : {};
  L.push(`实验清单：共 ${d.count === undefined ? '（未获取）' : d.count} 个实验`);
  L.push(`缺 data.json 的实验（模板缺失）：${Array.isArray(d.missingData) && d.missingData.length ? d.missingData.join('、') : '（无）'}`);
  L.push(`启用章节禁用的实验：${Array.isArray(d.sectionDisabled) && d.sectionDisabled.length ? d.sectionDisabled.join('；') : '（无）'}`);
  L.push(`当前实验未填必填字段：${p.pendingRequired === undefined || p.pendingRequired === null ? '（未获取）' : p.pendingRequired}（-1=未选择实验）`);
  L.push(hr);

  L.push('【更新与网络】');
  const n = (p.netEnv && typeof p.netEnv === 'object') ? p.netEnv : {};
  L.push(`代理环境变量（仅存在性）：${Array.isArray(n.proxySet) && n.proxySet.length ? n.proxySet.join('、') : '（未设置）'}`);
  const dm = (n.dataManifest && typeof n.dataManifest === 'object') ? n.dataManifest : {};
  L.push(`数据清单 data-manifest 可达性：${dm.status !== undefined ? `已连接（HTTP ${dm.status}）` : (dm.error || '（未探测）')}`);
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
    if (g.job) {
      const j = g.job;
      const variants = (j.variants && typeof j.variants === 'object') ? Object.keys(j.variants) : [];
      L.push(`    变体选择：${variants.length ? variants.map(k => `${k}#${j.variants[k]}`).join('、') : '（默认）'} | 润色覆盖章节：${(j.polishSections || []).length ? j.polishSections.join('、') : '（无）'} | 禁用章节：${(j.disabledSections || []).length ? j.disabledSections.join('、') : '（无）'}`);
    }
    if (g.report || g.sectionsCache !== undefined) {
      const r = g.report;
      L.push(`    报告现场：${r ? `${r.name}（${r.size} 字节，${r.mtime}）` : '（无新报告）'} | 章节缓存：${g.sectionsCache ? '存在' : '缺失'}`);
    }
    L.push(String(g.logs || '').trim() || '（空）');
  });
  L.push(hr);

  return L.join('\n');
}

module.exports = { sanitize, maskName, buildDiagnostics };