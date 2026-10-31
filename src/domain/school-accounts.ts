export type SchoolSystem='course'|'report'|'academic';
export interface SavedSchoolAccount {id:string;system:SchoolSystem;account:string;label:string;locked:boolean;}
export function schoolSystem(value:unknown):value is SchoolSystem{return value==='course'||value==='report'||value==='academic';}
export function parseSchoolAccounts(raw:unknown):SavedSchoolAccount[]{
  const rows=(raw as {accounts?:unknown})?.accounts;
  if(!Array.isArray(rows)||rows.length>50)throw Error('本机账号列表无效');
  const ids=new Set<string>();
  return rows.map(row=>{
    if(!row||typeof row!=='object'||Object.keys(row).some(key=>!['id','system','account','label','locked'].includes(key))||typeof row.id!=='string'||!/^[a-f0-9-]{36}$/.test(row.id)||ids.has(row.id)||!schoolSystem(row.system)||typeof row.account!=='string'||typeof row.label!=='string'||row.label.length>40||typeof row.locked!=='boolean'||(row.locked?row.account!=='':!/^\d{6,30}$/.test(row.account)))throw Error('本机账号列表格式异常，请重新读取');
    ids.add(row.id);return {id:row.id,system:row.system,account:row.account,label:row.label,locked:row.locked};
  });
}
