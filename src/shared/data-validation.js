(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.dataValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  // Opt-in only: fixed instrument rows remain fixed; paired measurement columns may vary.
  const bounded = (value, fallback=0, max=1000) => Number.isInteger(value)&&value>=0 ? Math.min(value,max) : fallback;
  function dimensions(field, data = {}) {
    const value = data[field.key];
    if (field.variableLength) {
      const paired = data[field.pairedMatrix];
      const lengths = [Array.isArray(value) ? value.length : 0,
        ...(Array.isArray(paired) ? paired.slice(0,1000).map(r => Array.isArray(r) ? r.length : 0) : [])];
      return { length: Math.min(Math.max(...lengths) || field.length || 0,bounded(field.maxLength,100)||100) };
    }
    if (field.colsFrom) {
      const paired = data[field.colsFrom];
      return { rows: field.rows || 0, cols: Math.min(Math.max(Array.isArray(paired) ? paired.length : 0,
        ...(Array.isArray(value) ? value.slice(0,1000).map(r => Array.isArray(r) ? r.length : 0) : [])) || field.cols || 0,100) };
    }
    return { length: field.length, rows: field.rows || 0, cols: field.cols || 0 };
  }
  function blank(schema) {
    const result={},fields=(schema.groups||[]).flatMap(g=>g.fields||[]);
    for(const f of fields)result[f.key]=f.type==='array'?Array(bounded(f.length,f.variableLength?bounded(f.minLength,3):0)).fill(null):null;
    for(const f of fields)if(f.type==='matrix')result[f.key]=Array.from({length:bounded(f.rows)},()=>Array(f.colsFrom?result[f.colsFrom]?.length||bounded(f.cols):bounded(f.cols)).fill(null));
    return result;
  }
  function forEditing(schema, raw) {
    const data=raw&&typeof raw==='object'&&!Array.isArray(raw)?{...raw}:{},fields=(schema.groups||[]).flatMap(g=>g.fields||[]);
    for(const f of fields)if(f.type==='array'){
      const input=Array.isArray(data[f.key])?data[f.key]:[],len=f.variableLength?dimensions(f,data).length:bounded(f.length,bounded(input.length));
      data[f.key]=Array.from({length:len},(_,i)=>input[i]??null);
    }
    for(const f of fields){
      if(f.type==='matrix'){const input=Array.isArray(data[f.key])?data[f.key]:[],cols=f.colsFrom?bounded(data[f.colsFrom]?.length,bounded(f.cols),100):bounded(f.cols);data[f.key]=Array.from({length:bounded(f.rows)},(_,r)=>Array.from({length:cols},(_,c)=>Array.isArray(input[r])?input[r][c]??null:null));}
      else if(f.type!=='array'&&data[f.key]!==null&&typeof data[f.key]==='object')data[f.key]=null;
    }
    return data;
  }
  function validate(schema, data, required = true) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ['数据应为对象'];
    for (const group of schema.groups || []) for (const field of group.fields || []) {
      const value = data[field.key], label = field.label || field.key;
      if (value == null) { if (required && field.required) errors.push(label + '：未填写'); continue; }
      let values = [value];
      if (field.type === 'array') {
        if (!Array.isArray(value) || (!field.variableLength && field.length != null && value.length !== field.length)) { errors.push(label + '：数组长度错误'); continue; }
        if (field.variableLength && (value.length > (field.maxLength || 100) || (required && value.length < (field.minLength || 3)))) {
          errors.push(label + `：测量点数应为 ${field.minLength || 3}～${field.maxLength || 100}`); continue;
        }
        values = value;
      } else if (field.type === 'matrix') {
        // 固定矩阵必须完整；只有显式 variableRows 的表格允许未使用的整行。
        const cols = field.colsFrom ? (Array.isArray(data[field.colsFrom]) ? data[field.colsFrom].length : -1) : field.cols;
        if (!Array.isArray(value) || value.some(r => !Array.isArray(r) || (cols != null && r.length !== cols))) { errors.push(label + (field.colsFrom ? '：每行测量值须与偏转位置逐点对应' : '：矩阵维度错误')); continue; }
        if (field.colsFrom && value.length !== field.rows) { errors.push(label + '：应保留 ' + field.rows + ' 组电压'); continue; }
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
        } else if (typeof v !== 'string' || v.length > 4096 || (required && field.required && !v.trim())) errors.push(label + '：文本无效或过长');
      }
    }
    return [...new Set(errors)];
  }
  return { validate, dimensions, blank, forEditing };
});
