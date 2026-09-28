(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.dataValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function validate(schema, data, required = true) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ['数据应为对象'];
    for (const group of schema.groups || []) for (const field of group.fields || []) {
      const value = data[field.key], label = field.label || field.key;
      if (value == null) { if (required && field.required) errors.push(label + '：未填写'); continue; }
      let values = [value];
      if (field.type === 'array') {
        if (!Array.isArray(value) || (field.length != null && value.length !== field.length)) { errors.push(label + '：数组长度错误'); continue; }
        values = value;
      } else if (field.type === 'matrix') {
        // 固定矩阵必须完整；只有显式 variableRows 的表格允许未使用的整行。
        if (!Array.isArray(value) || value.some(r => !Array.isArray(r) || (field.cols != null && r.length !== field.cols))) { errors.push(label + '：矩阵维度错误'); continue; }
        if (field.rows != null && value.length > field.rows) { errors.push(label + '：行数不应超过 ' + field.rows); continue; }
        if (required && field.required && !field.variableRows && field.rows != null && value.length !== field.rows) {
          errors.push(label + '：应完整填写 ' + field.rows + ' 行'); continue;
        }
        if (required && field.required && !field.variableRows) {
          value.forEach((row, i) => {
            if (row.some(v => v == null)) errors.push(label + '：' + (field.rowLabels?.[i] || `第 ${i + 1} 行`) + '未填写完整');
          });
        }
        const filled = value.filter(r => r.some(c => c != null));
        if (required && field.required && !filled.length) { errors.push(label + '：未填写'); continue; }
        if (required && field.required && field.minFilledRows != null && filled.length < field.minFilledRows) {
          errors.push(label + '：至少填写 ' + field.minFilledRows + ' 行');
        }
        values = filled.flat();
      }
      for (const v of values) {
        if (v == null) { if (required && field.required) errors.push(label + '：未填写'); continue; }
        if (['number', 'science', 'array', 'matrix'].includes(field.type)) {
          if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(label + '：必须是有限数值'); continue; }
          if (field.minimum != null && v < field.minimum) errors.push(label + '：不能小于 ' + field.minimum);
          if (field.exclusiveMinimum != null && v <= field.exclusiveMinimum) errors.push(label + '：必须大于 ' + field.exclusiveMinimum);
          if (field.maximum != null && v > field.maximum) errors.push(label + '：不能大于 ' + field.maximum);
        } else if (typeof v !== 'string' || v.length > 4096) errors.push(label + '：文本无效或过长');
      }
    }
    return [...new Set(errors)];
  }
  return { validate };
});
