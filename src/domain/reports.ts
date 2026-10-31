import {validCopyText} from './report-copy.ts';
import {validQuizQuestions} from './generation-quiz.ts';
import type { Experiment, RecordData, Profile } from "./types.ts";
import { validRecord } from "./model.ts";
import { validChartSpec, type ChartSpec } from "./charts.ts";
import {validAdoptedAIPlot,type AdoptedAIPlot} from './ai-plot.ts';
import {validOfficialChart,type OfficialChartSelection} from './chart-presets.ts';
import {validVariantEdits,validCustomVariants,type VariantEdits,type CustomVariants} from './variant-edits.ts';
export interface ReportSettings {
  version: 1;
  variants: Record<string, number>;
  disabledSections: string[];
  variantEdits?:VariantEdits;
  customVariants?:CustomVariants;
  embedPhoto: boolean;
  customCharts?: ChartSpec[];
  officialCharts?:OfficialChartSelection;
  aiPlot?:AdoptedAIPlot;
  customQuestions?:string[];
  ai?: {
    source: string;
    customQuiz?: { questions: string[]; answers: Record<string, string[]> };
    polish?: Record<string, string>;
    historyRefs?: {quiz?:string;polish?:Record<string,string>};
    reviewWarnings?:Record<string,string>;
  };
}
export interface ReportSnapshot {
  resourceHash?:string;
  record: RecordData;
  profile: Profile;
  photoPath: string | null;
  settings: ReportSettings;
}
export interface SavedReport {
  version: 1;
  experimentId: string;
  generation: string;
  createdAt: string;
  name: string;
  formulaCount: number;
  notices?:string[];
  copySections?:Record<string,string>;
  copyIssues?:Record<string,string>;
  sections: Record<string, unknown>;
  headings?: string[];
  charts: { name: string; file: string }[];
  snapshot: ReportSnapshot;
}
export const defaultReportSettings = (): ReportSettings => ({
  version: 1,
  variants: {},
  disabledSections: [],
  embedPhoto: true,
});
/** Remove only imported text which still points at the deleted history entry. */
export function detachAIHistory(settings: ReportSettings, id?: string): ReportSettings {
  const next = structuredClone(settings);
  const options = next.ai, refs = options?.historyRefs;
  if (!options || !refs) return next;
  if (refs.quiz && (!id || refs.quiz === id)) {
    delete options.customQuiz;
    for(const key of Object.keys(options.reviewWarnings??{}))if(/^第\d+题$/.test(key))delete options.reviewWarnings![key];
    delete refs.quiz;
  }
  for (const [section, recordId] of Object.entries(refs.polish ?? {})) {
    if (!id || recordId === id) {
      delete options.polish?.[section];
      delete options.reviewWarnings?.[section];
      delete refs.polish?.[section];
    }
  }
  if (!Object.keys(refs.polish ?? {}).length) delete refs.polish;
  if(options.reviewWarnings&&!Object.keys(options.reviewWarnings).length)delete options.reviewWarnings;
  if (!refs.quiz && !refs.polish) delete options.historyRefs;
  if (!options.customQuiz && !Object.keys(options.polish ?? {}).length) delete next.ai;
  return next;
}
export function safeReportFilename(value: string) {
  let name = Array.from(value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim())
    .slice(0, 60)
    .join("")
    .replace(/[. ]+$/, "");
  name = name.replace(/实验实验报告\.docx$/, "实验报告.docx");
  if (!name) return "实验报告.docx";
  return name.endsWith(".docx") ? name : name + ".docx";
}
export function reportFilename(experimentName: string) {
  return safeReportFilename(
    experimentName +
      (experimentName.endsWith("实验") ? "报告.docx" : "实验报告.docx"),
  );
}
export function validReportSettings(raw: unknown): raw is ReportSettings {
  const x = raw as ReportSettings;
  return (
    !!x &&
    x.version === 1 &&
    typeof x.embedPhoto === "boolean" &&
    (x.variantEdits===undefined||validVariantEdits(x.variantEdits))&&
    (x.customVariants===undefined||validCustomVariants(x.customVariants))&&
    (x.officialCharts===undefined||validOfficialChart(x.officialCharts))&&
    (x.aiPlot===undefined||validAdoptedAIPlot(x.aiPlot))&&
    (x.customCharts === undefined ||
      (Array.isArray(x.customCharts) &&
        x.customCharts.length <= 8 &&
        x.customCharts.every(validChartSpec))) &&
    !!x.variants &&
    typeof x.variants === "object" &&
    !Array.isArray(x.variants) &&
    Object.keys(x.variants).length <= 32 &&
    Object.entries(x.variants).every(
      ([k, v]) => k.length <= 100 && Number.isInteger(v) && v >= -1 && v <= 100,
    ) &&
    Array.isArray(x.disabledSections) &&
    x.disabledSections.length <= 32 &&
    x.disabledSections.every((k) => typeof k === "string" && k.length <= 100) &&
    (x.customQuestions===undefined||validQuizQuestions(x.customQuestions))&&validAIOptions(x.ai)
  );
}
export function validAIOptions(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const x = raw as NonNullable<ReportSettings["ai"]>;
  if(x.reviewWarnings!==undefined&&(!x.reviewWarnings||typeof x.reviewWarnings!=='object'||Array.isArray(x.reviewWarnings)||Object.keys(x.reviewWarnings).length>64||!Object.entries(x.reviewWarnings).every(([k,v])=>k.length<=100&&typeof v==='string'&&v.length<=200)))return false;
  if (new TextEncoder().encode(JSON.stringify(x)).length > 300000) return false;
  if (typeof x.source !== "string" || x.source.length > 200000) return false;
  if(x.historyRefs!==undefined){const h=x.historyRefs;if(!h||typeof h!=='object'||(h.quiz!==undefined&&!/^[a-f0-9-]{36}$/.test(h.quiz))||(h.polish!==undefined&&(!h.polish||typeof h.polish!=='object'||Array.isArray(h.polish)||Object.keys(h.polish).length>32||!Object.entries(h.polish).every(([k,v])=>k.length<=100&&typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)))))return false;}
  if (
    x.polish !== undefined &&
    (!x.polish ||
      typeof x.polish !== "object" ||
      Array.isArray(x.polish) ||
      Object.keys(x.polish).length > 32 ||
      !Object.entries(x.polish).every(
        ([k, v]) =>
          k.length <= 100 && !k.startsWith("@copy:") && typeof v === "string" && v.length <= 20000,
      ))
  )
    return false;
  if (x.customQuiz !== undefined) {
    const q = x.customQuiz;
    if (
      !q ||
      !Array.isArray(q.questions) ||
      !q.questions.length ||
      q.questions.length > 12 ||
      !q.questions.every(
        (v) => typeof v === "string" && !!v.trim() && v.length <= 1000,
      ) ||
      !q.answers ||
      typeof q.answers !== "object" ||
      Array.isArray(q.answers)
    )
      return false;
    if (
      !Object.entries(q.answers).every(
        ([k, v]) =>
          /^[1-9]\d*$/.test(k) &&
          Number(k) <= q.questions.length &&
          Array.isArray(v) &&
          v.length === 1 &&
          typeof v[0] === "string" &&
          v[0].length > 0 &&
          v[0].length <= 20000,
      )
    )
      return false;
    if (q.questions.some((_, i) => !q.answers[String(i + 1)])) return false;
  }
  return true;
}
export function validSavedReport(
  exp: Experiment,
  raw: unknown,
): raw is SavedReport {
  const x = raw as SavedReport;
  return (
    !!x &&
    x.version === 1 &&
    x.experimentId === exp.id &&
    /^[a-f0-9-]{36}$/.test(x.generation) &&
    typeof x.name === "string" &&
    x.name.length <= 180 &&
    typeof x.createdAt === "string" &&
    Number.isFinite(Date.parse(x.createdAt)) &&
    Number.isInteger(x.formulaCount) &&
    x.formulaCount >= 0 &&
    (x.notices===undefined||(Array.isArray(x.notices)&&x.notices.length<=20&&x.notices.every(n=>typeof n==='string'&&n.length<=2000)))&&
    (x.headings === undefined ||
      (Array.isArray(x.headings) &&
        x.headings.length <= 100 &&
        x.headings.every((h) => typeof h === "string" && h.length <= 200))) &&
    !!x.snapshot &&
    validRecord(exp, x.snapshot.record) &&
    (x.snapshot.resourceHash===undefined||(typeof x.snapshot.resourceHash==='string'&&/^[a-f0-9]{64}$/.test(x.snapshot.resourceHash))) &&
    !!x.snapshot.profile &&
    ["name", "studentId", "className"].every(
      (k) =>
        typeof x.snapshot.profile[k as keyof Profile] === "string" &&
        x.snapshot.profile[k as keyof Profile].length <= 100,
    ) &&
    validReportSettings(x.snapshot.settings) &&
    (!x.snapshot.settings.aiPlot||x.snapshot.settings.aiPlot.experimentId===exp.id)&&
    (x.snapshot.photoPath === null ||
      new RegExp(`^photos/${exp.id}/[a-f0-9-]+\\.(jpg|png|webp)$`).test(
        x.snapshot.photoPath,
      )) &&
    Array.isArray(x.charts) &&
    x.charts.length <= 32 &&
    x.charts.every(
      (c) =>
        typeof c.name === "string" &&
        c.name.length <= 1000 &&
        /^chart-\d+\.(png|jpg|jpeg)$/.test(c.file),
    ) &&
    (x.copySections===undefined||validCopyText(x.copySections))&&
    (x.copyIssues===undefined||validCopyText(x.copyIssues))&&
    !!x.sections &&
    typeof x.sections === "object" &&
    JSON.stringify(x.sections).length <= 400000
  );
}
export function sameReportInputs(a: ReportSnapshot, b: ReportSnapshot) {
  const stable = (s: ReportSnapshot) =>
    JSON.stringify({
      resourceHash:s.resourceHash??null,
      draft: s.record.draft,
      soundPhase: s.record.soundPhase??null,
      date: s.record.date,
      profile: s.profile,
      photo: s.settings.embedPhoto ? s.photoPath : null,
      settings: s.settings,
    });
  return stable(a) === stable(b);
}
