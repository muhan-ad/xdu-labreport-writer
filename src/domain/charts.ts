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
// Storage orientation, independent of the table's displayTranspose setting.
const matrixAxes: Record<string, "row" | "column"> = {
  "0ae99b58d017/measurements": "row",
  "873fd94e5cd4/trials": "column",
  "0ce073f4e43e/readings": "column",
  "cae5a425bc29/angles": "column",
  "990c5b502ea7/power_mw": "column",
  "6f407f431b8a/measurements": "column",
  "cf4cb482e800/conjugate": "column",
  "123c8c28986d/concave": "column",
  "78c952679319/t1": "column",
  "78c952679319/t2": "column",
  "ffcd51d09df1/Udx": "row",
  "ffcd51d09df1/Udy": "row",
  "ffcd51d09df1/Im": "row",
  "5e3b2dde00e5/coax_radii": "row",
  "5e3b2dde00e5/parallel_x": "row",
  "5e3b2dde00e5/parallel_y": "row",
};

const shortLabels: Record<string, Record<string, string>> = {
  "12241939223f": {d_horiz:"横向 d",d_vert:"纵向 d"},
  "e5b47c932e39": {d_shi:"d",ni_zheng:"增重 nᵢ",ni_jian:"减重 nᵢ"},
  "873fd94e5cd4": {pivot:"支点位置",T_avg:"单周期平均 T",h:"h"},
  "80846705f12f": {cos2_values:"cos²θ",p_values:"P"},
  "4b8febea90c1": {x_k:"xₖ"},
  "afcba21152b7": {d_left:"D左",d_right:"D右"},
  "cf4cb482e800": {f_auto:"自准法 f",v:"v"},
  "123c8c28986d": {f_auto:"自准法 f",x6:"X₄",x7:"X₅"},
  "a9f6bd946367": {x:"x",I:"I"},
  "e3de15a9b5ea": {d:"d",L:"L",R_n_zheng:"正向电桥 Rₙ",R_n_fan:"反向电桥 Rₙ"},
  "2f235e76e2ec": {R:"R",U:"U"},
  "ffcd51d09df1": {D_x:"Dₓ",D_y:"Dᵧ",D_m:"Dₘ"},
  "a1628e04a9f5": {t1_us:"电阻 · Uₛ",t1_i:"电阻 · I",t1_u:"电阻 · U",t2_us:"灯泡 · Uₛ",t2_i:"灯泡 · I",t2_u:"灯泡 · U",t3_i:"二极管 · I",t3_u:"二极管 · U"},
  "a306231cddbd": {q_n:"Qₙ",q_x:"Qₓ",t_values:"t",q_values:"Q"},
  "8931aa0fd0b6": {rg:"Rᵍ",i_x:"改装表 Iₓ",i_s:"标准表 Iₛ",u_x:"改装表 Uₓ",u_s:"标准表 Uₛ"},
  "e11a3a9cc7ae": {I0_ma:"I₀",dm1_cm:"dm₁",dm2_cm:"dm₂",x_mm:"x",d_left_cm:"左侧 dₘ₁",d_right_cm:"右侧 dₘ₂"},
  "7dc359d20e2d": {t1_im_a:"励磁电流 Iₘ",t1_u1:"表1 · U₁ (+B,+I)",t1_u2:"表1 · U₂ (+B,−I)",t2_i:"工作电流 I",t2_u1:"表2 · U₁ (+B,+I)",t2_u2:"表2 · U₂ (+B,−I)"},
  "496911c88862": {L1:"Lᵢ（振幅法）",L2:"Lᵢ（位相法）"},
  "1e6e2e7fb80e": {L1:"Lᵢ（振幅法）",L2:"Lᵢ（位相法）"},
  "7b57d844de88": {ta_v:"等温 · V′",ta_dp:"等温 · Δp",tb_t:"升温 · 温度",tb_dp:"升温 · Δp",cool_t:"降温 · 温度",cool_dp:"降温 · Δp"},
  "f26fa064af29": {D:"D",d_shi:"d",X0:"X₀",X1:"X₁",Y0:"Y₀",Y1:"Y₁"},
};

export function chartFields(exp: Experiment, data?: Measurements) {
  return exp.schema.groups.flatMap(group => group.fields.flatMap(field => {
    if (field.type === "array") {
      const label = shortLabels[exp.id]?.[field.key] ?? field.label;
      const current = {key:field.key, label, unit:field.unit ?? "", legacy:false};
      if (field.key === "t1_im_a" && field.legacyKey === "t1_im")
        return [current, {key:field.legacyKey, label:label + " / mA", unit:"mA", legacy:true}];
      return [current];
    }
    if (field.type !== "matrix") return [];
    const raw = data?.[field.key];
    const matrix = Array.isArray(raw) && raw.every(Array.isArray) ? raw : null;
    const orientation = matrixAxes[exp.id+"/"+field.key];
    const axis = (direction:"row" | "column", index:number) => {
      const row = direction === "row";
      const key = row ? `${field.key}[row:${index}]` : `${field.key}[${index}]`;
      const legacy = orientation ? orientation !== direction : false;
      const header = (row ? field.rowLabels : field.colLabels)?.[index] ?? `第 ${index + 1} ${row ? "行" : "列"}`;
      if (legacy) {
        const label = field.label.split("（")[0] + " · " + header;
        return {key,label,unit:"",legacy};
      }
      const [name, headerUnit] = header.split("/");
      let label = name.replace(/^.*? (X[₀-₉]+)$/, "$1").replace(/\s*(度|分)$/, "（$1）");
      let unit = headerUnit ?? field.unit ?? "";
      if (["度/分","度、分"].includes(field.unit ?? "")) unit = header.endsWith("分") ? "′" : "°";
      if (exp.id === "78c952679319") label = (field.key === "t1" ? "幅频 · " : "相频 · ") + label;
      if (exp.id === "990c5b502ea7") label = "P（" + name + "）";
      if (field.colsFrom) label = field.key + "（" + header.replace(/^U₂=/,"").replace(/V$/," V") + "）";
      if (field.key === "coax_radii") label = "半径 r（" + name + "）";
      if (field.key === "parallel_x" || field.key === "parallel_y") label = field.key.slice(-1) + "（" + name + "）";
      if (field.key === "trials") label = "10 周期 · " + name;
      return {key,label,unit,legacy};
    };
    return [
      ...Array.from({length:matrix?.[0]?.length ?? field.cols ?? 0}, (_, i) => axis("column",i)),
      ...Array.from({length:matrix?.length ?? field.rows ?? 0}, (_, i) => axis("row",i)),
    ];
  }));
}

const defaultAxes: Record<string, [string, string]> = {
  "873fd94e5cd4":["pivot","T_avg"],
  "80846705f12f":["cos2_values","p_values"],
  "afcba21152b7":["rings","d_left"],
  "6f407f431b8a":["measurements[0]","measurements[1]"],
  "a9f6bd946367":["x","I"],
  "78c952679319":["t1[0]","t1[2]"],
  "e3de15a9b5ea":["L","R_n_zheng"],
  "2f235e76e2ec":["R","U"],
  "ffcd51d09df1":["D_x","Udx[row:0]"],
  "a1628e04a9f5":["t1_u","t1_i"],
  "a306231cddbd":["t_values","q_values"],
  "8931aa0fd0b6":["i_s","i_x"],
  "e11a3a9cc7ae":["x_mm","d_left_cm"],
  "7dc359d20e2d":["t1_im_a","t1_u1"],
  "5e3b2dde00e5":["parallel_x[row:0]","parallel_y[row:0]"],
  "7b57d844de88":["ta_v","ta_dp"],
};

export function defaultChartAxes(exp:Experiment, data:Measurements) {
  const [x,y] = defaultAxes[exp.id] ?? ["",""];
  if (x && y) {
    try {
      const horizontal = chartValues(data,x), vertical = chartValues(data,y);
      if (horizontal.length >= 2 && horizontal.length === vertical.length) return {x,y};
    } catch {
      // The experiment has no usable default series in the current draft.
    }
  }
  return {x:"",y:""};
}

export function chartForRender(exp:Experiment, data:Measurements, spec:ChartSpec) {
  const fields = chartFields(exp,data);
  const axisLabel = (key:string) => {
    const field = fields.find(f => f.key === key);
    return !field || field.legacy ? "" : field.label + (field.unit ? " / " + field.unit : "");
  };
  return {...spec, xlabel:spec.xlabel || axisLabel(spec.x), ylabel:spec.ylabel || axisLabel(spec.y)};
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
  const raw = key === "t1_im" && Array.isArray(data.t1_im_a)
    ? data.t1_im_a.map(value => typeof value === "number" ? value * 1000 : value)
    : data[m?.[1] ?? key];
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
