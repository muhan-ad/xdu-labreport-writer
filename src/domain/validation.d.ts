import type { Schema, Field, Measurements } from "./types.ts";
export const validation: {
  validate(schema: Schema, data: unknown, required?: boolean): string[];
  blank(schema: Schema): Measurements;
  scaleUnitValue(value: number, scale: number): number;
  migrateUnits(schema: Schema, data: unknown): unknown;
  forEditing(schema: Schema, data: unknown): Measurements;
  dimensions(
    field: Field,
    data?: unknown,
  ): { length?: number; rows?: number; cols?: number };
};
