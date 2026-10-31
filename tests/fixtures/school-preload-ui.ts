import {SchoolAccountsView} from '../../src/features/school-accounts.ts';
import type {SavedSchoolAccount,SchoolSystem} from '../../src/domain/school-accounts.ts';
import {defaultSchoolPreload,type SchoolPreloadPreference} from '../../src/domain/school-preload.ts';
export function createFixture(){
 let rows:SavedSchoolAccount[]=[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',system:'course',account:'12345678',label:'甲',locked:false},{id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',system:'course',account:'87654321',label:'乙',locked:false},{id:'cccccccc-cccc-cccc-cccc-cccccccccccc',system:'report',account:'12345678',label:'报告',locked:false},{id:'dddddddd-dddd-dddd-dddd-dddddddddddd',system:'course',account:'',label:'损坏',locked:true}];let pref=defaultSchoolPreload(),failRead=false,failSave=false,events=0;
 const port={list:async()=>structuredClone(rows),save:async(v:{system:SchoolSystem;account:string;password:string;label:string;confirmed:boolean})=>({id:crypto.randomUUID()}),remove:async(id:string)=>{rows=rows.filter(r=>r.id!==id)},reset:async()=>{rows=[]}};
 const preload={load:async()=>{if(failRead)throw Error('read');return structuredClone(pref)},save:async(v:SchoolPreloadPreference)=>{if(failSave)throw Error('save');pref=structuredClone(v)},reset:async()=>{failRead=false;pref=defaultSchoolPreload()}};
 window.addEventListener('school-preload-changed',()=>events++);const manager=new SchoolAccountsView(port,async()=>true,()=>{},preload);const mount=()=>manager.mount(document.querySelector('#account-host')!);mount();
 return {state:()=>({rows,pref,events,busy:manager.isSaving,status:document.querySelector('[data-account-status]')?.textContent}),reopen:mount,failRead:(v:boolean)=>failRead=v,failSave:(v:boolean)=>failSave=v};
}
