import {PortalView} from '../../src/features/portal.ts';import {academic} from '../../src/platform/academic.ts';import {defaultCourseFilters} from '../../src/domain/course-filters.ts';import type {AcademicResult} from '../../src/domain/academic.ts';import {metadataKey} from '../../src/domain/course-metadata.ts';
export async function createConflictFixture(){
 const now=Date.parse('2026-10-24T08:00:00Z');Date.now=()=>now;
 const account='12345678901',name='冲击法测量直螺线管磁场实验';
 const overview={identity:{account,name:'模拟'},currentWeek:6,allowedWeeks:[7,30],calendarAnchor:{date:'2026-10-23',week:6,day:5},enrolled:[],rules:{requiredHours:24,weeklyHourLimit:9,selectedHours:0},fetchedAt:new Date(now).toISOString()};
 const slots=[{name,week:7,time:'星期四下午15:55-18:10',day:4,period:'B',start:'15:55',end:'18:10',remaining:2,hours:3},{name,week:7,time:'星期五下午15:55-18:10',day:5,period:'B',start:'15:55',end:'18:10',remaining:2,hours:3},{name,week:30,time:'星期四下午15:55-18:10',day:4,period:'B',start:'15:55',end:'18:10',remaining:2,hours:3}];
 const fresh:AcademicResult={status:'fresh',snapshot:{account,semester:'2026-2027-1',termStart:'2026-09-07',termEnd:'2027-01-17',events:[{name:'高数',code:'M',number:'01',room:'A101',date:'2026-10-29',start:'15:55',end:'17:30'}],warnings:[],unscheduled:[],complete:true,scheduledComplete:true,fetchedAt:new Date(now).toISOString()}};
 let value:AcademicResult|null=fresh,commits=0,checked=true,saved=defaultCourseFilters();academic.status=async()=>value??{status:'disconnected',snapshot:null};
 const view=new PortalView(()=>{}),state=view as any;const meta={name,rooms:['F219'],warnings:[],fetchedAt:now,schedules:slots.map(s=>({teacher:'吴兴林',time:s.time,firstWeek:1,lastWeek:60,parity:'每周'}))};
 state.service={overview,prepare:async(_action:string,item:{name:string;time:string;week:number})=>({ticket:crypto.randomUUID(),item:{...item,date:'2026-10-30'},action:'add',expectedTeachers:['吴兴林'],expiresIn:120,academicChecked:checked}),discard:async()=>{},commit:async()=>{commits++;return {verified:true,overview,message:'模拟选课成功'};},refresh:async()=>overview,week:async()=>slots,details:async()=>meta};
 state.filterPanel.preferences={load:async()=>structuredClone(saved),save:async(_owner:string,next:typeof saved)=>{saved=structuredClone(next);}};
 const reset=async()=>{state.slots=slots;state.tab='available';state.week=7;state.metadata=new Map([[metadataKey(name),meta]]);state.directorySlots=new Map(slots.map((s,i)=>[String(i),s]));state.directoryState={experiments:[],status:'模拟目录已读取'};state.directoryReadAt=now;state.directoryOverview=overview;state.render();await state.refreshAcademic();};
 view.mount(document.querySelector('#portal-host')!);await state.filterPanel.load(account);await reset();
 return {stats:()=>({commits,saved}),reopen:async()=>{view.leave();view.mount(document.querySelector('#portal-host')!);await state.filterPanel.load(account);await reset();},cross:()=>{state.crossWeek=true;state.searchSlots=slots;state.render();},stale:async()=>{value={...fresh,status:'stale'};await state.refreshAcademic();},unknown:async()=>{value=null;checked=false;await reset();},fresh:async()=>{Date.now=()=>now;value=fresh;checked=true;await reset();},guides:()=>{state.tab='recommend';state.render();},close:()=>view.closeReview(),
  expire:(tab:'available'|'selected',cross=false)=>{const started=performance.now();Date.now=()=>now+24*3600000-150+(performance.now()-started);state.tab=tab;state.crossWeek=cross;state.searchSlots=slots;state.render();},
  regainFocus:()=>{value={...fresh,snapshot:{...fresh.snapshot!,fetchedAt:new Date(Date.now()).toISOString()}};window.dispatchEvent(new Event('focus'));},
  refreshDisconnected:async()=>{value=null;await state.refreshAcademic();},
  refreshFresh:async()=>{value=fresh;await state.refreshAcademic();},
  restore:async()=>{Date.now=()=>now;value=fresh;state.crossWeek=false;await reset();}
 };
}
