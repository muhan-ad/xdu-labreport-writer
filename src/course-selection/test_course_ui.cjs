const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const {sameSlot,courseStage,studyProgress,nextUpcomingIndex}=vm.runInNewContext(source.split('// UI')[0]+';({sameSlot,courseStage,studyProgress,nextUpcomingIndex})',{setTimeout});
test('same slot matches normalized name/week/time but preserves other weeks and sessions',()=>{
 const a={name:'测试实验',week:6,time:'星期一下午15:55-18:10'};
 assert.ok(sameSlot(a,{...a,week:'6',time:'星期一 下午15:55–18:10'}));
 assert.ok(!sameSlot(a,{...a,week:7}));assert.ok(!sameSlot(a,{...a,time:'星期二下午15:55-18:10'}));assert.ok(!sameSlot(a,{...a,name:'其他实验'}));
});
test('progress counts only ended sessions and requires real date and ending time',()=>{
 const now=Date.parse('2026-10-16T18:10:00+08:00'),a={date:'2026/10/16',time:'星期五下午15:55-18:10',hours:3};
 assert.equal(courseStage(a,now-1),'ongoing');assert.equal(courseStage(a,now),'ended');assert.equal(courseStage({...a,date:''},now),'unknown');
 const p=studyProgress([a,{...a,date:'2026/10/17'},{...a,date:''}],12,now);
 assert.equal(p.completedHours,3);assert.equal(p.percent,25);assert.equal(p.ended,1);assert.equal(p.total,3);
 assert.equal(studyProgress([a],0,now).percent,0);assert.equal(studyProgress([a],1,now).percent,100);
});

test('runner marks nearest future start and excludes ongoing or past sessions',()=>{
 const item=(date,time)=>({date,time});
 const items=[item('2026/10/21','星期三晚上18:30-20:45'),item('2026/10/14','星期三下午15:55-18:10'),item('2026/10/19','星期一下午15:55-18:10'),item('2026/10/19','星期一晚上18:30-20:45'),item('','星期一晚上18:30-20:45')];
 const at=t=>Date.parse('2026-10-19T'+t+'+08:00');
 assert.equal(nextUpcomingIndex(items,at('15:54:59')),2);
 assert.equal(nextUpcomingIndex(items,at('15:55:00')),3);
 assert.equal(nextUpcomingIndex(items,at('16:00:00')),3);
 assert.equal(nextUpcomingIndex(items,at('18:30:00')),0);
 assert.equal(nextUpcomingIndex(items,Date.parse('2026-10-22T00:00:00+08:00')),-1);
 assert.equal(nextUpcomingIndex([]),-1);
 assert.equal(nextUpcomingIndex([{date:'2026/02/30',time:'星期一下午15:55-18:10'}],0),-1);
});

test('record rail renders the runner only on nearest future session and boundary timer advances it',()=>{
 const now=Date.parse('2026-10-19T16:00:00+08:00'),items=[{name:'进行中的实验',date:'2026/10/19',time:'星期一下午15:55-18:10'},{name:'下一场实验',date:'2026/10/19',time:'星期一晚上18:30-20:45'}];
 const helpers=vm.runInNewContext(source.split('// UI')[0]+';({courseStage,nextUpcomingIndex,dateUTC,courseStartTime,courseEndTime})',{setTimeout});
 const nodes={search:{value:''},listSummary:{},calendar:{}};let scheduled;
 const scope={...helpers,overview:{enrolled:items},$:id=>nodes[id],esc:String,metadataFor:x=>x,animateCalendar(){},busy:false,uncertain:false,Date:class extends Date{static now(){return now}},clearTimeout(){},setTimeout:(_callback,delay)=>{scheduled=delay;},experimentInterval:()=>null,window:{CourseRules:{cancelState:()=>({allowed:false,reason:'不可取消',boundary:null})}},render(){}};
 vm.createContext(scope);const begin=source.indexOf('function recordIcon('),end=source.indexOf("window.addEventListener('focus'");vm.runInContext(source.slice(begin,end),scope);
 scope.renderRecords();const html=nodes.calendar.innerHTML;
 assert.match(html,/进行中的实验[\s\S]*?aria-label="进行中的实验：进行中"/);
 assert.match(html,/aria-label="下一场实验：未开始，下一场实验"><span class="schedule-runner">/);
 assert.equal((html.match(/class="schedule-runner"/g)||[]).length,1);
 scope.updateCancellation();assert.equal(scheduled,Date.parse('2026-10-19T18:10:00+08:00')-now+10);
 nodes.search.value='进行中的';scope.renderRecords();assert.doesNotMatch(nodes.calendar.innerHTML,/class="schedule-runner"/);
});
