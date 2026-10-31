import { PortalView } from '../../src/features/portal.ts';
import { academic } from '../../src/platform/academic.ts';
import { metadataKey } from '../../src/domain/course-metadata.ts';

export async function createExpiryFixture() {
  const start = Date.parse('2026-10-29T15:55:00+08:00'), started = performance.now();
  Date.now = () => start - 2200 + performance.now() - started;
  const account = '12345678901', time = '星期四下午15:55-18:10', later = '星期四晚上18:30-20:45';
  const overview = {identity:{account,name:'模拟'},currentWeek:7,allowedWeeks:[7],calendarAnchor:{date:'2026-10-29',week:7,day:4},enrolled:[],rules:{requiredHours:24,weeklyHourLimit:9,selectedHours:0},fetchedAt:new Date(Date.now()).toISOString()};
  const make = (name:string,t:string) => ({name,week:7,time:t,day:4,period:t===time?'B':'C',start:t===time?'15:55':'18:30',end:t===time?'18:10':'20:45',remaining:1,hours:3});
  const slots = [make('即将开始甲',time),make('即将开始乙',time),make('晚间实验',later)];
  const details = (name:string,t:string) => ({name,rooms:[],warnings:[],fetchedAt:Date.now(),schedules:[{time:t,teacher:'教师甲',firstWeek:7,lastWeek:7,parity:'每周'}]});
  academic.status = async () => ({status:'disconnected',snapshot:null});
  const view = new PortalView(() => {}), state = view as any;
  state.service = {overview,week:async()=>slots,details:async(name:string)=>details(name,slots.find(s=>s.name===name)!.time)};
  state.slots=slots;state.week=7;state.tab='available';
  state.metadata=new Map(slots.map(s=>[metadataKey(s.name),details(s.name,s.time)]));
  view.mount(document.querySelector('#portal-host')!);
  return { stats:()=>({candidates:state.directoryState.experiments.length}) };
}
