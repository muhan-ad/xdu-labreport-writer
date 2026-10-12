(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.reportIntegrity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const EXPERIMENT = '电容与高电阻的测量';
  const scalarKeys = ['c_x_bar', 'r_mohm', 'r_fit_mohm', 'delta_e', 'fit_delta_e', 'k_abs', 'k_slope', 'fit_slope', 'fit_intercept', 'r_squared', 'r_0', 'c_n', 't_first', 't_last', 'q_first', 'q_last', 'lnq_first', 'lnq_last'];
  function applies(exp) { return !!exp; }
  function validateText(text, data) {
    text = String(text || '');
    if (data && data._kind === 'generic') {
      const rest = text.replace(/^\s*\d+[.、．]\s+[^\n]*[？?]\s*$/gm, '').replace(/%%DATA:([^:]+):(.+?)%%/g, (_, key, fmt) => {
        if (!(key in data) || key.startsWith('_') || !/^%(?:\.(?:[0-9]|1[0-2]))?[fgesd]$/.test(fmt)) throw Error('实验数值占位符无效：' + key);
        return '';
      }).replace(/\\(?:mathrm|text)\{([^{}]*)\}/g, '$1').replace(/\\[ ,]/g, ' ').replace(/273\.15/g, '').replace(/10\s*\^\s*\{?-?[0-9]+\}?/g, '');
      if (/\d+\.\d+|\d+\s*(?:MΩ|兆欧|μF|微法|μC|微库|mm|nm|cm|m\/s|kHz|mA|Ω|欧姆|℃|秒|s\b(?!\})|伏|V\b|A\b|%|％)|(?:测得|结果为|电阻为|电容为|声速为|焦距为)\s*[=:：]?\s*-?\d+/.test(rest)) {
        throw Error('文本含未绑定的实验数值，请重新润色；测量结果必须使用当前计算量占位符。');
      }
      return text;
    }
    let rest = text.replace(/%%DATA:([^:]+):(.+?)%%/g, (_, key, fmt) => {
      if (!Number.isFinite(data[key]) || !/^%(?:\.(?:[0-9]|1[0-2]))?[fge]$/.test(fmt)) throw Error('实验数值占位符无效：' + key);
      return '';
    });
    rest = rest.replace(/\\(?:mathrm|text)\{([^{}]*)\}/g, '$1').replace(/\\[ ,]/g, ' ');
    const assignment = /(?:R|C|K|Q|t)(?:_\{?[A-Za-z0-9]+\}?)?\s*=\s*-?\d+(?:\.\d+)?(?![\d./])(?=\s*(?:$|[，。；,;]|[A-Za-zμ]))/.test(rest);
    let symbolic = rest.replace(/10\s*\^\s*\{?-6\}?/g, '')
      .replace(/(?:\\times|×)\s*100\\?%/g, '')
      .replace(/[A-Za-z]_\{?\d+\}?|[QtR]\^\{?2\}?|\\sqrt\{3\}/g, '')
      .replace(/(?<!\d)1(?=\s*\/\s*\()|(?<=\\frac\{)1(?=\})/g, '')
      .replace(/^\s*\d+\.\s+/gm, '');
    if (/\d/.test(symbolic) || assignment || /%%DATA:|(?<![\w.])\d+\.\d+|\d+(?:\.\d+)?\s*(?:%|％|MΩ|兆欧|μF|微法|μC|微库|秒|s\b(?!\})|伏|V\b)/.test(rest)) {
      throw Error('本实验文本含固定实验数值，请重新生成答案/润色；实验结果须使用当前数据占位符。');
    }
    return text;
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
  return { applies, validateText, parameterizeText, prompt, sameData, selectOverrides };
});
