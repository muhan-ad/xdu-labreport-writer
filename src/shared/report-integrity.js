(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.reportIntegrity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const EXPERIMENT = '电容与高电阻的测量';
  const scalarKeys = ['c_x_bar', 'r_mohm', 'r_fit_mohm', 'delta_e', 'fit_delta_e', 'k_abs', 'k_slope', 'fit_slope', 'fit_intercept', 'r_squared', 'r_0', 'c_n', 't_first', 't_last', 'q_first', 'q_last', 'lnq_first', 'lnq_last'];
  function applies(exp) { return !!exp; }
  function validationError(code, message, token) {
    const error = Error(message); error.validationCode = code;
    error.numericToken = token || ''; return error;
  }
  function inspectText(text, data) {
    text = String(text || ''); data = data || {};
    const rest = text.replace(/%%DATA:([^:]+):(.+?)%%/g, (_, key, fmt) => {
      const value = data[key];
      const validValue = data._kind === 'generic'
        ? (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
        : typeof value === 'number' && Number.isFinite(value);
      if (key.startsWith('_') || !(key in data) || !validValue || !/^%(?:\.(?:[0-9]|1[0-2]))?[fgesd]$/.test(fmt)
          || (/[fged]$/.test(fmt) && !(typeof value === 'number' && Number.isFinite(value))))
        throw validationError('INVALID_PLACEHOLDER', '实验数值占位符无效：' + key);
      return '';
    });
    if (/%%DATA:/.test(rest)) throw validationError('INVALID_PLACEHOLDER', '实验数值占位符格式不完整');
    const normalized = rest.replace(/\\(?:mathrm|text)\{([^{}]*)\}/g, '$1').replace(/\\[ ,]/g, ' ');
    // Only explicit, identified quantities can prove a contradiction. Unidentified
    // numbers and physical formula constants are advisory, never hard failures.
    const rules = [
      ['r_mohm', /(?:\bR\b\s*=|测得(?:的)?(?:高电阻|电阻)(?:为|是|值为)?\s*[=:：]?)\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(MΩ|兆欧|kΩ|Ω)/g, {MΩ:1,'兆欧':1,'kΩ':.001,'Ω':.000001}],
      ['r_0', /(?:\bR_\{?0\}?\s*=|(?:电阻)?标称值(?:为|是)?\s*[=:：]?)\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(MΩ|兆欧|kΩ|Ω)?/g, {MΩ:1,'兆欧':1,'kΩ':.001,'Ω':.000001}],
      ['c_x_bar', /(?:\bC_\{?x\}?\s*=|测得(?:的)?电容(?:为|是|值为)?\s*[=:：]?)\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(μF|微法|nF|F)/g, {'μF':1,'微法':1,nF:.001,F:1000000}],
    ];
    for (const [key, value] of Object.entries(data)) {
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && key.length > 2 && key !== 'r_0' && Number.isFinite(value))
        rules.push([key, new RegExp('\\b' + key + '\\s*=\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)', 'g'), {}]);
    }
    for (const [key, pattern, units] of rules) {
      if (!Number.isFinite(data[key])) continue;
      for (const match of normalized.matchAll(pattern)) {
        const clause = normalized.slice(0, match.index).split(/[。；;\n]/).pop();
        if (/(?:例如|示例|假设|假定|参考)/.test(clause)) continue;
        const factor = units[match[2]] || 1, value = Number(match[1]) * factor;
        const parts = match[1].toLowerCase().split('e'), decimals = (parts[0].split('.')[1] || '').length;
        const tolerance = .5 * 10 ** (Number(parts[1] || 0) - decimals) * factor + 1e-10 * Math.max(1, Math.abs(data[key]));
        if (Math.abs(value - data[key]) > tolerance)
          throw validationError('CONTRADICTING_VALUE', '文本中的 ' + key + ' 与当前计算结果不一致，请核对或使用数据占位符。', match[1]);
      }
    }
    const warnings = [];
    // Ignore all math expressions, indices, section numbers and defined constants
    // when looking for uncertain prose quantities. No formula allow-list needed.
    const prose = normalized.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '')
      .replace(/^\s*(?:[（(]?\d+[）).、．])\s*/gm, '').replace(/273\.15/g, '');
    if (/-?\d+(?:\.\d+)?\s*(?:MΩ|兆欧|kΩ|μF|微法|nF|μC|微库|mV|μV|mm|nm|cm|m\/s|kHz|mA|Ω|欧姆|℃|秒|s\b|伏|V\b|A\b|%|％)|(?:测得|结果为|标称值|精度|分辨力|误差限)[^，。；\n]{0,16}\d/.test(prose))
      warnings.push({code:'UNVERIFIED_QUANTITY', message:'文本含未绑定数据占位符的数值，请核对其来源、单位和精度；此提醒不阻止生成。'});
    return {text, warnings};
  }
  function validateText(text, data, onWarning) {
    const result = inspectText(text, data);
    if (result.warnings.length && onWarning) onWarning(result.warnings);
    return result.text;
  }
  function parameterizeText(text, data) {
    const entries = [];
    for (const key of (data && data._kind === 'generic' ? Object.keys(data).filter(k => !k.startsWith('_')) : scalarKeys)) {
      const value = data[key];
      if (!Number.isFinite(value)) continue;
      const candidates = [String(value), value.toPrecision(7).replace(/0+$/, '').replace(/\.$/, '')];
      for (let n of [2, 3, 4, 6, 7, 8]) candidates.push(value.toFixed(n));
      for (const token of candidates) if (/\d/.test(token)) entries.push({ key, token });
    }
    // Only actual decimal/quantity tokens are rebound, never integer constants in symbolic formulae.
    return String(text || '').replace(/%%DATA:[^:]+:.+?%%|(?<![\d.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token, offset, source) => {
      if (token.startsWith('%%DATA:')) return token;
      const after = source.slice(offset + token.length);
      if (!token.includes('.') && !/^(?:\s*)(?:MΩ|兆欧|μF|微法|μC|微库|mm|nm|kHz|mA|℃|秒|s\b(?!\})|伏|V\b)/.test(after)) return token;
      const match = entries.find(e => e.token === token);
      return match ? '%%DATA:' + match.key + ':%.7g%%' : token;
    });
  }
  function prompt(context) {
    return '\n\n【本次用户数据与计算结果】\n' + JSON.stringify(context) +
      '\n以上是唯一实验数值来源；知识库只提供原理，不能补齐输入。具体实验量不得写成固定数字，须使用 %%DATA:键名:%.7g%% 占位符（键只能取上述标量字段）；展示精度按该量的测量精度确定。符号公式可保留物理常数。不得引用示例、旧报告数值或虚构仪器误差限。';
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  function sameData(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
  function selectOverrides(overrides, data) {
    if (!overrides || !Object.keys(overrides).some(key => key !== '__sourceData')) return { status: 'none', polish: {} };
    if (!overrides.__sourceData) return { status: 'missing-source', polish: {} };
    if (!sameData(overrides.__sourceData, data)) return { status: 'stale', polish: {} };
    return { status: 'valid', polish: overrides };
  }
  return { applies, inspectText, validateText, parameterizeText, prompt, sameData, selectOverrides };
});
