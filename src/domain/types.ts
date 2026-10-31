export type Category = "mechanics" | "optics" | "electromagnetism" | "other";
export interface Field {
  key: string;
  label: string;
  type: "number" | "science" | "array" | "matrix";
  required: boolean;
  unit?: string;
  length?: number;
  rows?: number;
  cols?: number;
  variableLength?: boolean;
  minLength?: number;
  maxLength?: number;
  allowedLengths?: number[];
  pairedMatrix?: string;
  colsFrom?: string;
  variableRows?: boolean;
  minFilledRows?: number;
  displayTranspose?: boolean;
  rowLabels?: string[];
  colLabels?: string[];
  presets?: { label: string; value: number }[];
  expSuggestions?: number[];
  legacyKey?: string;
  legacyScale?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}
export interface Schema {
  groups: { name: string; fields: Field[] }[];
}
export interface Experiment {
  id: string;
  sourceId: string;
  name: string;
  category: Category;
  schema: Schema;
  schemaHash: string;
}
export type Measurements = Record<
  string,
  number | null | (number | null)[] | (number | null)[][]
>;
export interface Science {
  mantissa: string;
  exponent: string;
}
export type Draft = Record<string, string | string[] | string[][] | Science>;
export interface RecordData {
  version: 1;
  experimentId: string;
  date: string;
  updatedAt: string;
  soundPhase?: 'alternating' | 'same';
  draft: Draft;
}
export interface Profile {
  name: string;
  studentId: string;
  className: string;
}
export interface Issue {
  key: string;
  message: string;
}
export interface Photo {
  path: string;
  mime: string;
  name: string;
}
export const categoryNames: Record<Category, string> = {
  mechanics: "力学",
  optics: "光学",
  electromagnetism: "电磁学",
  other: "其他",
};
