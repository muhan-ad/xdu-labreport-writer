import type {Profile} from './types.ts';
import {parseAIJson} from './ocr.ts';
export const studentFields=[{key:'name',api:'name',label:'姓名',max:60},{key:'studentId',api:'id',label:'学号',max:40},{key:'className',api:'class',label:'班级',max:80}] as const;
export interface OCRStudentSnapshot {values:Profile;edits:Profile;selected:(keyof Profile)[];baseline:Profile}
export function validStudentProfile(v:unknown):v is Profile{return !!v&&typeof v==='object'&&!Array.isArray(v)&&studentFields.every(f=>typeof (v as Profile)[f.key]==='string'&&(v as Profile)[f.key].length<=f.max&&!/[\u0000-\u001f\u007f]/.test((v as Profile)[f.key]));}
export function validStudentSnapshot(v:unknown):v is OCRStudentSnapshot {const s=v as OCRStudentSnapshot;return !!s&&validStudentProfile(s.values)&&validStudentProfile(s.edits)&&validStudentProfile(s.baseline)&&Array.isArray(s.selected)&&s.selected.length<=3&&new Set(s.selected).size===s.selected.length&&s.selected.every(k=>studentFields.some(f=>f.key===k));}
export function studentFromOCR(text:string):Profile{
 const raw=parseAIJson(text).student as Record<string,unknown>|undefined;
 return Object.fromEntries(studentFields.map(f=>{const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw[f.api]:null;return [f.key,typeof value==='string'&&value.trim().length<=f.max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():''];})) as unknown as Profile;
}
export function studentPatch(edits:Profile,selected:(keyof Profile)[]):Partial<Profile>{
 if(!validStudentProfile(edits))throw Error('学生信息格式无效，请核对长度与换行');
 if(!selected.length)throw Error('请勾选要录入的学生信息');
 const patch:Partial<Profile>={};for(const key of selected){const field=studentFields.find(f=>f.key===key);if(!field)throw Error('学生信息字段无效');const value=edits[key].trim();if(!value)throw Error('请填写'+field.label);patch[key]=value;}return patch;
}
