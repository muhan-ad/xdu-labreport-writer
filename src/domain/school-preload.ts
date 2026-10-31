import type {SavedSchoolAccount} from './school-accounts.ts';
export interface SchoolPreloadPreference {version:1;course:string|null;report?:string|null;}
export const defaultSchoolPreload=():SchoolPreloadPreference=>({version:1,course:null});
export function validSchoolPreload(value:unknown):value is SchoolPreloadPreference {
 const p=value as SchoolPreloadPreference;const id=(v:unknown)=>v===null||(typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v));return !!p&&p.version===1&&Object.keys(p).every(k=>['version','course','report'].includes(k))&&Object.hasOwn(p,'course')&&id(p.course)&&(!Object.hasOwn(p,'report')||id(p.report));
}
export function preloadReportAccount(preference:SchoolPreloadPreference,accounts:SavedSchoolAccount[]):SavedSchoolAccount|null {
 if(!validSchoolPreload(preference))throw Error('自动加载设置无效');
 return accounts.find(a=>a.id===preference.report&&a.system==='report'&&!a.locked)??null;
}
/** The preference references only a vault ID. Never guess a different account. */
export function preloadCourseAccount(preference:SchoolPreloadPreference,accounts:SavedSchoolAccount[]):SavedSchoolAccount|null {
 if(!validSchoolPreload(preference))throw Error('自动加载设置无效');
 return accounts.find(a=>a.id===preference.course&&a.system==='course'&&!a.locked)??null;
}
