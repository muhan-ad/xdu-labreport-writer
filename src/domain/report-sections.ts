import type {ReportSettings} from './reports.ts';
const validNames=(names:unknown):names is string[]=>Array.isArray(names)&&names.length<=32&&new Set(names).size===names.length&&names.every(s=>typeof s==='string'&&!!s.trim()&&s.length<=100&&!/[\u0000-\u001f\u007f]/.test(s));
export function reportSectionNames(template:unknown){
 if(!template||typeof template!=='object'||Array.isArray(template))throw Error('实验章节模板未能核实');
 const names=Object.keys(template);if(!validNames(names))throw Error('实验章节名称或数量无效');return names;
}
export function knownDisabledSections(names:string[],disabled:string[]){
 if(!validNames(names)||!Array.isArray(disabled))throw Error('章节开关无效');const values=new Set(disabled);return names.filter(name=>values.has(name));
}
export function mergeSectionSwitches(settings:ReportSettings,names:string[],disabled:string[],expected:string[]){
 if(!validNames(names)||!validNames(disabled)||!validNames(expected)||disabled.some(s=>!names.includes(s))||expected.some(s=>!names.includes(s)))throw Error('章节开关与当前实验不匹配');
 if(JSON.stringify(knownDisabledSections(names,settings.disabledSections))!==JSON.stringify(knownDisabledSections(names,expected)))throw Error('章节开关已变化，请重新读取后核对');
 const next=structuredClone(settings),known=new Set(names);next.disabledSections=[...settings.disabledSections.filter(s=>!known.has(s)),...knownDisabledSections(names,disabled)];
 if(next.disabledSections.length>32)throw Error('保留的章节配置超过上限，请先在实验中核对');return next;
}
