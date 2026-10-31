import {ReportUploadConfirm} from '../../src/features/report-upload-confirm.ts';
let commits=0,discarded=0;
const view=new ReportUploadConfirm(async()=>{commits++;},async()=>{discarded++;},async()=>{},()=>{});
export async function show(){const bytes=new TextEncoder().encode('test'),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');view.show({ticket:'12345678-1234-1234-1234-123456789abc',previewPath:'report-uploads/12345678-1234-1234-1234-123456789abc/report.docx',size:4,sha256:hash,expiresIn:120,row:{name:'实验',week:'1',time:'下午'},fileName:'报告.docx'} as any,{snapshot:{profile:{name:'学生',studentId:'123'},record:{date:'2026-10-20'}}} as any);}
export function state(){return {commits,discarded};}
