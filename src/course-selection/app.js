'use strict';
// Data helpers: no DOM dependency, also exercised by test_preload.cjs.
class RequestQueue {
  constructor(){this.foreground=[];this.background=[];this.running=false;}
  request(task,background=false){return new Promise((resolve,reject)=>{(background?this.background:this.foreground).push({task,resolve,reject});this.drain();});}
  async drain(){if(this.running)return;const job=this.foreground.shift()||this.background.shift();if(!job)return;this.running=true;try{job.resolve(await job.task());}catch(e){job.reject(e);}finally{this.running=false;setTimeout(()=>this.drain(),0);}}
}
class WeekCache {
  constructor(fetchWeek){this.fetchWeek=fetchWeek;this.version=0;this.values=new Map();this.pending=new Map();this.prefetchVersion=-1;}
  clear(){this.version++;this.values.clear();this.pending.clear();}
  peek(week){return this.values.get(Number(week));}
  get(week,background=false){week=Number(week);if(this.values.has(week))return Promise.resolve(this.values.get(week));if(this.pending.has(week))return this.pending.get(week);const version=this.version;const promise=Promise.resolve().then(()=>this.fetchWeek(week,background)).then(data=>{if(version===this.version)this.values.set(week,data);return data;}).finally(()=>{if(this.pending.get(week)===promise)this.pending.delete(week);});this.pending.set(week,promise);return promise;}
  async prefetch(weeks,valid=()=>true){const version=this.version;if(this.prefetchVersion===version)return;this.prefetchVersion=version;try{for(const week of weeks){if(version!==this.version||!valid())break;try{await this.get(week,true);}catch(e){if(e.status===401)break;}await new Promise(resolve=>setTimeout(resolve,0));}}finally{if(this.prefetchVersion===version)this.prefetchVersion=-1;}}
}
const CATEGORY_RULES = {
  mechanics: ['扭摆', '重力', '转动惯量', '简谐振动', '拉伸法', '杨氏', '复摆', '三线摆', '音叉', '动量', '碰撞'],
  optics: ['薄透镜', '衍射', '三棱镜', '平凸', '牛顿环', '偏振', '激光波长', '光栅', '劈尖', '迈克尔逊', '焦距', '光强'],
  electromagnetism: ['电表', '电子元件', '伏安', '电子束', '电子偏转', '灵敏电流计', '静电场', '霍尔', '螺线管', '磁场', '低电阻', '电容', '高电阻', 'RLC', '马吕斯', '单臂电桥', '电流场', '双臂电桥', '电动势', '电位差计'],
};
const CATEGORY_NAMES={mechanics:'力学',optics:'光学',electromagnetism:'电磁',other:'其他'};
function getCategory(name){for(const [category,keywords] of Object.entries(CATEGORY_RULES)){if(keywords.some(keyword=>name.includes(keyword)))return category;}return 'other';}
function alignExperiments(entries){
 const groups=new Map(),order={mechanics:0,optics:1,electromagnetism:2,other:3};
 for(const entry of entries){if(entry.day<1||entry.day>5)continue;if(!groups.has(entry.name))groups.set(entry.name,[]);groups.get(entry.name).push(entry);}
 const sorted=[...groups.entries()].map(([name,items])=>({name,items,days:new Set(items.map(item=>item.day))})).sort((a,b)=>b.days.size-a.days.size||order[getCategory(a.name)]-order[getCategory(b.name)]||a.name.localeCompare(b.name,'zh-CN'));
 const rows=[];
 for(const group of sorted){let row=rows.find(candidate=>[...group.days].every(day=>candidate[day-1].length===0));if(!row){row=Array.from({length:5},()=>[]);rows.push(row);}for(const entry of group.items)row[entry.day-1].push(entry);}
 return rows.length?rows:[Array.from({length:5},()=>[])];
}
function collectSearchResults(snapshots,query){
 const needle=query.trim().toLocaleLowerCase(),seen=new Set(),results=[];
 for(const snapshot of snapshots){if(!snapshot)continue;for(const slot of snapshot.slots||[]){if(slot.week!==snapshot.week||!Number.isFinite(slot.remaining)||slot.remaining<=0||!slot.name.toLocaleLowerCase().includes(needle))continue;const key=JSON.stringify([slot.week,slot.name,slot.day,slot.period,slot.time]);if(seen.has(key))continue;seen.add(key);results.push({...slot});}}
 return results.sort((a,b)=>a.week-b.week||a.day-b.day||a.period.localeCompare(b.period)||a.name.localeCompare(b.name,'zh-CN'));
}
function dateUTC(value){const m=String(value||'').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);if(!m)return null;const date=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return date.getUTCFullYear()===+m[1]&&date.getUTCMonth()===+m[2]-1&&date.getUTCDate()===+m[3]?date:null;}
function experimentInterval(item,enrolled,calendarAnchor=null){
 const pattern=/星期([一二三四五六日天])(?:下午|晚上|上午)?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/,match=String(item.time||'').match(pattern);if(!match)return null;
 const weekday=day=>'一二三四五六日'.indexOf(day.replace('天','日'))+1;let date=dateUTC(item.date);
 if(!date){const anchor=[...enrolled,...(calendarAnchor?[calendarAnchor]:[])].find(entry=>dateUTC(entry.date)&&entry.week&&pattern.test(entry.time));if(!anchor)return null;date=dateUTC(anchor.date);date.setUTCDate(date.getUTCDate()+(+item.week-+anchor.week)*7+weekday(match[1])-weekday(anchor.time.match(pattern)[1]));}
 return {date:date.toISOString().slice(0,10),start:match[2].padStart(5,'0'),end:match[3].padStart(5,'0')};
}
function academicInterval(item,enrolled,calendarAnchor=null){
 const slot=experimentInterval(item,enrolled,calendarAnchor);if(!slot)return null;
 if(String(item.time||'').includes('下午'))Object.assign(slot,{start:'15:55',end:'17:30'});
 else if(String(item.time||'').includes('晚上'))Object.assign(slot,{start:'19:00',end:'21:25'});
 return slot;
}
function personalConflict(snapshot,item,enrolled,calendarAnchor=null){
 if(!snapshot)return null;const slot=academicInterval(item,enrolled,calendarAnchor);if(!slot)return null;
 return (snapshot.events||[]).find(event=>{
  if(event.date!==slot.date||event.start>=slot.end||slot.start>=event.end)return false;
  if(event.name.includes('物理实验')||event.name===item.name){if(enrolled.some(booked=>{const current=experimentInterval(booked,enrolled,calendarAnchor);return current&&['date','start','end'].every(key=>current[key]===event[key]);}))return false;}
  return true;
 })||null;
}
function labConflict(item,enrolled){
 if(enrolled.some(x=>x.name===item.name))return '已选过该实验';
 if(enrolled.some(x=>x.week===item.week&&x.time===item.time))return '与已选实验时段冲突';
 return '';
}
function hideExperiment(item,hideLab,hideAcademic,overview,snapshot){
 return !!((hideLab&&labConflict(item,overview?.enrolled||[]))||(hideAcademic&&personalConflict(snapshot,item,overview?.enrolled||[],overview?.calendarAnchor)));
}
function resolveCourseMetadata(item,details){
 if(!details)return item;
 const normalize=s=>String(s||'').replace(/\s/g,'').replace(/[–—～~]/g,'-').replace(/天/g,'日');
 const matches=(details.schedules||[]).filter(s=>normalize(s.time)===normalize(item.time)&&Number(item.week)>=s.firstWeek&&Number(item.week)<=s.lastWeek&&(!['单周','单'].includes(s.parity)||Number(item.week)%2===1)&&(!['双周','双'].includes(s.parity)||Number(item.week)%2===0));
 const teachers=[...new Set(matches.map(s=>s.teacher).filter(Boolean))],rooms=details.rooms||[];
 return {...item,teacher:teachers.join('／'),room:item.room||(rooms.length===1?rooms[0]:''),metadataWarning:[...(details.warnings||[]),teachers.length>1?'官网同场次列出多位教师':'',rooms.length>1?'官网列有多个教室，请核对：'+rooms.join('／'):''].filter(Boolean).join('；')};
}
function courseUnavailable(item,kind,reason='') { return kind !== 'available' || !!reason || !Number.isFinite(item.remaining) || item.remaining <= 0; }
function sameSlot(a,b){
 const norm=value=>String(value||'').replace(/\s/g,'').replace(/[–—～~]/g,'-').replace(/天/g,'日');
 return norm(a.name)===norm(b.name)&&Number(a.week)===Number(b.week)&&norm(a.time)===norm(b.time);
}
function courseEndTime(item){
 const date=dateUTC(item.date),end=String(item.time||'').match(/(\d{1,2}:\d{2})\s*$/);
 if(!date||!end)return null;
 const [hour,minute]=end[1].split(':').map(Number);if(hour>23||minute>59)return null;
 return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute)-8*3600000;
}
function courseStartTime(item){
 const date=dateUTC(item.date),time=String(item.time||'').match(/(\d{1,2}:\d{2})\s*[-–—～~]\s*\d{1,2}:\d{2}\s*$/);
 if(!date||!time)return null;
 const [hour,minute]=time[1].split(':').map(Number);if(hour>23||minute>59)return null;
 return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute)-8*3600000;
}
function courseStage(item,now=Date.now()){
 const end=courseEndTime(item),start=courseStartTime(item);
 return end===null||start===null||end<=start?'unknown':end<=now?'ended':start<=now?'ongoing':'upcoming';
}
function nextUpcomingIndex(items,now=Date.now()){
 let nearest=-1,time=Infinity;
 items.forEach((item,index)=>{const start=courseStartTime(item),end=courseEndTime(item);if(start!==null&&end!==null&&end>start&&start>now&&start<time){time=start;nearest=index;}});
 return nearest;
}
function studyProgress(items,required,now=Date.now()){
 const ended=items.filter(item=>courseStage(item,now)==='ended'),hours=item=>Math.max(0,Number(item.hours)||0);
 const completedHours=ended.reduce((sum,item)=>sum+hours(item),0),target=Math.max(0,Number(required)||0);
 return {ended:ended.length,total:items.length,completedHours,target,percent:target?Math.min(100,Math.round(completedHours/target*100)):0};
}
// UI
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf='',overview=null,weekData=null,view='choose',busy=false,ticket=null,uncertain=false;
let teacherCategory='recommended';
const TEACHER_CATEGORIES=[['recommended','推荐'],['not_recommended','不推荐'],['mixed','介中']];
let searchResults=[],searchWeeks=[],searchFailures=new Map(),searchGeneration=0;
let academicState={status:'not_connected',snapshot:null},academicAccount='',academicStarted='',academicPending=false,academicGeneration=0;
let autoLoggingIn=false;
let entryLoading=true;
function finishEntry(){const completed=entryLoading;entryLoading=false;$('entryLoading').hidden=true;if(completed&&overview)void window.courseWindow?.control('ready');}
$('retryEntry').onclick=async()=>{if(window.courseWindow)await window.courseWindow.control('retry');else location.reload();};$('skipEntry').onclick=()=>{finishEntry();$('loginSettingsDialog').showModal();void loadSchoolAccountSettings();};
let pendingExternalSystem=null;
document.querySelectorAll('[data-system]').forEach(b=>b.onclick=()=>{
 pendingExternalSystem=b.dataset.system;const name=pendingExternalSystem==='exam'?'物理试题系统':'虚拟仿真系统';
 $('externalSystemTitle').textContent='前往'+name;$('externalSystemMessage').textContent=`实验搭子暂未兼容应用内访问${name}，点击继续后将跳转到学校官网，在默认浏览器中访问。`;$('externalSystemDialog').showModal();
});
for(const id of ['closeExternalSystem','cancelExternalSystem'])$(id).onclick=()=>$('externalSystemDialog').close();
$('externalSystemDialog').addEventListener('close',()=>pendingExternalSystem=null);
$('continueExternalSystem').onclick=async()=>{const system=pendingExternalSystem;if(!system)return;$('externalSystemDialog').close();pendingExternalSystem=null;const result=await window.courseWindow?.openSystem(system);if(!result?.ok)notice(result?.error||'网站未打开，请重试',true);};
document.querySelectorAll('[data-window]').forEach(b=>b.onclick=()=>window.courseWindow?.control(b.dataset.window));
document.querySelector('.window-bar').ondblclick=event=>{if(!event.target.closest('button'))void window.courseWindow?.control('maximize');};
let academicEntry=crypto.randomUUID(),lastAnimationKey='',lastAnimationWeek=0,calendarAnimation=null;
let liveDataRevision=0,academicReady=Promise.resolve(),clearingSessions=false;
const requests=new RequestQueue(),metadataCache=new Map(),weeksCache=new WeekCache((week,background)=>api('week',{week},background).then(data=>{liveDataRevision++;queueCourseMetadata(data.slots||[]);window.FilterUI?.changed();return data;}));
function metadataFor(item){const cached=metadataCache.get(item.name);return resolveCourseMetadata(item,cached?.version===weeksCache.version?cached.data:null);}
function queueCourseMetadata(items,foreground=false){
 const pending=[];
 const version=weeksCache.version;
 for(const name of new Set(items.map(item=>item.name))){
  if(metadataCache.get(name)?.version===version){if(metadataCache.get(name).promise)pending.push(metadataCache.get(name).promise);continue;}
  const entry={version,data:null};metadataCache.set(name,entry);
  entry.promise=requests.request(()=>version===weeksCache.version?sendApi('course-details',{name}):null,!foreground).then(data=>{if(data)entry.data=data;}).catch(()=>{entry.data={warnings:['教师和教室信息暂未读取，可刷新重试']};}).finally(()=>{if(overview&&version===weeksCache.version){liveDataRevision++;scheduleMetadataRender();}});
  pending.push(entry.promise);
 }
 return Promise.all(pending);
}
let metadataRenderTimer;function scheduleMetadataRender(){clearTimeout(metadataRenderTimer);metadataRenderTimer=setTimeout(()=>{render();renderCourseSearch();window.FilterUI?.changed();},60)}
function api(path,data={},background=false){return requests.request(()=>sendApi(path,data),background);}
async function sendApi(path,data={}){const requestVersion=weeksCache.version;const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)});const result=await response.json();if(!response.ok){if(response.status===401&&requestVersion===weeksCache.version){weeksCache.clear();overview=null;weekData=null;ticket=null;resetAcademic();for(const id of ['required','weekly','selected'])$(id).textContent='— 学时';$('studentName').textContent='请重新登录学校账号';$('studentAccount').textContent='本地会话已失效';$('connection').textContent='尚未登录';$('accountButton').textContent='登录';$('enrolledCount').textContent='—';$('week').innerHTML='<option>尚未读取周次</option>';render();}const error=new Error(result.error||'操作失败');Object.assign(error,result);error.status=response.status;error.needsRefresh=result.needsRefresh;throw error;}return result;}
function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
function syncCourseControls(){
 $('refresh').disabled=busy||!overview;$('week').disabled=busy||!overview;
 const weeks=overview?.weeks||[],index=weeks.indexOf(Number($('week').value));
 $('previous').disabled=busy||!overview||index<=0;$('next').disabled=busy||!overview||index<0||index>=weeks.length-1;
 $('openSearch').disabled=busy||!overview;
}
function setBusy(value,label){busy=value;$('busy').hidden=!value;$('busyText').textContent=label||'正在读取学校数据…';document.querySelectorAll('button:not([data-window]),select').forEach(b=>{if(value){b.dataset.wasDisabled=String(b.disabled);b.disabled=true;}else b.disabled=b.dataset.wasDisabled==='true';});if(!value){document.querySelectorAll('.nav,#accountButton,#closeLogin,#loginSubmit,#closeConfirm').forEach(b=>b.disabled=false);$('refresh').disabled=!overview;$('week').disabled=!overview;const weeks=overview?.weeks||[],idx=weeks.indexOf(Number($('week').value));$('previous').disabled=!overview||idx<=0;$('next').disabled=!overview||idx>=weeks.length-1;$('submitCourse').disabled=!ticket;render();}}
async function run(label,task){if(busy)return;setBusy(true,label);try{await task();}catch(e){if(e.needsRefresh){uncertain=true;ticket=null;}$('confirmError').textContent=e.message;if($('searchDialog').open){$('searchStatus').textContent=e.message;$('searchStatus').classList.add('error');}notice(e.message,true);}finally{setBusy(false);}}
function conflict(item){if(!overview)return '';const lab=labConflict(item,overview.enrolled);if(lab)return lab;const course=personalConflict(academicState.snapshot,item,overview.enrolled,overview.calendarAnchor);return course?`与教务课程「${course.name}」${course.start}–${course.end} 冲突`:'';}
function resetAcademic(){academicGeneration++;academicAccount='';academicStarted='';academicPending=false;academicState={status:'not_connected',snapshot:null};renderAcademicStatus();}
function renderAcademicStatus(){
 const node=$('academicStatus'),snapshot=academicState.snapshot;
 const labels={not_connected:'教务课表未连接',cached:'使用已保存教务课表',syncing:'正在更新教务课表',fresh:'教务课表已同步',partial:'教务课表不完整',stale:'教务课表更新失败',needs_login:'教务需要登录',unavailable:'教务课表不可用',needs_browser:'等待浏览器连接',waiting_browser:'等待教务浏览器'};
 node.textContent=labels[academicState.status]||'教务课表未更新';node.classList.toggle('academic-warning',!['fresh','syncing','cached'].includes(academicState.status));
 if(academicState.status==='partial'&&snapshot?.scheduledComplete)node.textContent='已排课程已同步（另有未排课课程）';
 if(snapshot&&!['fresh','partial'].includes(academicState.status))node.textContent+=' · 使用上次课表';
 renderAcademicProgress();
 node.title=[academicState.message,snapshot?`更新于 ${snapshot.fetchedAt}；${snapshot.events.length} 个上课时段`:'尚不能检查个人课程冲突'].filter(Boolean).join('；');
 $('connectAcademic').hidden=false;$('connectAcademic').disabled=!overview||busy||academicPending;
 $('connectAcademic').textContent=academicPending?'正在连接教务…':snapshot?'刷新课表':'登录';
 $('hideConflicts').title='隐藏已选过的实验和与已选实验同场次的实验';
 $('hideAcademicConflicts').disabled=!snapshot||busy;
 $('hideAcademicConflicts').title=snapshot?'按实际日期检查：下午 15:55–17:30，晚上 19:00–21:25；未排课课程无法检查，缓存时间见登录设置。':'请先在登录设置中同步教务课表，再启用此筛选';
}
function renderAcademicProgress(){
 const panel=$('academicProgress'),bar=$('academicProgressBar'),p=academicState.progress;
 panel.hidden=!academicPending&&!p;if(panel.hidden)return;
 const success=['fresh','partial'].includes(academicState.status),failed=academicState.status==='stale';
 $('academicLoginProgress').textContent=p?.authenticated||success?'教务登录 · 已完成':failed?'教务登录 · 已停止':p?.stage==='launching'?'教务登录 · 正在启动 Edge':'教务登录 · 等待学校认证';
 const names=['查询学期','读取校历','读取每周课程','读取调停课','读取未排课课程'];
 $('academicReadProgress').textContent=success?'课表读取 · 已完成':failed?(academicState.message||'读取失败，保留上次课表'):p?.stage==='validating'?'课表读取 · 正在校验':p?.stage==='reading'||p?.stage==='authenticated'?`课表读取 · ${names[Math.max(0,(p.step||1)-1)]}${p.page>1?' · 第 '+p.page+' 页':''}`:'课表读取 · 等待登录';
 if(failed)bar.value=Math.max(0,(p?.step||1)-1);else if(success)bar.value=6;else if(p?.stage==='validating')bar.value=5;else if(p?.stage==='reading'||p?.stage==='authenticated')bar.value=Math.max(0,(p.step||1)-1);else bar.removeAttribute('value');
 panel.classList.toggle('failed',failed);panel.classList.toggle('complete',success);
}
async function syncAcademic(interactive=false){
 const account=String(overview?.identity?.account||'');if(clearingSessions||!account||academicPending)return;
 if(!interactive&&academicStarted===account)return;
 if(academicAccount!==account){resetAcademic();academicAccount=account;}
 academicStarted=account;academicPending=true;const generation=academicGeneration;
 academicState={...academicState,status:'syncing',progress:interactive?{stage:'launching',step:0,authenticated:false}:undefined};renderAcademicStatus();
 try{
  if(!interactive){const cached=await sendApi('academic/state');if(generation!==academicGeneration||String(overview?.identity?.account||'')!==account)return;academicState={...cached,status:'syncing'};renderAcademicStatus();render();}
  if(!interactive){academicState={...academicState,status:academicState.snapshot?'cached':'not_connected'};render();return;}
  const started=await sendApi('academic/browser-start',{entry:academicEntry,interactive,transport:'edge'});
  if(generation!==academicGeneration||String(overview?.identity?.account||'')!==account)return;
  if(!started.jobId){academicState=started;render();renderCourseSearch();return;}
  const deadline=Date.now()+(started.timeoutSeconds||60)*1000;
  while(Date.now()<deadline){
    if(generation!==academicGeneration||String(overview?.identity?.account||'')!==account)return;
    const result=await sendApi('academic/browser-state',{jobId:started.jobId});
    if(generation!==academicGeneration||String(overview?.identity?.account||'')!==account)return;
    academicState=result;renderAcademicStatus();
    if(result.done){render();renderCourseSearch();return;}
    // Local bridge status only; this does not poll school APIs.
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  academicState={...academicState,status:'stale',message:'浏览器同步超时，请重新连接'};render();
 }catch(error){if(generation===academicGeneration){academicState={...academicState,status:'stale',message:error.message};}}
 finally{if(generation===academicGeneration){academicPending=false;renderAcademicStatus();}}
}

function applyOverview(data){if(academicAccount&&academicAccount!==String(data.identity?.account||''))resetAcademic();overview=data;queueCourseMetadata(data.enrolled||[]);const previous=Number($('week').value);$('week').innerHTML=data.weeks.map(w=>`<option value="${w}">第 ${w} 周${w===data.currentWeek?' · 本周':''}</option>`).join('');$('week').value=String(data.weeks.includes(previous)?previous:(data.weeks.includes(data.currentWeek)?data.currentWeek:data.weeks[0]));for(const [id,key] of [['required','requiredHours'],['weekly','weeklyHourLimit'],['selected','selectedHours']])$(id).innerHTML=`${esc(data.rules[key])}<small> 学时</small>`;$('studentName').textContent=data.identity?`${data.identity.name}`:'已连接学校账号';$('studentAccount').textContent=data.identity?data.identity.account:'学校未提供身份信息';$('enrolledCount').textContent=data.enrolled.length;$('connection').textContent='已连接学校系统';$('accountButton').textContent='退出登录';academicReady=syncAcademic();}
function prefetchWeeks(){if(overview)void weeksCache.prefetch((overview.allowedWeeks||overview.weeks).filter(w=>w>=overview.currentWeek),()=>!!overview);}
async function loadWeek(complete=false){if(!overview)return;const week=Number($('week').value),version=weeksCache.version;weekData=weeksCache.peek(week)||null;render();try{const result=await weeksCache.get(week);if(overview&&version===weeksCache.version&&Number($('week').value)===week){weekData=result;if(complete){$('entryLoadingMessage').textContent='正在读取教师、教室与冲突检查信息…';await queueCourseMetadata([...(result.slots||[]),...(overview.enrolled||[])],true);await academicReady;}render();notice('');if(complete){const failed=[...(result.slots||[]),...(overview.enrolled||[])].some(x=>metadataCache.get(x.name)?.data?.warnings?.some(w=>w.includes('暂未读取')));if(failed||!academicState.snapshot)notice(failed?'部分教师或教室信息读取失败，请刷新重试。':'教务课表未连接，课程冲突未校验。',failed);}}}finally{prefetchWeeks();}}
function switchWeek(){if(busy||!overview)return;const requestedWeek=Number($('week').value);setBusy(false);void loadWeek().catch(e=>{if(!overview||Number($('week').value)===requestedWeek)notice(e.message,true);});}
function weekDate(day,week=Number($('week').value)){const anchor=overview?.enrolled.find(x=>x.date&&x.week);if(!anchor)return '';const m=anchor.date.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/),d=anchor.time.match(/星期([一二三四五])/);if(!m||!d)return '';const date=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12);date.setDate(date.getDate()+(week-anchor.week)*7+day-('一二三四五'.indexOf(d[1])+1));return `${date.getMonth()+1}.${date.getDate()}`;}
function card(item,kind,index){const reason=kind==='available'?conflict(item):'',cancel=kind==='enrolled'&&item.cancellable,unavailable=courseUnavailable(item,kind,reason);return `<article class="course category-${getCategory(item.name)} ${unavailable?'unavailable':''} ${kind==='enrolled'?'enrolled':''} ${reason?'conflict':''}"><h3>${esc(item.name)}${reviewMark(globalThis.GuideReviews?.recommendation(item.name)?.category)}</h3><p title="${esc(item.metadataWarning||'教师按官网实验、周次、场次匹配；教室来自官网实验项目查询')}">教师：${teacherReviewText(item.teacher)}</p><p title="${esc(item.metadataWarning||'')}">教室：${esc(item.room||'未获取／待确认')}</p>${reason?`<p class="reason">${esc(reason)}</p>`:''}<div class="course-bottom"><span class="course-category">${CATEGORY_NAMES[getCategory(item.name)]}</span><span class="seats">${kind==='available'?`余 ${esc(item.remaining)} 人`:'已选'}</span>${kind==='available'?`<button class="btn" data-action="add" data-index="${index}" ${unavailable||busy||uncertain?'disabled':''}>选课</button>`:`<button class="btn danger cancel-course" data-action="cancel" data-index="${index}" ${!cancel||busy||uncertain?'disabled':''}>${cancel?'退课':esc(item.cancelReason||'无法取消')}</button>`}</div><button class="btn course-review" data-action="review-card" data-kind="${kind}" data-index="${index}">查看评价</button></article>`;}
function recordIcon(kind){
 const paths={calendar:'<path d="M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2"/>',book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1z M12 5v15"/>',person:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',runner:'<circle cx="16" cy="4" r="2"/><path d="m5 8 4-2 5 3-3 5 4 3 1 5M14 9l3 3h4M11 14l-4 5H2"/>'};
 return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind]||''}</svg>`;
}
function reviewMark(category){return category==='recommended'?'<span class="review-status recommended">推荐</span>':category==='not_recommended'?'<span class="review-status not-recommended">不推荐</span>':'';}
function teacherReviewText(value){return value?String(value).split(/[／、,，]/).map(name=>esc(name.trim())+reviewMark(globalThis.GuideReviews?.teacher(name.trim())?.category)).join('／'):'未获取';}
function openEnrolledReview(index){
 const item=overview?.enrolled?.[index];if(item)openCourseReview(item);
}
function openCourseReview(item){if(!item)return;const resolved=metadataFor(item),entry=window.GuideReviews.recommendation(item.name);
 const teachers=String(resolved.teacher||'').split(/[／、,，]/).map(n=>n.trim()).filter(Boolean);
 $('reviewTitle').textContent=item.name;
 $('reviewBody').innerHTML='<section class="review-section"><h3>实验评价</h3><p class="review-text">'+esc(entry?.review||'暂无评价')+'</p></section>'+ (teachers.length?teachers.map(name=>{const teacher=window.GuideReviews.teacher(name),groups=teacher?.groups.filter(g=>g.experiments.some(n=>window.GuideReviews.nameMatches(n,item.name)))||[];return '<section class="review-section"><h3>'+esc(name)+'</h3><p class="review-text">'+esc(groups.map(g=>g.review).join('\n')||'暂无评价')+'</p></section>'}).join(''):'<section class="review-section"><h3>教师评价</h3><p class="review-text">教师信息未获取，暂无评价</p></section>');
 $('reviewDialog').showModal();
}
function renderRecords(){
 const query=$('search').value.trim(),now=Date.now();
 const rows=(overview?.enrolled||[]).map((item,index)=>({...metadataFor(item),index})).filter(item=>item.name.includes(query));
 const next=nextUpcomingIndex(overview?.enrolled||[],now);
 $('listSummary').textContent=`${rows.length} 项已选实验`;
 $('calendar').innerHTML=rows.map((item,position)=>{
  const stage=courseStage(item,now),done=stage==='ended',current=item.index===next;
  const date=dateUTC(item.date),dateLabel=date?`${date.getUTCFullYear()}.${String(date.getUTCMonth()+1).padStart(2,'0')}.${String(date.getUTCDate()).padStart(2,'0')}`:'日期待确认';
  const time=String(item.time||'').match(/(星期[一二三四五六日天](?:上午|下午|晚上)?)\s*(\d{1,2}:\d{2})\s*[-–—～~]\s*(\d{1,2}:\d{2})/);
  const status={ended:'已结束',ongoing:'进行中',upcoming:'未开始',unknown:'日期待确认'}[stage];
  return `<div class="schedule-row ${done?'done':''} ${current?'current':''}"><span class="schedule-number">${String(position+1).padStart(2,'0')}</span><article class="schedule-card ${done?'done':''} ${current?'current':''}"><div class="schedule-content"><h3 class="schedule-name record-name">${esc(item.name)}</h3><div class="schedule-details" title="${esc(item.metadataWarning||'')}"><span>${recordIcon('person')}${esc(item.teacher||'教师未获取')}</span><span class="record-room">${recordIcon('pin')}${esc(item.room||'教室待确认')}</span></div><button class="btn review-jump" data-action="review" data-index="${item.index}">查看评价</button></div><div class="schedule-date"><strong>${esc(dateLabel)}</strong><span>第 ${esc(item.week)} 周 · ${esc(time?time[1]:'时间待确认')}</span><div class="schedule-time">${esc(time?time[2]+' — '+time[3]:item.time||'')}</div><button class="btn cancel-course" data-action="cancel" data-index="${item.index}" ${!item.cancellable||busy||uncertain?'disabled':''}>${item.cancellable?'取消选课':esc(item.cancelReason||'无法取消')}</button></div></article><div class="schedule-rail" role="img" aria-label="${esc(item.name)}：${status}${current?'，下一场实验':''}">${current?`<span class="schedule-runner">${recordIcon('runner')}</span>`:''}<span class="schedule-segment"></span></div></div>`;
 }).join('')||`<div class="schedule-empty">${!overview?'请先登录学校账号':query?'未找到匹配实验':'暂无已选实验'}</div>`;
 animateCalendar();
}
let cancellationTimer;
function updateCancellation(){
 clearTimeout(cancellationTimer);if(!overview||!window.CourseRules)return;const now=Date.now(),boundaries=[];
 for(const item of overview.enrolled||[]){item.officialCancellable??=item.cancellable===true;const status=window.CourseRules.cancelState(item,experimentInterval(item,overview.enrolled,overview.calendarAnchor),now);item.cancellable=status.allowed;item.cancelReason=status.reason;if(status.boundary>now)boundaries.push(status.boundary);for(const stamp of [courseStartTime(item),courseEndTime(item)])if(stamp!==null&&stamp>now)boundaries.push(stamp);}
 if(boundaries.length)cancellationTimer=setTimeout(()=>render(),Math.min(2147483647,Math.max(10,Math.min(...boundaries)-now+10)));
}
window.addEventListener('focus',()=>{if(overview)render()});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&overview)render()});
function animateCalendar(){
 const week=Number($('week').value),key=view+':'+week;
 if(key===lastAnimationKey||!$('calendar').animate)return;
 const distance=view==='choose'?(week<lastAnimationWeek?-24:24):12;
 lastAnimationKey=key;lastAnimationWeek=week;calendarAnimation?.cancel();
 calendarAnimation=$('calendar').animate([{opacity:.25,transform:'translateX('+distance+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'});

}
function render(){
 updateCancellation();window.FilterUI?.syncAccount();syncCourseControls();
 renderAcademicStatus();
 const guide=['recommend','teacher','faq'].includes(view);
 $('guideMount').hidden=!guide;document.body.classList.toggle('guide-mode',guide);if(!guide)window.LiveGuide?.leave();
 $('recommendPanel').hidden=true;$('teacherPanel').hidden=true;$('faqPanel').hidden=true;
 if(guide){
  clearTimeout(reportTimer);reportTimer=null;if($('reportDialog').open)$('reportDialog').close();
  for(const id of ['reportSurface','courseStudentCard','coursePanel','notice','refresh'])$(id).hidden=true;
  document.querySelector('.academic-reminder').hidden=true;$('pageTitle').textContent={recommend:'实验推荐',teacher:'老师推荐',faq:'常见问题'}[view];
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));renderGuide();return;
 }
 const reporting=view==='report';
 $('reportSurface').hidden=!reporting;$('courseStudentCard').hidden=reporting;$('coursePanel').hidden=reporting;
 document.querySelector('.academic-reminder').hidden=reporting;$('notice').hidden=reporting||!$('notice').textContent;$('refresh').hidden=reporting;
 document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
 syncReportSurface();
 if(reporting){$('pageTitle').textContent='实验报告提交';return;}
 const listView=view!=='choose';
 document.querySelector('.week-control').hidden=listView;
 $('listSummary').hidden=!listView;
 $('hideConflicts').closest('label').hidden=listView;
 $('hideAcademicConflicts').closest('label').hidden=listView;
 $('search').hidden=!listView;
 $('openSearch').hidden=listView;$('openFilters').hidden=listView;
 $('search').readOnly=false;
 $('search').placeholder='搜索实验名称…';
 if(listView)$('search').removeAttribute('aria-haspopup');else $('search').setAttribute('aria-haspopup','dialog');
 $('calendar').className=listView?'records':'calendar';
 $('calendar').setAttribute('aria-label',listView?'全部已选实验课表':'每周实验课表');
 document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
 $('pageTitle').textContent={choose:'开始选课',enrolled:'我的实验课表'}[view];
 if(listView){renderRecords();return;}
 const week=Number($('week').value),query=$('search').value.trim(),hide=$('hideConflicts').checked;
 const enrolled=(overview?.enrolled||[]).map((item,index)=>({...metadataFor(item),index})).filter(item=>!hide&&item.week===week&&item.name.includes(query)&&(!window.FilterUI||window.FilterUI.matches(item)));
 const available=(weekData?.week===week?weekData.slots:[]).map((item,index)=>({...metadataFor(item),index})).filter(item=>!overview?.enrolled.some(booked=>sameSlot(item,booked))&&item.name.includes(query)&&!hideExperiment(item,hide,$('hideAcademicConflicts').checked,overview,academicState.snapshot)&&(!window.FilterUI||window.FilterUI.matches(item)));
 $('weekSummary').textContent=overview?(weekData?`${available.length} 个场次`:'正在读取本周场次…'):'';
 let html='<div class="day-head">场次</div>';
 for(let day=1;day<=5;day++)html+=`<div class="day-head">周${'一二三四五'[day-1]}<small>${esc(weekDate(day))}</small></div>`;
 for(const period of ['B','C']){
  const entries=available.filter(item=>item.period===period).map(item=>({name:item.name,day:item.day,kind:'available',index:item.index,item}));
  for(const item of enrolled){const time=item.time.match(/星期([一二三四五])(下午|晚上)/);if(time&&(time[2]==='下午'?'B':'C')===period)entries.push({name:item.name,day:'一二三四五'.indexOf(time[1])+1,kind:'enrolled',index:item.index,item});}
  const rows=alignExperiments(entries),label=period==='B'?'下午':'晚上';
  html+=`<section class="period-block" aria-label="${label}场次"><div class="period-head">${label}<small>${period==='B'?'15:55—18:10':'18:30—20:45'}</small></div><div class="period-rows">`;
  rows.forEach((row,rowIndex)=>row.forEach((items,dayIndex)=>{html+=`<div class="cell" data-align-row="${rowIndex}" data-day="${dayIndex+1}">${items.map(entry=>card(entry.item,entry.kind,entry.index)).join('')}</div>`;}));
  html+='</div></section>';
 }
 $('calendar').innerHTML=html;
 if(weekData?.week===week)animateCalendar();
}
function renderGuide(){window.LiveGuide?.render(view);}
async function prepare(action,index,sourceItem=null){updateCancellation();const item=sourceItem||(action==='add'?weekData?.slots[index]:overview?.enrolled[index]);if(!item)return;if(action==='cancel'&&!item.cancellable){notice(item.cancelReason||'官网当前不允许取消',true);render();return;}await run('正在核对官网资格及当前名额…',async()=>{ticket=null;$('confirmError').textContent='';const result=await api('prepare',{action,...item});ticket=result.ticket;result.item=metadataFor(result.item);$('confirmTitle').textContent=action==='add'?'确认选择这项实验':'确认取消这项实验';$('confirmBody').innerHTML=`<div class="detail"><b>${esc(result.item.name)}</b><p>第 ${esc(result.item.week)} 周 · ${esc(result.item.time)}</p><p>教师 ${esc(result.item.teacher||'未获取')}</p>${result.item.room?`<p>教室 ${esc(result.item.room)}</p>`:''}</div><p class="dialog-muted">${action==='add'?'确认提交选课？':'退课后原名额可能被其他人选走。'}</p>`;if($('searchDialog').open){searchGeneration++;$('searchDialog').close();}$('confirmDialog').showModal();});}

function renderCourseSearch(){
 if(!$('searchDialog').open)return;
 searchResults=collectSearchResults(searchWeeks.map(week=>weeksCache.peek(week)),$('searchQuery').value).map(metadataFor).filter(item=>!hideExperiment(item,$('hideConflicts').checked,$('hideAcademicConflicts').checked,overview,academicState.snapshot)&&(!window.FilterUI||window.FilterUI.matches(item)));
 const loaded=searchWeeks.filter(week=>weeksCache.peek(week)).length;
 const pending=searchWeeks.length-loaded-searchFailures.size;
 $('searchStatus').classList.toggle('error',searchFailures.size>0);
 $('searchStatus').textContent=`${searchResults.length} 个有余量场次`+(pending>0?` · 正在读取 ${pending} 个周次…`:'')+(searchFailures.size?` · 第 ${[...searchFailures.keys()].join('、')} 周读取失败，请关闭后重试`:'');
 $('searchResults').innerHTML=`<table class="search-table"><thead><tr><th>实验项目</th><th>周次</th><th>日期</th><th>实验时间</th><th>余量</th><th></th></tr></thead><tbody>${searchResults.map((item,index)=>{const reason=conflict(item),category=getCategory(item.name),unavailable=courseUnavailable(item,'available',reason);return `<tr class="search-result category-${category} ${unavailable?'unavailable':''}"><td><b>${esc(item.name)}</b><span class="search-category">${CATEGORY_NAMES[category]}</span><span class="course-meta" title="${esc(item.metadataWarning||'')}">教师：${esc(item.teacher||'未获取')} · 教室：${esc(item.room||'未获取／待确认')}</span>${reason?`<span class="reason">${esc(reason)}</span>`:''}</td><td>第 ${esc(item.week)} 周</td><td>${esc(weekDate(item.day,item.week)||'—')}</td><td>${esc(item.time)}</td><td>${esc(item.remaining)} 人</td><td><button class="btn" data-search-index="${index}" ${unavailable||busy||uncertain?'disabled':''}>选课</button></td></tr>`;}).join('')||`<tr><td class="search-empty" colspan="6">${pending>0?'正在读取场次…':searchFailures.size?'已读取周次中暂无匹配场次':'没有匹配且有余量的场次'}</td></tr>`}</tbody></table>`;
}
async function openCourseSearch(){
 if(busy||$('searchDialog').open)return;
 if(!overview){notice('请先登录学校账号。',true);return;}
 const generation=++searchGeneration,version=weeksCache.version;
 searchWeeks=[...(overview.allowedWeeks||overview.weeks)];searchFailures=new Map();
 $('searchQuery').value='';$('searchDialog').showModal();$('searchQuery').focus();renderCourseSearch();
 await Promise.all(searchWeeks.map(async week=>{try{await weeksCache.get(week);}catch(error){if(generation===searchGeneration){searchFailures.set(week,error);if(error.status===401){searchGeneration++;searchResults=[];$('searchResults').innerHTML='';$('searchStatus').textContent='登录已失效，请关闭搜索后重新登录。';$('searchStatus').classList.add('error');}}}finally{if(generation===searchGeneration&&version===weeksCache.version&&$('searchDialog').open)renderCourseSearch();}}));
}
$('closeSearch').addEventListener('click',()=>{searchGeneration++;$('searchDialog').close();});
$('searchDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else searchGeneration++;});
$('searchQuery').addEventListener('input',renderCourseSearch);
$('searchResults').addEventListener('click',event=>{const button=event.target.closest('[data-search-index]');if(button&&!button.disabled){const item=searchResults[Number(button.dataset.searchIndex)];if(item)prepare('add',null,item);}});

$('calendar').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled){if(b.dataset.action==='review')openEnrolledReview(Number(b.dataset.index));else if(b.dataset.action==='review-card')openCourseReview(b.dataset.kind==='available'?weekData?.slots[Number(b.dataset.index)]:overview?.enrolled?.[Number(b.dataset.index)]);else prepare(b.dataset.action,Number(b.dataset.index));}});document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(!busy){view=b.dataset.view;$('search').value='';render();}}));$('search').addEventListener('input',()=>{if(view!=='choose')render();});
$('openSearch').addEventListener('click',openCourseSearch);
$('openLoginSettings').addEventListener('click',()=>{$('loginSettingsDialog').showModal();void loadSchoolAccountSettings();});
$('closeLoginSettings').addEventListener('click',()=>$('loginSettingsDialog').close());
$('closeReview').onclick=()=>$('reviewDialog').close();
let firstEntryPending=false;
$('loginSettingsDialog').addEventListener('close',async()=>{if(!firstEntryPending||clearingSessions||$('schoolCredentialsDialog').open||$('loginDialog').open)return;firstEntryPending=false;await window.schoolAccounts?.action({action:'complete-entry'});if(!overview)await openCourseLogin(true);if(overview)finishEntry();});
$('loginSettingsDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('connectAcademic').addEventListener('click',()=>syncAcademic(true));
for(const id of ['hideConflicts','hideAcademicConflicts'])$(id).addEventListener('change',()=>{render();renderCourseSearch();});$('week').addEventListener('change',switchWeek);
for(const [id,delta]of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{const weeks=overview.weeks,idx=weeks.indexOf(Number($('week').value));if(weeks[idx+delta]){$('week').value=weeks[idx+delta];switchWeek();}});
$('refresh').addEventListener('click',()=>run('正在刷新官网课表与学时…',async()=>{weeksCache.clear();if(!academicPending){academicStarted='';academicEntry=crypto.randomUUID();}applyOverview(await api('overview'));uncertain=false;await loadWeek();}));$('closeConfirm').addEventListener('click',()=>{ticket=null;$('confirmDialog').close();});$('confirmDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else ticket=null;});$('submitCourse').addEventListener('click',()=>run('正在提交官网，请勿重复操作…',async()=>{if(!ticket)throw Error('请关闭后重新选择场次');const current=ticket;ticket=null;try{const result=await api('commit',{ticket:current});weeksCache.clear();window.LiveGuide?.invalidate();applyOverview(result.overview);$('confirmDialog').close();await loadWeek();notice(result.message+'，已从官网重新核对课表。');}catch(e){uncertain=true;try{weeksCache.clear();applyOverview(await api('overview'));await loadWeek();uncertain=false;e.message+=';已重新读取官网课表，请核对结果后再操作';$('confirmDialog').close();}catch{}throw e;}}));
function showEntryLoading(message){entryLoading=true;$('entryLoading').hidden=false;$('entryLoadingMessage').textContent=message;$('retryEntry').hidden=true;$('skipEntry').hidden=true;}
window.courseWindow?.onResume?.(()=>{if(overview&&!busy&&!entryLoading)$('refresh').click();});
async function submitCourseLogin(silent=false){
 if(!overview)showEntryLoading('正在登录并读取当前周实验信息…');
 const task=async()=>{try{$('loginError').textContent='';const password=$('password').value;$('password').value='';weeksCache.clear();applyOverview(await api('login',{account:$('account').value,password}));$('loginDialog').close();await loadWeek(true);finishEntry();}catch(error){finishEntry();$('loginError').textContent=error.message;throw error;}};
 if(silent){try{await task();}catch{notice('自动登录未完成，请在「登录设置」中检查账号并手动登录。',true);}}
 else await run('正在登录并读取官网学时与课表…',task);
}
async function openCourseLogin(automatic=false){
 if(autoLoggingIn||clearingSessions)return;
 if(automatic){
  autoLoggingIn=true;
  try{const result=await window.courseLogin?.fillSaved({silent:true});if(result?.filled)await submitCourseLogin(true);else notice('选课系统未自动登录，可在「登录设置」中登录或检查已保存账号。');}
  catch{notice('自动登录未完成，可在「登录设置」中手动登录。',true);}
  finally{autoLoggingIn=false;$('password').value='';}
  return;
 }
 $('loginSettingsDialog').close();$('loginDialog').showModal();$('loginFillStatus').textContent='';
 try{const result=await window.courseLogin?.fillSaved();if($('loginDialog').open)$('loginFillStatus').textContent=result?.message||'';}
 catch{if($('loginDialog').open)$('loginFillStatus').textContent='自动填充未完成，可手动填写。';}
}
$('accountButton').addEventListener('click',()=>{if(overview){run('正在清除本地登录会话…',async()=>{await api('logout');sessionStorage.setItem('skipCourseAutoLogin','1');weeksCache.clear();overview=null;weekData=null;ticket=null;resetAcademic();location.reload();});}else { void openCourseLogin(); }});$('closeLogin').addEventListener('click',()=>{$('password').value='';$('loginDialog').close();});$('loginDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else $('password').value='';});$('loginForm').addEventListener('submit',e=>{e.preventDefault();if(!autoLoggingIn)void submitCourseLogin(false);});
let reportRevision=0,reportOpening=false,pendingDismiss=null,dismissNextReport=false;const dismissedReports=new Set();
let reportState=null,reportTimer=null,reportReading=false,reportActing=false,reportTitle='提交实验报告',reportOperationError='',reportRowsSignature='',reportActionsSignature='';
(async()=>{render();setBusy(true,'正在连接本地服务…');let autoLogin=false;try{
 const response=await fetch('/api/session');if(!response.ok)throw Error('本地会话读取失败');const session=await response.json();csrf=session.csrf;
 const entry=await window.schoolAccounts?.action({action:'entry-status'});if(entry?.acknowledged!==true){firstEntryPending=true;finishEntry();$('loginSettingsDialog').showModal();void loadSchoolAccountSettings();return;}
 if(session.authenticated){applyOverview(await api('overview'));await loadWeek(true);}else autoLogin=true;
 }catch(e){notice('本地服务未就绪或学校会话已失效，请刷新重试。',true);}finally{setBusy(false);}
 if(autoLogin){$('entryLoadingMessage').textContent='正在登录并读取实验课表…';const skip=sessionStorage.getItem('skipCourseAutoLogin');sessionStorage.removeItem('skipCourseAutoLogin');if(!skip)await openCourseLogin(true);}
 if(overview)finishEntry();else{$('entryLoadingMessage').textContent='暂未连接实验系统，可重试或进入登录设置。';$('retryEntry').hidden=false;$('skipEntry').hidden=false;}
})();


function syncReportSurface(){
 if(view!=='report'){clearTimeout(reportTimer);reportTimer=null;if($('reportDialog').open)$('reportDialog').close();return;}
 if(!reportTimer&&!reportReading)void loadReports();
}
async function loadReports(){
 if(reportReading||!window.courseReport)return;reportReading=true;clearTimeout(reportTimer);reportTimer=null;
 const revision=reportRevision;
 try{const next=await window.courseReport.action({action:'state'});if(revision===reportRevision){
  if(dismissNextReport&&next.dialog){dismissNextReport=false;dismissedReports.add(next.dialog.id);await window.courseReport.action({action:'dismiss',dialogId:next.dialog.id});}
  reportState=next;renderReports();}}
 catch{$('reportError').textContent='报告系统连接失败，请刷新重试';}
 finally{reportReading=false;if(view==='report'){const phase=reportState?.phase,delay=['idle','connecting','loading','needs_login','logging_in','reading'].includes(phase)?250:reportState?.imagesPending?400:1500;reportTimer=setTimeout(()=>{reportTimer=null;void loadReports();},delay);}}
}
function reportGradeMarkup(row){
 if(typeof row.score==='number'&&Number.isFinite(row.score)&&row.score>=0&&row.score<=100)return `<b class="report-score" title="官网成绩">${esc(row.score)}</b>`;
 if(row.gradeText)return `<b class="report-status">${esc(row.gradeText)}</b>`;
 return row.gradeImage?.startsWith('data:image/png;base64,')?`<img class="report-grade-original" src="${esc(row.gradeImage)}" alt="官网返回的成绩或提交状态" title="官网原图，未能可靠识别">`:'<b class="report-status">状态待更新</b>';
}
function updateReportRows(html){
 const container=$('reportRows'),template=document.createElement('template');template.innerHTML=html;
 const incoming=[...template.content.children];
 if(!incoming.length||incoming.some(node=>!node.matches('.report-card[data-report-row-key]'))){container.replaceChildren(template.content);return;}
 const existing=new Map([...container.children].filter(node=>node.matches('.report-card[data-report-row-key]')).map(node=>[node.dataset.reportRowKey,node]));
 for(const [index,fresh]of incoming.entries()){
  let node=existing.get(fresh.dataset.reportRowKey);
  if(node){existing.delete(fresh.dataset.reportRowKey);for(const selector of ['.report-week','.report-info','.report-grade','.report-actions']){const old=node.querySelector(selector),next=fresh.querySelector(selector);if(old&&next&&old.innerHTML!==next.innerHTML)old.replaceChildren(...next.childNodes);}}
  else node=fresh;
  if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);
 }
 const keys=new Set(incoming.map(node=>node.dataset.reportRowKey));for(const node of [...container.children])if(!keys.has(node.dataset.reportRowKey))node.remove();
}
function renderReports(){
 const s=reportState||{},rows=s.rows||[],labels={manual_login:'自动填充已关闭，请在登录设置中点击立即登录',idle:'准备连接报告系统',connecting:'正在连接报告系统…',loading:'正在加载报告列表…',needs_credentials:'请在登录设置中保存报告系统账号',needs_login:'正在自动登录报告系统…',logging_in:'正在自动登录报告系统…',login_failed:'自动登录失败，请检查账号密码',reading:'正在读取报告列表…',ready:'报告列表已同步',error:s.message||'报告系统连接失败'};
 $('reportLoginStatus').textContent=labels[s.phase]||s.message||'报告系统尚未连接';
 $('reportSummary').textContent=s.phase==='ready'?`${rows.length} 项实验 · 选择对应实验提交 Word 报告`:labels[s.phase]||s.message||'正在读取报告列表…';
 $('reportError').textContent=reportOperationError||(s.ok===false?s.message||'报告数据读取失败':'');
 const reportRowsHTML=rows.map(row=>`<article class="report-card" data-report-row-key="${esc(row.key)}"><div class="report-week"><strong>${esc(row.week)}</strong><span>教学周</span></div><div class="report-info"><h3>${esc(row.name)}</h3><p>${esc(row.time)}</p></div><div class="report-grade"><span>成绩 / 提交状态</span>${reportGradeMarkup(row)}</div><div class="report-actions"><button class="btn" data-report-key="${esc(row.key)}" data-report-action="preview" ${reportActing||s.uploadPending||row.canPreview===false?'disabled':''}>查看报告</button><button class="btn primary ${row.graded?'cannot-upload':''}" data-report-key="${esc(row.key)}" data-report-action="upload" ${reportActing||s.uploadPending||row.canUpload===false||row.gradeChecking?'disabled':''}>${row.graded?'无法上传':row.gradeChecking?'正在核对':'上传报告'}</button></div></article>`).join('')||(s.phase==='ready'?'<div class="schedule-empty">本页暂无实验报告</div>':`<div class="report-loading"><span class="spinner"></span><p>${esc(labels[s.phase]||s.message||'正在加载…')}</p>${['needs_credentials','login_failed'].includes(s.phase)?'<button class="btn" id="configureReportLogin">设置账号</button>':''}</div>`);
 const sameRows=rows.length===($('reportRows').querySelectorAll('.report-card').length)&&rows.every((row,index)=>$('reportRows').children[index]?.dataset.reportRowKey===row.key);
 const displayHTML=s.imagesPending&&rows.length?(sameRows?null:'<div class="report-loading"><span class="spinner"></span><p>正在整理成绩与提交状态…</p></div>'):reportRowsHTML;
 if(displayHTML!==null&&reportRowsSignature!==displayHTML){reportRowsSignature=displayHTML;updateReportRows(displayHTML);}
 $('reportPagination').hidden=!(s.pages>1);$('reportPage').textContent=`第 ${s.page||1} / ${s.pages||1} 页`;$('reportPrevious').disabled=(s.page||1)<=1;$('reportNext').disabled=(s.page||1)>=(s.pages||1);
 renderReportDialog();
}
function renderReportDialog(){
 const d=reportOpening?{type:'opening',id:'opening',message:'正在打开学校操作窗口…'}:reportState?.dialog,node=$('reportDialog');if(!d||dismissedReports.has(d.id)||view!=='report'){if(node.open)node.close();return;}
 $('reportDialogTitle').textContent=['upload','opening'].includes(d.type)?reportTitle:'学校系统提示';$('reportDialogMessage').textContent=reportState.uploadPending?'正在上传，等待学校系统返回结果…':d.message||'';$('reportFileArea').hidden=d.type!=='upload';$('reportChosenFile').textContent=reportState.selectedFile||'尚未选择文件';
 const mapping={OK:['ok','确定'],'确定':['ok','确定'],Yes:['yes','是'],'是':['yes','是'],No:['no','否'],'否':['no','否'],Cancel:['cancel','取消'],'取消':['cancel','取消']};
 const buttons=d.type==='opening'?[]:d.type==='upload'?[['cancel','取消'],['submit','上传报告']]:(d.buttons||[]).map(b=>mapping[b]).filter(Boolean);
 $('chooseReportFile').disabled=reportActing||!!reportState.uploadPending;
 const reportButtonsHTML=buttons.map(([key,label])=>`<button class="btn ${['submit','ok','yes'].includes(key)?'primary':''}" data-report-button="${key}" ${reportActing||reportState.uploadPending||key==='submit'&&!reportState.selectedFile?'disabled':''}>${label}</button>`).join('');
 if(reportActionsSignature!==reportButtonsHTML){reportActionsSignature=reportButtonsHTML;$('reportDialogActions').innerHTML=reportButtonsHTML;}
 if(!node.open&&!document.querySelector('dialog[open]'))node.showModal();
}
async function reportOperation(action,payload={}){
 if(reportActing)return;reportRevision++;reportActing=true;reportOperationError='';
 if(action==='row'&&payload.rowAction==='upload'){dismissNextReport=false;reportOpening=true;reportState={...reportState,dialog:null};renderReportDialog();}$('reportDialogError').textContent='';
 try{const r=await window.courseReport.action({...payload,action});if(!r.ok){reportOperationError=r.error||r.message||'报告操作未完成';$('reportError').textContent=r.error||r.message||'报告操作未完成';$('reportDialogError').textContent=r.error||r.message||'报告操作未完成';}}
 finally{reportActing=false;reportOpening=false;if(pendingDismiss){let id=pendingDismiss;pendingDismiss=null;if(id==='opening'){const latest=await window.courseReport.action({action:'state'});id=latest.dialog?.id;}if(id){dismissNextReport=false;dismissedReports.add(id);await window.courseReport.action({action:'dismiss',dialogId:id});}}await loadReports();}
}
$('refreshReports').addEventListener('click',()=>void reportOperation('refresh'));
$('reportRows').addEventListener('click',event=>{const b=event.target.closest('[data-report-key]');if(b){const row=reportState.rows.find(r=>r.key===b.dataset.reportKey);reportTitle=row?.name||'提交实验报告';void reportOperation('row',{key:b.dataset.reportKey,rowAction:b.dataset.reportAction});}else if(event.target.closest('#configureReportLogin')){void openSharedCredentials('report');}});
$('chooseReportFile').addEventListener('click',()=>void reportOperation('choose-file'));
$('reportDialogActions').addEventListener('click',event=>{const b=event.target.closest('[data-report-button]');if(b)void reportOperation('button',{key:b.dataset.reportButton,dialogId:reportState?.dialog?.id});});
function closeReportDialog(){
 const id=reportState?.dialog?.id;reportRevision++;reportOpening=false;
 if(id)dismissedReports.add(id);$('reportDialog').close();
 if(reportActing){pendingDismiss=id||'opening';if(!id)dismissNextReport=true;return;}
 if(id)void reportOperation('dismiss',{dialogId:id});
}
$('closeReportDialog').addEventListener('click',closeReportDialog);$('reportDialog').addEventListener('cancel',event=>{event.preventDefault();closeReportDialog();});
$('reportPrevious').addEventListener('click',()=>void reportOperation('page',{direction:-1}));$('reportNext').addEventListener('click',()=>void reportOperation('page',{direction:1}));
window.courseReport?.onSelect(()=>{view='report';render();});



function clearSharedAccountFields(){$('schoolCredentialAccount').value='';$('schoolCredentialPassword').value='';}
async function loadSchoolAccountSettings(){
 const r=await window.schoolAccounts?.action({action:'status',systemId:$('schoolAccountSystem').value});
 if(!r)return;$('schoolAutoFillEnabled').checked=r.autoFillEnabled!==false;
 $('schoolCredentialState').textContent=r.corrupt?'保存的配置无法读取，请重新保存或删除':!r.available?'系统加密不可用':r.configured?'已加密保存一组账号密码 · 内容不回显':'尚未保存账号密码';
 $('saveSchoolCredentials').disabled=!r.ok||!r.available;$('deleteSchoolCredentials').disabled=!(r.configured||r.corrupt);
 $('schoolAutofillNow').textContent=view==='report'?'立即登录':'立即登录';
}
async function openSharedCredentials(systemId=view==='report'?'report':'course'){
 $('loginSettingsDialog').close();$('schoolAccountSystem').value=systemId;clearSharedAccountFields();$('schoolCredentialMessage').textContent='';await loadSchoolAccountSettings();$('schoolCredentialsDialog').showModal();
}
function closeSharedCredentials(){clearSharedAccountFields();$('schoolCredentialsDialog').close();$('loginSettingsDialog').showModal();void loadSchoolAccountSettings();}
$('manageSchoolCredentials').addEventListener('click',()=>void openSharedCredentials());
$('closeSchoolCredentials').addEventListener('click',closeSharedCredentials);$('schoolCredentialsDialog').addEventListener('cancel',event=>{event.preventDefault();closeSharedCredentials();});
$('schoolAccountSystem').addEventListener('change',()=>{clearSharedAccountFields();$('schoolCredentialMessage').textContent='';void loadSchoolAccountSettings();});
$('schoolCredentialForm').addEventListener('submit',async event=>{event.preventDefault();$('saveSchoolCredentials').disabled=true;try{const r=await window.schoolAccounts.action({action:'save',systemId:$('schoolAccountSystem').value,username:$('schoolCredentialAccount').value,password:$('schoolCredentialPassword').value});$('schoolCredentialMessage').textContent=r.message||r.error||'';if(r.ok)clearSharedAccountFields();}finally{$('schoolCredentialPassword').value='';await loadSchoolAccountSettings();}});
$('deleteSchoolCredentials').addEventListener('click',async()=>{const r=await window.schoolAccounts.action({action:'delete',systemId:$('schoolAccountSystem').value});$('schoolCredentialMessage').textContent=r.message||r.error||'';clearSharedAccountFields();await loadSchoolAccountSettings();});
$('schoolAutoFillEnabled').addEventListener('change',async()=>{const r=await window.schoolAccounts.action({action:'set-auto-fill',enabled:$('schoolAutoFillEnabled').checked});$('schoolSettingsMessage').textContent=r.error||($('schoolAutoFillEnabled').checked?'已开启自动填充':'已关闭自动填充');await loadSchoolAccountSettings();});
$('schoolAutofillNow').addEventListener('click',async()=>{if(view==='report'){$('loginSettingsDialog').close();await reportOperation('login');}else{await openCourseLogin();}});
$('clearSchoolLogin').addEventListener('click',async()=>{
 if(busy||clearingSessions)return;clearingSessions=true;clearTimeout(reportTimer);reportTimer=null;
 await run('正在清除学校系统登录状态…',async()=>{
  const result=await window.schoolAccounts?.action({action:'clear-sessions'});if(!result?.ok)throw Error(result?.error||'清除未完成');
  await api('clear-sessions');weeksCache.clear();metadataCache.clear();liveDataRevision++;overview=null;weekData=null;ticket=null;uncertain=false;resetAcademic();reportState=null;reportRevision++;view='choose';window.LiveGuide?.invalidate();firstEntryPending=true;finishEntry();$('schoolSettingsMessage').textContent='已清除所有系统登录状态，保存的账号密码已保留';render();if(!$('loginSettingsDialog').open)$('loginSettingsDialog').showModal();
 });clearingSessions=false;
});
