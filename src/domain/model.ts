import type {
  Schema,
  Field,
  Draft,
  Science,
  Measurements,
  Issue,
  RecordData,
  Experiment,
  Profile,
} from "./types.ts";
import { validation } from "./validation.js";
import {isSoundExperiment,validSoundPhase} from './sound-phase.ts';
export const fields = (schema: Schema) =>
  schema.groups.flatMap((g) => g.fields);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseNumber(raw: string): number | null {
  const text = raw.normalize("NFKC").trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    throw Error("请输入有效数值");
  const n = Number(text);
  if (!Number.isFinite(n)) throw Error("数值超出可表示范围");
  if (n === 0 && /[1-9]/.test(text.split(/e/i)[0]))
    throw Error("数值过小，转换后会变成零");
  return n;
}
// Decimal unit shifts avoid introducing binary tails such as 0.014 * 100.
function legacyValue(value: number, scale: number): number {
  const power = Math.log10(scale);
  if (scale > 0 && Number.isInteger(power)) {
    const [mantissa, exponent = "0"] = String(value).split(/e/i);
    return Number(`${mantissa}e${Number(exponent) + power}`);
  }
  return value * scale;
}
export function makeDraft(
  schema: Schema,
  raw: unknown = validation.blank(schema),
): Draft {
  const source = plain(raw) ? { ...raw } : {};
  for (const f of fields(schema))
    if (
      source[f.key] == null &&
      f.legacyKey &&
      typeof source[f.legacyKey] === "number"
    )
      source[f.key] = legacyValue(source[f.legacyKey] as number, f.legacyScale ?? 1);
  const data = validation.forEditing(schema, source),
    draft: Draft = {};
  const text = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  for (const f of fields(schema)) {
    const v = data[f.key];
    if (f.type === "array") draft[f.key] = (v as unknown[]).map(text);
    else if (f.type === "matrix")
      draft[f.key] = (v as unknown[][]).map((row) => row.map(text));
    else if (f.type === "science") {
      const n = typeof v === "number" ? v : null;
      if (n === null) draft[f.key] = { mantissa: "", exponent: "" };
      else {
        const [m, e] = n.toExponential().split("e");
        draft[f.key] = { mantissa: m, exponent: String(Number(e)) };
      }
    } else draft[f.key] = text(v);
  }
  return draft;
}
export function convert(
  schema: Schema,
  draft: Draft,
): { data: Measurements; issues: Issue[] } {
  const data: Measurements = {},
    issues: Issue[] = [];
  for (const f of fields(schema)) {
    const read = (v: string) => {
      try {
        return parseNumber(v);
      } catch (e) {
        issues.push({
          key: f.key,
          message: `${f.label}：${(e as Error).message}`,
        });
        return null;
      }
    };
    const value = draft[f.key];
    if (f.type === "array") data[f.key] = (value as string[]).map(read);
    else if (f.type === "matrix")
      data[f.key] = (value as string[][]).map((row) => row.map(read));
    else if (f.type === "science") {
      const v = value as Science;
      if (!v.mantissa.trim() && !v.exponent.trim()) data[f.key] = null;
      else if (!v.mantissa.trim() || !v.exponent.trim()) {
        data[f.key] = null;
        issues.push({ key: f.key, message: `${f.label}：请填写尾数和指数` });
      } else if (
        !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v.mantissa.trim()) ||
        !/^[-+]?\d+$/.test(v.exponent.trim())
      ) {
        data[f.key] = null;
        issues.push({
          key: f.key,
          message: `${f.label}：尾数须为小数，指数须为整数`,
        });
      } else data[f.key] = read(`${v.mantissa.trim()}e${v.exponent.trim()}`);
    } else data[f.key] = read(value as string);
  }
  return { data, issues };
}
export function inspect(
  schema: Schema,
  draft: Draft,
  required = true,
): Issue[] {
  const result = convert(schema, draft);
  const issues = [...result.issues];
  for (const f of fields(schema)) {
    const sub = { groups: [{ name: "", fields: [f] }] };
    for (const message of validation.validate(sub, result.data, required))
      if (!issues.some((x) => x.key === f.key && x.message === message))
        issues.push({ key: f.key, message });
  }
  return issues;
}
export function progress(schema: Schema, draft: Draft) {
  const all = fields(schema).filter((f) => f.required),
    bad = new Set(inspect(schema, draft).map((x) => x.key));
  return { done: all.filter((f) => !bad.has(f.key)).length, total: all.length };
}
export function recordProgress(exp:Experiment,record:RecordData){
  const p=progress(exp.schema,record.draft),sound=isSoundExperiment(exp);
  return {done:p.done+(sound&&validSoundPhase(record.soundPhase)?1:0),total:p.total+(sound?1:0)};
}
export function hasValues(draft: Draft): boolean {
  return Object.values(draft).some((v) =>
    typeof v === "string"
      ? !!v.trim()
      : Array.isArray(v)
        ? v.flat().some((x) => !!x.trim())
        : !!v.mantissa.trim() || !!v.exponent.trim(),
  );
}
export function validateDraft(schema: Schema, raw: unknown): raw is Draft {
  if (!plain(raw)) return false;
  const scalar = (v: unknown) => typeof v === "string" && v.length <= 100;
  if (Object.keys(raw).some((k) => !fields(schema).some((f) => f.key === k)))
    return false;
  for (const f of fields(schema)) {
    const v = raw[f.key];
    if (f.type === "number" && !scalar(v)) return false;
    if (
      f.type === "science" &&
      (!plain(v) || !scalar(v.mantissa) || !scalar(v.exponent))
    )
      return false;
    if (
      f.type === "array" &&
      (!Array.isArray(v) ||
        v.length > (f.maxLength ?? 1000) ||
        (f.allowedLengths && !f.allowedLengths.includes(v.length)) ||
        (f.variableLength && v.length < (f.minLength ?? 3)) ||
        (!f.variableLength && v.length !== f.length) ||
        v.some((x) => !scalar(x)))
    )
      return false;
    if (f.type === "matrix") {
      const cols = f.colsFrom ? (raw[f.colsFrom] as unknown[])?.length : f.cols;
      if (
        !Array.isArray(v) ||
        v.length !== f.rows ||
        v.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== cols ||
            row.some((x) => !scalar(x)),
        )
      )
        return false;
    }
  }
  return true;
}
export function recordBlank(exp: Experiment): RecordData {
  return {
    version: 1,
    experimentId: exp.id,
    date: today(),
    updatedAt: "",
    draft: makeDraft(exp.schema),
  };
}
export function validRecord(exp: Experiment, raw: unknown): raw is RecordData {
  return (
    plain(raw) &&
    raw.version === 1 &&
    raw.experimentId === exp.id &&
    (raw.soundPhase === undefined || (isSoundExperiment(exp) && validSoundPhase(raw.soundPhase))) &&
    typeof raw.date === "string" &&
    (raw.date === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(raw.date) &&
        !Number.isNaN(Date.parse(raw.date)) &&
        new Date(raw.date).toISOString().slice(0, 10) === raw.date)) &&
    typeof raw.updatedAt === "string" &&
    validateDraft(exp.schema, raw.draft)
  );
}
export function resizePoints(
  schema: Schema,
  draft: Draft,
  key: string,
  delta: 1 | -1,
): Draft {
  const f = fields(schema).find((x) => x.key === key);
  if (!f?.variableLength) throw Error("该组测点不可增减");
  const clone = structuredClone(draft),
    row = clone[key] as string[],
    length = f.allowedLengths ? (delta > 0 ? f.allowedLengths.find(n=>n>row.length) : [...f.allowedLengths].reverse().find(n=>n<row.length)) ?? row.length : row.length + delta;
  if (length < (f.minLength ?? 3) || length > (f.maxLength ?? 100))
    throw Error(`测量点数应为 ${f.minLength ?? 3}～${f.maxLength ?? 100}`);
  while (row.length < length) row.push("");
  while (row.length > length) row.pop();
  if (f.pairedMatrix) {
    const matrix = clone[f.pairedMatrix] as string[][];
    for (const r of matrix)
      if (delta === 1) r.push("");
      else r.pop();
  }
  return clone;
}
export function importMeasurements(exp: Experiment, raw: unknown): Draft {
  if (!plain(raw)) throw Error("文件中的测量数据应为对象");
  let data: Record<string, unknown> = raw;
  if (raw.format === "lab-maker-measurements") {
    if (raw.version !== 1 || raw.experiment !== exp.sourceId)
      throw Error("文件版本或实验名称不匹配，请打开对应实验后导入");
    if (raw.draft !== undefined) {
      if (!validateDraft(exp.schema, raw.draft))
        throw Error("草稿结构异常，数组或矩阵尺寸不匹配");
      return structuredClone(raw.draft);
    }
    if (!plain(raw.data)) throw Error("文件缺少测量数据");
    data = raw.data;
  }
  const selected: Record<string, unknown> = {};
  let found = false;
  for (const f of fields(exp.schema)) {
    if (Object.hasOwn(data, f.key)) {
      selected[f.key] = data[f.key];
      found = true;
    } else if (f.legacyKey && typeof data[f.legacyKey] === "number") {
      selected[f.key] = legacyValue(data[f.legacyKey] as number, f.legacyScale ?? 1);
      found = true;
    }
  }
  if (!found) throw Error("文件中没有该实验的测量字段");
  for (const f of fields(exp.schema))
    if (
      f.variableLength &&
      Array.isArray(selected[f.key]) &&
      (selected[f.key] as unknown[]).length < (f.minLength ?? 3)
    )
      throw Error(`${f.label}：测量点数不足`);
  const problems = validation.validate(exp.schema, selected, false);
  if (problems.length) throw Error(problems.slice(0, 3).join("；"));
  return makeDraft(exp.schema, selected);
}
export function exportMeasurements(
  exp: Experiment,
  record: RecordData,
  profile: Profile,
) {
  return {
    format: "lab-maker-measurements",
    version: 1,
    experiment: exp.sourceId,
    schemaHash: exp.schemaHash,
    exportedAt: new Date().toISOString(),
    date: record.date,
    student: profile,
    ...(isSoundExperiment(exp)&&record.soundPhase?{soundPhase:record.soundPhase}:{}),
    data: convert(exp.schema, record.draft).data,
    draft: record.draft,
  };
}
export function cleanProfile(raw: unknown): Profile {
  const p = plain(raw) ? raw : {};
  return {
    name: typeof p.name === "string" ? p.name.slice(0, 60) : "",
    studentId: typeof p.studentId === "string" ? p.studentId.slice(0, 40) : "",
    className: typeof p.className === "string" ? p.className.slice(0, 80) : "",
  };
}
