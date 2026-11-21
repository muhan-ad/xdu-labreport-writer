import type {Field} from './types.ts';

interface SequenceSetting {
  start?: number;
  step?: number;
  centered?: boolean;
  rings?: boolean;
  presetOnly?: boolean;
  preset?: number[];
}
export function sequenceSetting(experiment: string, field: string): SequenceSetting | undefined;
export function sequenceValues(config: SequenceSetting, field: Field, count: number, mode: string, first: string, increment: string): number[];
export function sequenceControls(config: SequenceSetting, count: number, buttonClass: string): string;
