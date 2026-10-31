import {SchoolReportView} from '../../src/features/school-reports.ts';
import {defaultReportSettings} from '../../src/domain/reports.ts';
import type {Repository} from '../../src/domain/repository.ts';
import type {Experiment} from '../../src/domain/types.ts';
import type {SchoolReports} from '../../src/platform/school-reports.ts';
const exp={id:'abcdef123456',name:'测试实验'} as Experiment;
const record={version:1,experimentId:exp.id,date:'2026-10-20',updatedAt:'2026-10-20',draft:{x:'1'}},profile={name:'学生',studentId:'123',className:'1'},settings=defaultReportSettings();
let hash:string|undefined='a'.repeat(64),prepared=0,shown=0;
const repo={load:async()=>({record}),loadProfile:async()=>profile,loadPhoto:async()=>null,loadReportSettings:async()=>settings} as unknown as Repository;
const service={prepareUpload:async()=>{prepared++;return {ticket:'mock-ticket'};}} as unknown as SchoolReports;
const resources=async()=>({resourceHash:hash,payload:null,version:'test',warning:''});
const view=new SchoolReportView(()=>{},repo,[exp],service,resources) as any;
view.host=document.createElement('div');view.state={page:1};view.confirmation={show:()=>shown++};
const saved={experimentId:exp.id,generation:'12345678-1234-1234-1234-123456789abc',snapshot:{record,profile,photoPath:null,settings,resourceHash:hash}};
export async function attempt(current:string|undefined,expected:string|undefined){hash=current;saved.snapshot.resourceHash=expected;try{await view.stage({fingerprint:'test'},exp,saved);return {ok:true,prepared,shown};}catch(e){return {ok:false,message:(e as Error).message,prepared,shown};}}
