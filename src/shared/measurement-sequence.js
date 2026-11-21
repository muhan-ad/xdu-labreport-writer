(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.measurementSequence = api;
})(globalThis, function () {
  const settings = {
    '衍射光强分布的测量': { x: { start: 0, step: 1 } },
    '电子偏转特性的测量': {
      D_x: { step: 4, centered: true },
      D_y: { step: 4, centered: true },
      D_m: { step: 3, centered: true },
    },
    '电子元件伏安特性的测量': {
      t1_us: { start: 1, step: 1 },
      t2_us: { start: 1, step: 1 },
    },
    '霍尔效应实验': {
      t1_im_a: { start: 0.2, step: 0.1 },
      t2_i: { start: 2, step: 1 },
    },
    '直螺线管磁场分布的测量': {
      x_mm: { start: 0, preset: [0, 20, 40, 60, 80, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] },
    },
    '低电阻的测量': { L: { start: 100, step: 40 } },
    '电表的改装与校准': {
      i_x: { start: 0.1, step: 0.1 },
      u_x: { start: 0.1, step: 0.1 },
    },
    '平凸透镜曲率半径的测量': { rings: { start: 14, step: -1, rings: true } },
    '光的偏振特性测量': {
      cos2_values: {
        presetOnly: true,
        preset: Array.from({length: 7}, (_, i) =>
          Number((Math.cos(i * Math.PI / 12) ** 2).toFixed(12))),
      },
    },
  };

  function sequenceSetting(experiment, field) {
    if (!Object.hasOwn(settings, experiment)) return undefined;
    return Object.hasOwn(settings[experiment], field) ? settings[experiment][field] : undefined;
  }

  function decimalParts(text, label) {
    const normalized = text.trim().normalize('NFKC').replace(/−/g, '-');
    const parts = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(normalized);
    if (!parts || !(parts[2] || parts[3]) || normalized.length > 100 ||
        !Number.isFinite(Number(normalized)) || Math.abs(Number(parts[4] || 0)) > 324)
      throw Error(label + '须为有限数值');
    const digits = BigInt(parts[1] + parts[2] + (parts[3] || ''));
    if (digits !== 0n && Number(normalized) === 0) throw Error(label + '过小');
    const exponent = Number(parts[4] || 0) - (parts[3]?.length ?? 0);
    return {digits, exponent};
  }

  function sequenceValues(config, field, count, mode, first, increment) {
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw Error('当前测点数无效');
    let values;
    if (mode === 'preset') {
      if (config.preset?.length !== count) throw Error('教材测点数与当前表格不一致');
      values = config.preset.slice();
    } else {
      if (config.presetOnly) throw Error('请使用教材角度对应的理论值');
      const start = decimalParts(first, '起始值');
      const step = decimalParts(increment, '步长');
      if (step.digits === 0n) throw Error('步长不能为 0');
      const exponent = Math.min(start.exponent, step.exponent);
      const align = part => part.digits * 10n ** BigInt(part.exponent - exponent);
      const firstValue = align(start), delta = align(step);
      values = Array.from({length: count}, (_, i) =>
        Number(String(firstValue + BigInt(i) * delta) + 'e' + exponent));
      if (values.some((value, i) => !Number.isFinite(value) || (i > 0 && value === values[i - 1])))
        throw Error('起始值或步长超出可表示范围');
    }
    if (config.rings && (values.some(v => !Number.isSafeInteger(v) || v <= 0) || Math.abs(values[1] - values[0]) !== 1))
      throw Error('暗环序号须为正整数，步长应为 1 或 −1');
    if (values.some(v => (field.minimum != null && v < field.minimum) ||
        (field.exclusiveMinimum != null && v <= field.exclusiveMinimum) ||
        (field.maximum != null && v > field.maximum)))
      throw Error('生成的测点超出该字段允许范围');
    return values;
  }

  function sequenceControls(config, count, buttonClass) {
    const button = (mode, title) =>
      '<button type="button" class="' + buttonClass + '" data-action="measurement-sequence" data-sequence-mode="' + mode + '">' + title + '</button>';
    const input = (label, attribute, value) =>
      '<label>' + label + '<input type="number" step="any" ' + attribute + ' value="' + (value ?? '') + '"></label>';
    const start = config.centered ? -(count - 1) * config.step / 2 : config.start;
    const progression = config.presetOnly ? '' :
      input('起始值', 'data-sequence-start', start) +
      input('步长', 'data-sequence-step', config.step) + button('generate', '生成测点');
    const preset = config.preset?.length === count
      ? button('preset', config.presetOnly ? '填入理论值' : '填入教材测点') : '';
    return '<div class="measurement-sequence">' + progression + preset + '</div>';
  }
  return {sequenceSetting, sequenceValues, sequenceControls};
});
