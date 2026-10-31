import {reportIntegrity} from './vendor/report-integrity.js';
import {assertPolishText} from './polish-batch.ts';
import type {ReportSettings} from './reports.ts';
export interface ImportText {label:string;text:string;original?:string;}
export interface ImportReview {label:string;warning:boolean;}
// Match the original Python content policy before persisting adopted text.
const instructions=['误差应结合本次数据和仪器说明评定','按知识库口径','用户填写','用户提供的','不能采用示例','未照抄源文档','不虚构数值上限','保留所有占位符','只输出改写后的'];
export function reviewImportedTexts(entries:ImportText[],values:Record<string,unknown>):ImportReview[]{
 if(!entries.length||entries.length>32)throw Error('请选择需要导入的内容');
 return entries.map(entry=>{try{if(typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>100)throw Error('导入章节或题号无效');if(typeof entry.text!=='string'||!entry.text.trim()||entry.text.length>20000)throw Error('导入正文为空或过长');if(entry.original!==undefined)assertPolishText(entry.original,entry.text);const compact=entry.text.replace(/\s+/g,'');if(instructions.some(s=>compact.includes(s)))throw Error('正文包含软件说明或通用写作指导，请改写为实验正文');return {label:entry.label,warning:reportIntegrity.inspectText(entry.text,values).warnings.length>0};}catch(error){throw Error(entry.label+'：'+(error as Error).message);}});
}
export function setImportWarnings(options:NonNullable<ReportSettings['ai']>,reviews:ImportReview[]){
 const warnings=new Map(Object.entries(options.reviewWarnings??{}));for(const review of reviews){if(review.warning)warnings.set(review.label,'数值来源、单位与精度待核对');else warnings.delete(review.label);}if(warnings.size)options.reviewWarnings=Object.fromEntries(warnings);else delete options.reviewWarnings;
}
