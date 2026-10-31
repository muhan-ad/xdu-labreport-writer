import {fields} from './model.ts';
import {reviewOCR,type OCRReview} from './ocr.ts';
import type {Experiment} from './types.ts';
import {validStudentSnapshot,type OCRStudentSnapshot} from './ocr-student.ts';
export type OCREdits=Record<string,string|string[]|string[][]>;
export interface OCRSnapshot {edits:OCREdits;selected:string[]}
export interface SavedOCR {version:1;experimentId:string;sourceHash:string;savedAt:string;scan:boolean;onlyEmpty:boolean;review:OCRReview;snapshot:OCRSnapshot;student?:OCRStudentSnapshot}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const texts=(v:unknown,max:number,length:number):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(s=>typeof s==='string'&&s.length<=length);
export function validSavedOCR(v:unknown):v is SavedOCR{
 try{if(!object(v)||v.version!==1||!/^[a-f0-9]{12}$/.test(v.experimentId)||!/^[a-f0-9]{64}$/.test(v.sourceHash)||typeof v.savedAt!=='string'||!Number.isFinite(Date.parse(v.savedAt))||typeof v.scan!=='boolean'||typeof v.onlyEmpty!=='boolean'||new TextEncoder().encode(JSON.stringify(v)).length>500000)return false;
 const r=v.review,s=v.snapshot;if(!object(r)||!object(r.values)||!object(r.warnings)||!texts(r.errors,100,500)||!object(s)||!object(s.edits)||!texts(s.selected,200,100)||new Set(s.selected).size!==s.selected.length)return false;
 if(v.student!==undefined&&!validStudentSnapshot(v.student))return false;
 if(Object.keys(r.values).length>200||Object.keys(r.warnings).length>200||Object.keys(s.edits).length>200)return false;
 const safe=(key:string)=>key.length<=100&&!['__proto__','constructor','prototype'].includes(key);
 const numeric=(x:unknown):boolean=>x===null||typeof x==='number'&&Number.isFinite(x);
 const raw=(x:unknown):boolean=>typeof x==='string'&&x.length<=100;
 const shape=(x:unknown,leaf:(x:unknown)=>boolean):boolean=>leaf(x)||Array.isArray(x)&&x.length<=1000&&x.every(a=>leaf(a)||Array.isArray(a)&&a.length<=1000&&a.every(leaf));
 return Object.entries(r.values).every(([k,x])=>safe(k)&&shape(x,numeric))&&Object.entries(r.warnings).every(([k,x])=>safe(k)&&typeof x==='string'&&x.length<=500)&&Object.entries(s.edits).every(([k,x])=>safe(k)&&shape(x,raw))&&s.selected.every(k=>Object.hasOwn(s.edits,k));
 }catch{return false;}
}
export function usableSavedOCR(exp:Experiment,value:unknown,sourceHash:string):value is SavedOCR{
 if(!validSavedOCR(value)||value.experimentId!==exp.id||value.sourceHash!==sourceHash)return false;
 try{
  const review=reviewOCR(exp.schema,JSON.stringify({data:value.review.values,warnings:value.review.warnings}));
  if(JSON.stringify(review.values)!==JSON.stringify(value.review.values))return false;
  if(Object.keys(value.snapshot.edits).sort().join('\0')!==Object.keys(review.values).sort().join('\0'))return false;
  for(const field of fields(exp.schema)){
   if(!Object.hasOwn(review.values,field.key))continue;
   const x=value.snapshot.edits[field.key];
   if(field.type==='number'||field.type==='science'){if(typeof x!=='string')return false;}
   else if(field.type==='array'){
    if(!Array.isArray(x)||x.some(v=>typeof v!=='string')||(field.variableLength?x.length<(field.minLength??3)||x.length>(field.maxLength??100):x.length!==field.length))return false;
   }else{
    if(!Array.isArray(x)||x.length!==field.rows||x.some(row=>!Array.isArray(row)||row.some(v=>typeof v!=='string')||(!field.colsFrom&&row.length!==field.cols)))return false;
    const xs=field.colsFrom?value.snapshot.edits[field.colsFrom]:null;
    if(Array.isArray(xs)&&x.some(row=>(row as string[]).length!==xs.length))return false;
   }
  }return true;
 }catch{return false;}
}
