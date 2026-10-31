import {normalizeCourseDate,type Overview,type Slot,type Enrolled} from './portal.ts';
import {resolveSlotDate} from './course-eligibility.ts';
export interface AcademicEvent {name:string;code:string;number:string;room:string;date:string;start:string;end:string;}
export interface AcademicSnapshot {account:string;semester:string;termStart:string;termEnd:string|null;events:AcademicEvent[];warnings:string[];unscheduled:string[];complete:boolean;scheduledComplete:boolean;fetchedAt:string;}
export interface AcademicResult {status:'disconnected'|'reading'|'fresh'|'incomplete'|'stale';snapshot:AcademicSnapshot|null;cacheWarning?:string;}
export const academicMaxAge=24*3600000;
export function academicAvailable(value:AcademicResult|null,account:string,now=Date.now()){
 const s=value?.snapshot,age=s?now-Date.parse(s.fetchedAt):NaN;return !!s&&s.account===account&&value?.status==='fresh'&&s.complete&&age>=0&&age<academicMaxAge;
}
export function academicConflict(value:AcademicResult|null,item:Slot|Enrolled,overview:Overview,now=Date.now()):{status:'clear'|'conflict'|'unknown';event?:AcademicEvent}{
 const s=value?.snapshot;if(!s||s.account!==overview.identity.account)return {status:'unknown'};
 const interval=(entry:Slot|Enrolled)=>{const date='date'in entry&&entry.date?normalizeCourseDate(entry.date):resolveSlotDate(entry,overview);const m=/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/.exec(entry.time);if(!date||!m||+m[1]>23||+m[3]>23||+m[2]>59||+m[4]>59)return null;const start=m[1].padStart(2,'0')+':'+m[2],end=m[3].padStart(2,'0')+':'+m[4];return start<end?{date,start,end}:null;};
 const actual=interval(item);if(!actual)return {status:'unknown'};let {start,end}=actual;if(item.time.includes('下午')){start='15:55';end='17:30';}else if(item.time.includes('晚上')){start='19:00';end='21:25';}
 for(const event of s.events){if(event.date!==actual.date||event.start>=end||start>=event.end)continue;
  if((event.name.includes('物理实验')||event.name===item.name)&&overview.enrolled.some(booked=>{const b=interval(booked);return b?.date===event.date&&b.start===event.start&&b.end===event.end;}))continue;
  return {status:'conflict',event};
 }
 return {status:academicAvailable(value,overview.identity.account,now)&&!!s.termEnd&&actual.date>=s.termStart&&actual.date<=s.termEnd?'clear':'unknown'};
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const label=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function parseAcademicResult(raw:unknown,account:string):AcademicResult {
 if(!plain(raw)||!['disconnected','reading','fresh','incomplete','stale'].includes(String(raw.status)))throw Error('教务状态无法核实');
 if(raw.cacheWarning!==undefined&&!label(raw.cacheWarning,200))throw Error('教务缓存状态无法核实');
 if(raw.snapshot===null){if(raw.status==='fresh')throw Error('教务课表缺失');return raw as unknown as AcademicResult;}
 const s=raw.snapshot;
 if(!plain(s)||s.account!==account||!/^\d{5,20}$/.test(account)||typeof s.semester!=='string'||!/^\d{4}-\d{4}-[12]$/.test(s.semester)||!date(s.termStart)||(s.termEnd!==null&&(!date(s.termEnd)||s.termEnd<s.termStart))||typeof s.complete!=='boolean'||typeof s.scheduledComplete!=='boolean'||typeof s.fetchedAt!=='string'||!Number.isFinite(Date.parse(s.fetchedAt)))throw Error('教务课表身份或校历无法核实');
 if(!Array.isArray(s.events)||s.events.length>50000||!s.events.every(e=>plain(e)&&label(e.name)&&!!e.name&&label(e.code,100)&&!!e.code&&label(e.number,100)&&label(e.room)&&date(e.date)&&clock(e.start)&&clock(e.end)&&e.start<e.end)||!Array.isArray(s.warnings)||s.warnings.length>20000||!s.warnings.every(w=>label(w,500))||!Array.isArray(s.unscheduled)||s.unscheduled.length>20000||!s.unscheduled.every(w=>label(w)))throw Error('教务课程数据格式无法识别');
 if(s.complete&&(!s.scheduledComplete||s.warnings.length||s.unscheduled.length)||raw.status==='fresh'&&!s.complete)throw Error('教务课表完整性状态不一致');
 return raw as unknown as AcademicResult;
}
