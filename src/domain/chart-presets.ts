import catalog from '../data/chart-presets.json' with {type:'json'};
import type {Experiment} from './types.ts';
import {validChartWidth} from './chart-width.ts';
export interface OfficialChartSelection {preset:string;embed:boolean;section:string;widthCm?:number;}
export interface ChartGuide {status:string;description:string;charts:{id:string;title:string;xLabel:string;yLabel:string}[];}
export function chartGuide(exp:Pick<Experiment,'sourceId'>):ChartGuide|null {
 return Object.hasOwn(catalog,exp.sourceId)?(catalog as Record<string,ChartGuide>)[exp.sourceId]:null;
}
export function validOfficialChart(raw:unknown):raw is OfficialChartSelection {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const value=raw as OfficialChartSelection;
 return typeof value.preset==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(value.preset)&&typeof value.embed==='boolean'&&typeof value.section==='string'&&!!value.section.trim()&&value.section.length<=100&&validChartWidth(value.widthCm);
}
export function assertOfficialChart(exp:Pick<Experiment,'sourceId'>,selection:unknown):asserts selection is OfficialChartSelection {
 if(!validOfficialChart(selection))throw Error('预设配置无效');
 const guide=chartGuide(exp);
 if(!guide?.charts.length||selection.preset!=='all'&&!guide.charts.some(c=>c.id===selection.preset))throw Error('此实验没有所选预设，请重新选择');
}
