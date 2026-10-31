import type { Draft, Field, Measurements, Schema } from "./types.ts";
import {
  convert,
  fields,
  makeDraft,
  parseNumber,
  validateDraft,
} from "./model.ts";
export interface OCRReview {
  values: Measurements;
  warnings: Record<string, string>;
  errors: string[];
}
export function parseAIJson(text: string): Record<string, unknown> {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(clean);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw Error("模型返回格式不正确，请重试");
  return parsed as Record<string, unknown>;
}
function number(raw: unknown): number | null {
  if (raw === null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw Error("不是有限数值");
    return raw;
  }
  if (typeof raw !== "string" || raw.length > 100) throw Error("数值格式错误");
  return parseNumber(
    raw
      .normalize("NFKC")
      .replace(/[−–]/g, "-")
      .replace(/\s*[×x*]\s*10\s*\^\s*([+-]?\d+)/i, "e$1"),
  );
}
function shape(f: Field, raw: unknown) {
  if (f.type === "number" || f.type === "science") return number(raw);
  if (!Array.isArray(raw)) throw Error("需要数组");
  if (f.type === "array") {
    if (f.allowedLengths && !f.allowedLengths.includes(raw.length))
      throw Error(`测量点数应为 ${f.allowedLengths.join(" 或 ")} 个`);
    if (
      f.variableLength
        ? raw.length < (f.minLength ?? 3) || raw.length > (f.maxLength ?? 100)
        : raw.length !== f.length
    )
      throw Error("数组长度不匹配");
    return raw.map(number);
  }
  if (
    (f.variableRows && !f.colsFrom
      ? raw.length < 1 || raw.length > (f.rows ?? 0)
      : raw.length !== f.rows) ||
    raw.some(
      (row) =>
        !Array.isArray(row) ||
        (!f.colsFrom && row.length !== f.cols) ||
        row.length > 1000,
    )
  )
    throw Error("表格行列数不匹配");
  const matrix = (raw as unknown[][]).map((row) => row.map(number));
  // Optional measurement rows are capacity, not additional observations.
  // Keep the editor's fixed container and preserve unobserved cells as blanks.
  if (f.variableRows && !f.colsFrom)
    while (matrix.length < (f.rows ?? 0))
      matrix.push(Array(f.cols ?? 0).fill(null));
  return matrix;
}
export function reviewOCR(schema: Schema, text: string): OCRReview {
  const payload = parseAIJson(text),
    raw = payload.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("识别结果缺少 data 测量字段");
  const values: Measurements = {},
    errors: string[] = [],
    warnings: Record<string, string> = {};
  const known = fields(schema);
  for (const [key, value] of Object.entries(raw)) {
    const f = known.find((f) => f.key === key);
    if (!f) {
      errors.push(`忽略未知字段 ${key.slice(0, 60)}`);
      continue;
    }
    try {
      values[key] = shape(f, value);
    } catch (e) {
      errors.push(`${f.label}：${(e as Error).message}`);
    }
  }
  if (
    payload.warnings &&
    typeof payload.warnings === "object" &&
    !Array.isArray(payload.warnings)
  )
    for (const f of known) {
      const value = (payload.warnings as Record<string, unknown>)[f.key];
      if (typeof value === "string") warnings[f.key] = value.slice(0, 500);
    }
  if (!Object.keys(values).length)
    throw Error("未识别出可用测量数据，请检查照片清晰度或更换模型");
  return { values, warnings, errors };
}
export function applyOCR(
  schema: Schema,
  draft: Draft,
  review: OCRReview,
  selected: string[],
  onlyEmpty: boolean,
): Draft {
  const current = convert(schema, draft);
  // Preserve incomplete numeric input rather than replacing it silently with null.
  if (current.issues.length)
    throw Error("请先修正现有输入中的数值格式，再录入识别结果");
  const merged = structuredClone(current.data);
  const hasValue = (x: unknown): boolean => Array.isArray(x) ? x.some(hasValue) : x != null;
  const merge = (old: unknown, value: unknown): unknown => {
    if (Array.isArray(value)) {
      const previous = Array.isArray(old) ? old : [];
      const result = value.map((v, i) => merge(previous[i], v));
      // An OCR response describes observed cells, not permission to delete old measurements.
      // Retain the complete tail when it contains any existing value (including zero).
      const tail = previous.slice(value.length);
      if (onlyEmpty || tail.some(hasValue)) result.push(...tail);
      return result;
    }
    return value === null || (onlyEmpty && old != null) ? (old ?? null) : value;
  };
  for (const key of selected) {
    if (!Object.hasOwn(review.values, key) || !Object.hasOwn(merged, key))
      continue;
    const old = merged[key],
      value = review.values[key];
    merged[key] = merge(old, value) as Measurements[string];
  }
  // Check coupled array lengths before makeDraft can normalize/truncate them.
  for (const f of fields(schema))
    if (f.colsFrom) {
      const matrix = merged[f.key],
        xs = merged[f.colsFrom];
      if (
        !Array.isArray(matrix) ||
        !Array.isArray(xs) ||
        matrix.some((row) => !Array.isArray(row) || row.length !== xs.length)
      )
        throw Error("测量点与各组表格长度不同，请同时选择对应测量点及各组数据");
    }
  const next = makeDraft(schema, merged);
  if (!validateDraft(schema, next))
    throw Error("识别数据形状不符合实验要求，请重新核对");
  return next;
}
export function ocrRetainsTail(schema: Schema, draft: Draft, review: OCRReview, selected: string[]): boolean {
  const current = convert(schema, draft).data;
  const hasValue = (x: unknown): boolean => Array.isArray(x) ? x.some(hasValue) : x != null;
  const retains = (old: unknown, next: unknown): boolean => {
    if (!Array.isArray(old) || !Array.isArray(next)) return false;
    return old.slice(next.length).some(hasValue) || next.some((v, i) => retains(old[i], v));
  };
  return selected.some(key => Object.hasOwn(review.values, key) && retains(current[key], review.values[key]));
}
export function correctedOCR(schema:Schema,review:OCRReview,edits:Record<string,unknown>,selected:string[]):OCRReview {
  const values=structuredClone(review.values);
  for(const key of selected){const field=fields(schema).find(f=>f.key===key);if(!field||!Object.hasOwn(values,key))continue;try{values[key]=shape(field,edits[key]);}catch(error){throw Error(field.label+'：'+(error as Error).message);}}
  return {...review,values};
}
export function ocrPrompt(name: string, schema: Schema,includeStudent=false) {
  return `识别照片中的“${name}”测量记录。只输出 JSON {"data":{字段key:数值或数组},"warnings":{字段key:"需核对的原因"}}。\n字段定义：${JSON.stringify(fields(schema))}\n严格按字段单位填写，科学计数字段填最终数值。定长数组保留指定长度；variableLength 数组按照片实际测点数输出，遵守 minLength/maxLength 和 allowedLengths，不为凑长度补造测点。variableRows 表格按实际测量行输出，rows 仅为容量上限，不补造未测行；缺失字段或看不清的单元格填 null。colsFrom 表格各行长度须与对应测点数组一致。不能猜测、用理论值补齐或自行平均。表格按 schema 存储行列，不按 UI 转置。dm1 是左侧纵坐标，dm2 是右侧纵坐标。${includeStudent?'同时输出 student:{"name":字符串或null,"id":字符串或null,"class":字符串或null}。学生信息只能抄录可见文字，不可猜测；学号必须用字符串保留前导零。':'不要输出姓名、学号或班级。'}`;
}
