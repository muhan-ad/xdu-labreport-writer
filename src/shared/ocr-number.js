/* 识别结果/手工输入的数值解析（渲染层与 Node 单测共用，逻辑单一来源）。
 *
 * 必须整串都是数字（含科学计数法）才接受：旧实现用 parseFloat 取前缀，
 * "1.2abc"、"3.5V" 会被静默当成 1.2、3.5 收下（审查报告 R13）。
 * 支持中文/全角常见写法：2.7×10^-9、1.5e-3、前后空白、Unicode 负号。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ocrNumber = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function coerceNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.trim();
    if (!s) return null;
    s = s.replace(/[×*xX]\s*10\s*\^?\s*([+\-−]?\d+)/g, 'e$1')   // 2.7×10^-9 → 2.7e-9
         .replace(/[−–—]/g, '-')
         .replace(/\s+/g, '');
    if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  return { coerceNum: coerceNum };
});
