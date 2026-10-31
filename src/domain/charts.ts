import type { Experiment, Measurements } from "./types.ts";
import {validChartWidth} from './chart-width.ts';
export interface ChartSpec {
  x: string;
  y: string;
  kind: "scatter" | "line" | "fit" | "bar";
  title: string;
  xlabel: string;
  ylabel: string;
  caption: string;
  section: string;
  embed: boolean;
  widthCm?: number;
}
export const chartKinds = {
  scatter: "散点图",
  line: "折线图",
  fit: "线性拟合",
  bar: "柱状图",
} as const;
export function chartFields(exp: Experiment, data?: Measurements) {
  return exp.schema.groups.flatMap((g) =>
    g.fields.flatMap((f) => {
      const unit = f.unit ? " / " + f.unit : "";
      if (f.type === "array") return [{ key: f.key, label: f.label + unit }];
      if (f.type !== "matrix") return [];
      const raw = data?.[f.key],
        matrix =
          Array.isArray(raw) && raw.every(Array.isArray)
            ? (raw as (number | null)[][])
            : null;
      const cols = matrix?.[0]?.length ?? f.cols ?? 0,
        rows = matrix?.length ?? f.rows ?? 0;
      const driver=f.colsFrom?exp.schema.groups.flatMap(g=>g.fields).find(x=>x.key===f.colsFrom):undefined;
      const positions=f.colsFrom?data?.[f.colsFrom]:undefined;
      const columnLabel=(i:number)=>{if(!f.colsFrom)return f.colLabels?.[i]??`第 ${i+1} 列`;const v=Array.isArray(positions)?positions[i]:null;return typeof v==='number'?`${driver?.label??f.colsFrom}=${Number(v.toPrecision(5))}${driver?.unit?' '+driver.unit:''}`:`第 ${i+1} 列（位置待填）`;};
      return [
        ...Array.from({ length: cols }, (_, i) => ({
          key: `${f.key}[${i}]`,
          label: `${f.label} · ${columnLabel(i)}${unit}`,
        })),
        ...Array.from({ length: rows }, (_, i) => ({
          key: `${f.key}[row:${i}]`,
          label: `${f.label} · ${f.rowLabels?.[i] ?? "第 " + (i + 1) + " 行"}${unit}`,
        })),
      ];
    }),
  );
}
export function validChartSpec(raw: unknown): raw is ChartSpec {
  const c = raw as ChartSpec;
  return (
    !!c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    ["x", "y", "title", "xlabel", "ylabel", "caption", "section"].every(
      (k) =>
        typeof c[k as keyof ChartSpec] === "string" &&
        (c[k as keyof ChartSpec] as string).length <= 200,
    ) &&
    !!c.x &&
    !!c.y &&
    !!c.section &&
    Object.hasOwn(chartKinds, c.kind) &&
    typeof c.embed === "boolean" && validChartWidth(c.widthCm)
  );
}
export function chartValues(
  data: Measurements,
  key: string,
): (number | null)[] {
  const m = /^(.+)\[(row:)?(\d+)\]$/.exec(key);
  const raw = data[m?.[1] ?? key];
  if (!Array.isArray(raw)) throw Error("所选字段不是数据列");
  if (m) {
    const index = Number(m[3]);
    if (m[2]) {
      const row = raw[index];
      if (!Array.isArray(row)) throw Error("表格行不存在");
      return row;
    }
    return raw.map((row) => {
      if (!Array.isArray(row) || index >= row.length)
        throw Error("表格列长度不正确");
      return row[index];
    });
  }
  if (raw.some(Array.isArray)) throw Error("请选择表格中的具体一列");
  return raw as (number | null)[];
}
export function validateChart(
  exp: Experiment,
  data: Measurements,
  spec: ChartSpec,
) {
  if (!validChartSpec(spec)) throw Error("绘图配置格式无效");
  const keys = new Set(chartFields(exp, data).map((f) => f.key));
  if (!keys.has(spec.x) || !keys.has(spec.y))
    throw Error("绘图字段不属于当前实验");
  const x = chartValues(data, spec.x),
    y = chartValues(data, spec.y);
  if (x.length !== y.length) throw Error("X 和 Y 字段长度不匹配");
  const pairs = x.flatMap((v, i) => {
    if (v === null && y[i] === null) return [];
    if (
      typeof v !== "number" ||
      typeof y[i] !== "number" ||
      !Number.isFinite(v) ||
      !Number.isFinite(y[i])
    )
      throw Error(`第 ${i + 1} 行的 X/Y 数据缺失或不是有限数值`);
    return [[v, y[i]]];
  });
  if (pairs.length < 2) throw Error("至少需要两组完整的 X/Y 数据");
  if (spec.kind === "fit" && new Set(pairs.map((p) => p[0])).size < 2)
    throw Error("线性拟合需要至少两个不同的 X 值");
  return pairs;
}
