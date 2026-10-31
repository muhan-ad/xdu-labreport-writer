import {openReport,shareReport,shareChart} from '../../src/platform/reports.ts';import {saveReportToDirectory} from '../../src/platform/report-directory.ts';import type {SavedReport} from '../../src/domain/reports.ts';
const report={experimentId:'123456abcdef',generation:'12345678-1234-1234-1234-123456789abc',name:'示例报告.docx',charts:[]} as SavedReport;
export const open=()=>openReport(report);export const save=()=>saveReportToDirectory(report);export const share=()=>shareReport(report);
export const chart=(v:number)=>shareChart(report.experimentId,new Uint8Array([v,2,3]),'示例图表');
