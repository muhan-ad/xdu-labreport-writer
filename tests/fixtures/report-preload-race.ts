import {SchoolReportView} from '../../src/features/school-reports.ts';
import type {SchoolReports} from '../../src/platform/school-reports.ts';
import type {Repository} from '../../src/domain/repository.ts';
import type {SchoolReportState} from '../../src/domain/report-status.ts';
export function createFixture(){
 let resume!:()=>void,invalidations=0,clears=0,logins=0;
 const pending=new Promise<void>(r=>resume=r);
 const fake={restoreActive:async(update:(s:SchoolReportState)=>void,onAccount:(s:string)=>void)=>{onAccount('2500000000');update({phase:'ready',rows:[],page:1,pages:1,message:''} as SchoolReportState);await pending;return '2500000000';},invalidate:()=>{invalidations++},clear:async()=>{clears++},connectSaved:async()=>{logins++}} as unknown as SchoolReports;
 const view=new SchoolReportView(()=>{},{} as Repository,[],fake);
 const account={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',system:'report' as const,account:'2500000001',label:'测试',locked:false};
 return {start:()=>{void view.warm(account)},mount:()=>view.mount(document.querySelector('#host')!),cancel:()=>view.cancelWarm(),resume,again:()=>view.warm(account),state:()=>({invalidations,clears,logins,text:document.querySelector('#host')!.textContent})};
}
