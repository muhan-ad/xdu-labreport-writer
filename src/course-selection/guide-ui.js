(() => {
'use strict';
const mount=document.getElementById('guideMount'),shadow=mount.attachShadow({mode:'open'});
shadow.innerHTML=`<link rel="stylesheet" href="/guide-ui.css"><link rel="stylesheet" href="/shared/input-fields.css"><div class="guide-root"><main><div class="topline"><span>一站通 <b>／</b> 学习指南</span></div><header><div><div id="kicker"></div><h1 id="title"></h1></div><div id="count" class="total"></div></header><div id="availabilityToolbar"></div><div id="filters" class="filters"></div><section id="content"></section></main><dialog id="sessionDialog" class="session-dialog" aria-labelledby="sessionTitle"></dialog><dialog id="conflictDialog" class="conflict-dialog" aria-labelledby="conflictTitle"></dialog></div>`;
const shell=shadow.querySelector('.guide-root'),data=window.guideContent,el=id=>shadow.getElementById(id),escape=esc;
let view='recommend',category='recommended',faq='course';
let typingSoundEnabled=true;try{typingSoundEnabled=localStorage.getItem('guide-typing-sound')!=='off'}catch{}
let typingAudio,keyboardBuffer,keyboardConfig,keyboardLoading,lastKeySound=-Infinity,lastKey=-1,typingReady=Promise.resolve(false),audioState='idle',audioPlayed=0,audioError='';const activeSounds=new Set();
function stopTypingSounds(){for(const source of activeSounds){try{source.stop()}catch{}}activeSounds.clear()}
function updateSoundControl(){const button=el('filters').querySelector('[data-sound]');if(button){button.textContent=typingSoundEnabled?(audioState==='failed'?'音效：重试':'音效：开'):'音效：关';button.title=audioState==='failed'?audioError+'，点击重试':'';button.setAttribute('aria-label',button.textContent+(audioError?'：'+audioError:''))}}
function loadKeyboardRecording(){
 if(keyboardBuffer&&keyboardConfig)return Promise.resolve();if(keyboardLoading)return keyboardLoading;
 keyboardLoading=Promise.all([fetch('/audio/keyboard.ogg').then(r=>{if(!r.ok)throw Error('键盘录音读取失败（'+r.status+'）');return r.arrayBuffer()}).then(b=>typingAudio.decodeAudioData(b)),fetch('/audio/config.json').then(r=>{if(!r.ok)throw Error('音效配置读取失败（'+r.status+'）');return r.json()})]).then(([buffer,config])=>{keyboardBuffer=buffer;keyboardConfig=config}).catch(error=>{keyboardLoading=null;throw error});return keyboardLoading;
}
function prepareTypingAudio(){
 if(!typingSoundEnabled)return typingReady=Promise.resolve(false);
 try{if(!typingAudio||typingAudio.state==='closed')typingAudio=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
  audioState='loading';typingReady=Promise.all([typingAudio.state==='running'?Promise.resolve():typingAudio.resume(),loadKeyboardRecording()]).then(()=>{if(typingAudio.state!=='running')throw Error('suspended');audioState='ready';audioError='';updateSoundControl();return true}).catch(error=>{audioState='failed';audioError=error.message||'音效加载失败';updateSoundControl();return false});
 }catch(error){audioState='failed';audioError=error.message||'音频设备初始化失败';updateSoundControl();typingReady=Promise.resolve(false)}return typingReady;
}
function playTypingKey(){
 if(!typingSoundEnabled||document.hidden||!keyboardBuffer||!typingAudio||typingAudio.state!=='running')return;
 const now=typingAudio.currentTime;if(now-lastKeySound<.065+Math.random()*.035)return;lastKeySound=now;
 const keys=[16,17,18,19,20,21,22,23,24,25,30,31,32,33,34,35,36,37,38,44,45,46,48,49,50];
 let key;do{key=keys[Math.floor(Math.random()*keys.length)]}while(key===lastKey);lastKey=key;
 const [offset,duration]=keyboardConfig.defines[String(key)];
 const source=typingAudio.createBufferSource(),gain=typingAudio.createGain();source.buffer=keyboardBuffer;source.playbackRate.value=.98+Math.random()*.04;
 const length=duration/1000;gain.gain.setValueAtTime(.42+Math.random()*.08,now);gain.gain.setTargetAtTime(.0001,now+length-.018,.006);
 source.connect(gain);gain.connect(typingAudio.destination);activeSounds.add(source);source.onended=()=>{activeSounds.delete(source);source.disconnect();gain.disconnect()};source.start(now,offset/1000,length);audioPlayed++;
}
const nameMatches=window.GuideReviews.nameMatches;
let excludeAcademicConflicts=true;try{excludeAcademicConflicts=localStorage.getItem('guide-exclude-conflicts')!=='off'}catch{}
let scan={version:-1,account:'',started:0,completed:0,total:0,running:false,errors:[],timer:0},dialogExperiment='',dialogTeacher='',dialogSlots=[];
function scanValid(version,account){return overview&&weeksCache.version===version&&String(overview.identity?.account||'')===account}
function refreshGuideSoon(){clearTimeout(scan.timer);scan.timer=setTimeout(()=>{if(['recommend','teacher'].includes(view)){updateAvailability();if(sessionDialog.open)renderSessions()}},80)}
async function ensureAvailability(){
 if(!overview)return;
 const version=weeksCache.version,account=String(overview.identity?.account||'');
 if(scan.version===version&&scan.account===account&&(scan.running||Date.now()-scan.started<60000))return;
 const current={version,account,started:Date.now(),completed:0,total:0,running:true,errors:[],timer:0};scan=current;
 const weeks=[...new Set((overview.allowedWeeks||overview.weeks||[]).map(Number))].filter(w=>w>=overview.currentWeek).sort((a,b)=>a-b);current.total=weeks.length;
 for(const week of weeks){
  if(scan!==current||!scanValid(version,account))break;
  try{const cached=weeksCache.peek(week);if(cached&&Date.now()-(cached.guideReadAt||Date.parse(cached.fetchedAt)||0)>=60000)weeksCache.values.delete(week);const snapshot=await weeksCache.get(week,true);snapshot.guideReadAt=Date.now();}
  catch(error){if(scan!==current||!scanValid(version,account))break;current.errors.push(week);if(error.status===401)break;}
  current.completed++;refreshGuideSoon();
 }
 if(scan===current&&scanValid(version,account)){
  // Metadata tasks queued by WeekCache run through the same foreground-aware queue.
  await requests.request(async()=>{},true);
  if(scan===current&&scanValid(version,account)){current.running=false;refreshGuideSoon()}
 }
}
let liveMemo=null,summaryMemo=new Map(),structureKey='';const cardViews=new Map();
function allLiveSessions(){
 if(!overview)return [];
 const stamp=weeksCache.version+':'+liveDataRevision;if(liveMemo&&liveMemo.stamp===stamp&&liveMemo.overview===overview&&liveMemo.snapshot===academicState.snapshot&&Date.now()-liveMemo.at<1000)return liveMemo.rows;
 const rows=[],seen=new Set();
 for(const week of overview.allowedWeeks||overview.weeks||[]){if(week<overview.currentWeek)continue;const snapshot=weeksCache.peek(week);if(!snapshot)continue;
  for(const raw of snapshot.slots||[]){if(raw.week!==Number(week)||!Number.isFinite(raw.remaining)||raw.remaining<=0)continue;const id=JSON.stringify([raw.name,raw.week,raw.time]);if(seen.has(id))continue;seen.add(id);
   const time=experimentInterval(raw,overview.enrolled||[],overview.calendarAnchor);if(!time||new Date(time.date+'T'+time.start+':00').getTime()<=Date.now())continue;
   if(labConflict(raw,overview.enrolled||[]))continue;
   if((overview.enrolled||[]).filter(x=>x.week===raw.week).reduce((n,x)=>n+x.hours,0)+raw.hours>overview.rules.weeklyHourLimit)continue;
   const resolved=metadataFor(raw),teachers=String(resolved.teacher||'').split(/[／、,，]/).map(s=>s.trim()).filter(Boolean);
   rows.push({...resolved,id,date:time.date,start:time.start,end:time.end,seats:raw.remaining,teachers,academicConflict:personalConflict(academicState.snapshot,raw,overview.enrolled||[],overview.calendarAnchor)});
  }
 }rows.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.name.localeCompare(b.name,'zh'));
 const byExperiment=new Map(),byTeacher=new Map();for(const row of rows){const name=window.GuideReviews.recommendation(row.name)?.name||row.name;if(!byExperiment.has(name))byExperiment.set(name,[]);byExperiment.get(name).push(row);if(row.teachers.length===1){const teacher=row.teachers[0];if(!byTeacher.has(teacher))byTeacher.set(teacher,[]);byTeacher.get(teacher).push(row)}}
 liveMemo={stamp,overview,snapshot:academicState.snapshot,at:Date.now(),rows,byExperiment,byTeacher};return rows;
}
function metadataUnknown(item){const entry=metadataCache.get(item.name);return !entry||entry.version!==weeksCache.version||!entry.data||!item.teachers.length}
function matchingSessions(experiment='',teacher=''){
 allLiveSessions();const pool=experiment?(liveMemo?.byExperiment.get(window.GuideReviews.recommendation(experiment)?.name||experiment)||[]):teacher?(liveMemo?.byTeacher.get(teacher)||[]):(liveMemo?.rows||[]);return pool.filter(s=>(!experiment||nameMatches(experiment,s.name))&&(!teacher||(s.teachers.length===1&&s.teachers[0]===teacher&&(experiment||data.teachers.find(t=>t.name===teacher)?.groups.some(g=>g.experiments.some(n=>nameMatches(n,s.name)))))));
}
function availableSessions(experiment='',teacher=''){return matchingSessions(experiment,teacher).filter(s=>!excludeAcademicConflicts||!s.academicConflict)}
function seatSummary(experiment='',teacher=''){
 const key=JSON.stringify([experiment,teacher]);if(summaryMemo.has(key))return summaryMemo.get(key);
 const sessions=availableSessions(experiment,teacher),all=allLiveSessions();
 const teacherNames=data.teachers.find(t=>t.name===teacher)?.groups.flatMap(g=>g.experiments)||[];
 const ambiguous=teacher&&all.some(s=>(experiment?nameMatches(experiment,s.name):teacherNames.some(n=>nameMatches(n,s.name)))&&((s.teachers.length>1&&s.teachers.includes(teacher))||metadataUnknown(s)));
 const invalidTime=!!overview&&(overview.allowedWeeks||overview.weeks||[]).filter(w=>w>=overview.currentWeek).some(w=>(weeksCache.peek(w)?.slots||[]).some(s=>(!experiment||nameMatches(experiment,s.name))&&s.remaining>0&&!experimentInterval(s,overview.enrolled||[],overview.calendarAnchor)));
 let state=!overview?'未登录':scan.errors.length?'未完整获取':ambiguous?'待核实':scan.running?'统计中':invalidTime?'日期待核实':'';
 const result={seats:['未登录','待核实','日期待核实'].includes(state)?null:sessions.reduce((n,s)=>n+s.seats,0),sessions:sessions.length,state};summaryMemo.set(key,result);return result;
}
function seatAction(experiment='',teacher='',compact=false){const s=seatSummary(experiment,teacher),ready=s.seats!==null;return `<div class="${compact?'teacher-total':'seat-action'} ${ready&&s.seats?'has-seats':'no-seats'}"><span class="seat-stat">余<strong>${ready?s.seats:'—'}</strong>人</span><small class="seat-session-count">${s.state?(s.seats===null?s.state:'已获取'+s.seats+'人 · '+s.state):s.sessions+'个可选场次'}</small><button class="seat-go" data-seats-experiment="${escape(experiment)}" data-seats-teacher="${escape(teacher)}" ${!overview||busy||uncertain||!s.sessions?'disabled':''}>${s.state?'查看场次':s.seats?'选课 ↗':'暂无场次'}</button></div>`}
function teacherExperiment(experiment,teacher){const s=seatSummary(experiment,teacher);return `<button class="experiment-link" data-seats-experiment="${escape(experiment)}" data-seats-teacher="${escape(teacher)}" ${!overview||busy||uncertain||!s.sessions?'disabled':''}>${escape(experiment)}<b class="seat-badge">${s.seats===null?s.state:'余'+s.seats+'人'}</b></button>`}
const availabilityToolbar=el('availabilityToolbar');let toolbarKey='';
function renderAvailabilityToolbar(){availabilityToolbar.hidden=view==='faq';const key=excludeAcademicConflicts+':'+!!academicState.snapshot;if(key===toolbarKey){if(overview&&view!=='faq')void ensureAvailability();return}toolbarKey=key;availabilityToolbar.innerHTML=`<label class="conflict-switch"><span>排除教务课表冲突${!academicState.snapshot?' · 未校验':''}</span><input id="conflictSwitch" type="checkbox" role="switch" ${excludeAcademicConflicts?'checked':''}><i aria-hidden="true"></i></label>`;if(overview)void ensureAvailability()}
availabilityToolbar.addEventListener('change',e=>{if(e.target.id!=='conflictSwitch')return;excludeAcademicConflicts=e.target.checked;try{localStorage.setItem('guide-exclude-conflicts',excludeAcademicConflicts?'on':'off')}catch{}render();el('conflictSwitch').focus({preventScroll:true})});
const sessionDialog=el('sessionDialog');
function showSessions(experiment,teacher){dialogExperiment=experiment;dialogTeacher=teacher;renderSessions();sessionDialog.showModal()}
function renderSessions(){
 dialogSlots=availableSessions(dialogExperiment,dialogTeacher);const summary=seatSummary(dialogExperiment,dialogTeacher);
 sessionDialog.innerHTML=`<div class="session-head"><div><h2 id="sessionTitle">${escape(dialogExperiment||dialogTeacher)}</h2>${dialogExperiment&&dialogTeacher?'<p>'+escape(dialogTeacher)+'</p>':''}</div><button class="dialog-close" aria-label="关闭">×</button></div><div class="session-summary">${summary.state||dialogSlots.length+'个可选场次'}${!academicState.snapshot?' · 教务冲突未校验':''}</div><div class="session-items">${dialogSlots.map((s,i)=>`<article class="session-item"><div><h3>${escape(s.name)}</h3><p>第${s.week}周 · ${s.date} · ${s.start}—${s.end}</p><p>${escape(s.teacher||'教师待核实')} · ${escape(s.room||'教室待核实')}${s.academicConflict?' <em>与教务课表冲突</em>':''}</p></div><div class="session-right"><span>余<b>${s.seats}</b>人</span><button data-pick-session="${i}" class="${s.academicConflict?'conflict-pick':''}" ${busy||uncertain?'disabled':''}>${s.academicConflict?'时间冲突':'选取此场次'}</button></div></article>`).join('')||'<div class="no-sessions">'+(summary.state||'当前没有符合条件的可选场次')+'</div>'}</div><p class="selection-feedback" role="status"></p>`;
}
el('content').addEventListener('click',e=>{const button=e.target.closest('[data-seats-experiment]');if(button&&!button.disabled)showSessions(button.dataset.seatsExperiment,button.dataset.seatsTeacher)});
sessionDialog.addEventListener('click',e=>{if(e.target.closest('.dialog-close'))sessionDialog.close();const b=e.target.closest('[data-pick-session]');if(b&&!b.disabled){const item=dialogSlots[Number(b.dataset.pickSession)];if(item)void selectLiveSession(item)}});
async function selectLiveSession(item,token=''){
 if(busy||uncertain||!overview)return;
 const payload={...item,action:'add',guide:true,expectedTeacher:dialogTeacher,academicConflictToken:token};
 let failure=null;await run('正在核对官网资格及当前名额…',async()=>{ticket=null;try{
  const result=await api('prepare',payload);ticket=result.ticket;
  $('confirmError').textContent='';$('confirmTitle').textContent='确认选择这项实验';const display=metadataFor(result.item);
  $('confirmBody').innerHTML=`<div class="detail"><b>${escape(display.name)}</b><p>第${display.week}周 · ${escape(display.time)}</p><p>教师 ${escape(display.teacher||'未获取')} · 教室 ${escape(display.room||'待确认')}</p></div><p class="dialog-muted">确认提交选课？</p>`;
  sessionDialog.close();$('confirmDialog').showModal();
 }catch(error){if(error.code==='ACADEMIC_CONFLICT')failure={item,error};else{const feedback=sessionDialog.querySelector('.selection-feedback');if(feedback)feedback.textContent=error.message;throw error}}});
 if(failure)showConflictConfirmation(failure.item,failure.error);
}
const conflictDialog=el('conflictDialog');let pendingConflict=null;
function showConflictConfirmation(item,error){pendingConflict={item,token:error.conflictToken};conflictDialog.innerHTML=`<h2 id="conflictTitle">与教务课程冲突</h2><p>此实验场次与个人教务课表存在时间冲突，是否继续？</p><div class="conflict-session"><strong>${escape(item.name)}</strong><p>第${item.week}周 · ${escape(item.time)}</p><p>${escape(error.error||error.message)}</p></div><div class="conflict-actions"><button data-conflict-cancel autofocus>取消</button><button data-conflict-continue>继续</button></div>`;conflictDialog.showModal()}
conflictDialog.addEventListener('click',e=>{if(e.target.closest('[data-conflict-cancel]')){pendingConflict=null;conflictDialog.close()}if(e.target.closest('[data-conflict-continue]')){const pending=pendingConflict;pendingConflict=null;conflictDialog.close();if(pending)void selectLiveSession(pending.item,pending.token)}});
conflictDialog.addEventListener('cancel',()=>pendingConflict=null);
sessionDialog.addEventListener('close',()=>{pendingConflict=null;if(conflictDialog.open)conflictDialog.close()});

const categories=[['recommended','推荐'],['not_recommended','不推荐'],['mixed','介中']];
const person='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>';
function updateAvailability(){summaryMemo.clear();renderAvailabilityToolbar();for(const node of el('content').querySelectorAll('.seat-action,.teacher-total')){const button=node.querySelector('[data-seats-experiment]');if(button){const template=document.createElement('template');template.innerHTML=seatAction(button.dataset.seatsExperiment,button.dataset.seatsTeacher,node.classList.contains('teacher-total'));const updated=template.content.firstElementChild;node.className=updated.className;node.querySelector('.seat-stat strong').textContent=updated.querySelector('.seat-stat strong').textContent;node.querySelector('.seat-session-count').textContent=updated.querySelector('.seat-session-count').textContent;button.textContent=updated.querySelector('button').textContent;button.disabled=updated.querySelector('button').disabled}}for(const button of el('content').querySelectorAll('.experiment-link')){const s=seatSummary(button.dataset.seatsExperiment,button.dataset.seatsTeacher);button.querySelector('.seat-badge').textContent=s.seats===null?s.state:'余'+s.seats+'人';button.disabled=!overview||busy||uncertain||!s.sessions}}
function render(next=view){
 view=next;summaryMemo.clear();const key=[view,category,faq].join(':');if(key===structureKey){if(view!=='faq')updateAvailability();else updateSoundControl();return}if(structureKey&&!structureKey.startsWith('faq:')){const fragment=document.createDocumentFragment();fragment.append(...el('content').childNodes);cardViews.set(structureKey,fragment)}structureKey=key;
 shell.dataset.view=view;
 renderAvailabilityToolbar();
 const config={recommend:['EXPERIMENT GUIDE','实验推荐','从实验评价开始，找到适合自己的实验。',28,'个实验'],teacher:['TEACHER GUIDE','老师推荐','实验与教师关系来自学校官网，评价由用户整理。',27,'位老师'],faq:['QUESTIONS & ANSWERS','常见问题','从选课到完成实验，你关心的问题整理在这里。',data.faq.reduce((sum,g)=>sum+g.items.length,0),'条问答']}[view];
 el('kicker').textContent=config[0];el('title').textContent=config[1];el('count').innerHTML=config[3]+'<small>'+config[4]+'</small>';
 el('filters').innerHTML=view==='teacher'?categories.map(([id,label])=>`<button data-category="${id}" aria-pressed="${id===category}">${label}<span>${data.teachers.filter(t=>t.category===id).length}</span></button>`).join(''):view==='faq'?data.faq.map(g=>`<button data-faq="${g.id}" aria-pressed="${g.id===faq}">${escape(g.title)}<span>${g.items.length}</span></button>`).join(''):'';
 if(view==='faq')el('filters').insertAdjacentHTML('beforeend',`<button class="sound-toggle" data-sound="toggle" aria-pressed="${typingSoundEnabled}">音效${typingSoundEnabled?'：开':'：关'}</button>`);
 el('content').className=view==='recommend'?'recommendations':view==='teacher'?'teacher-grid':'faq-list';
 if(view!=='faq'&&cardViews.has(key)){el('content').replaceChildren(cardViews.get(key));cardViews.delete(key);updateAvailability();return;}
 if(view==='recommend')el('content').innerHTML=data.recommendations.map((r,i)=>`<article class="card experiment ${r.category}" data-review-experiment="${escape(r.name)}"><div class="card-head"><span class="number">${String(i+1).padStart(2,'0')}</span><div><h2>${escape(r.name)}</h2></div></div><div class="review-block"><p class="review ${r.review==='暂无评价'?'empty':''}">${escape(r.review)}</p></div>${seatAction(r.name)}</article>`).join('');
 if(view==='teacher')el('content').innerHTML=data.teachers.filter(t=>t.category===category).map(t=>`<article class="card teacher ${t.category}" data-review-teacher="${escape(t.name)}"><div class="teacher-person"><h2>${escape(t.name)}</h2></div><div>${t.groups.map(g=>`<div class="teacher-group"><div class="experiments">${g.experiments.map(e=>teacherExperiment(e,t.name)).join('')}</div><p class="review">${escape(g.review)}</p></div>`).join('')}</div>${seatAction('',t.name,true)}</article>`).join('');
 if(view==='faq')el('content').innerHTML=data.faq.find(g=>g.id===faq).items.map((q,i)=>`<details><summary><span class="q">Q</span><span class="question">${escape(q.question)}</span><span class="plus" aria-hidden="true">+</span></summary><div class="answer">${escape(q.answer)}</div></details>`).join('');
}
el('filters').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.sound){typingSoundEnabled=audioState==='failed'?true:!typingSoundEnabled;try{localStorage.setItem('guide-typing-sound',typingSoundEnabled?'on':'off')}catch{}const ready=prepareTypingAudio();b.setAttribute('aria-pressed',String(typingSoundEnabled));updateSoundControl();if(!typingSoundEnabled)stopTypingSounds();if(typingSoundEnabled)void ready.then(ok=>{if(ok)playTypingKey()});return}if(b.dataset.category)category=b.dataset.category;if(b.dataset.faq)faq=b.dataset.faq;render()});

// Replay answers on each expansion; keep the original text outside animation state.
const answerAnimations=new WeakMap();
el('content').addEventListener('toggle',async event=>{
 const details=event.target;
 if(!(details instanceof HTMLDetailsElement))return;
 const answer=details.querySelector('.answer');
 if(!answer)return;
 let state=answerAnimations.get(answer);
 if(!state){state={text:answer.textContent,frame:0};answerAnimations.set(answer,state)}
 cancelAnimationFrame(state.frame);answer.classList.remove('typing');answer.textContent=state.text;
 const generation=(state.generation||0)+1;state.generation=generation;
 if(!details.open){stopTypingSounds();return;}
 await typingReady;
 if(state.generation!==generation||!details.open||!answer.isConnected||mount.hidden)return;
  const chars=Array.from(state.text),duration=Math.min(2800,Math.max(350,chars.length*24));
 let started,lastCount=0;
 answer.textContent='';answer.classList.add('typing');
 function tick(now){
  if(!details.open||!answer.isConnected||mount.hidden){answer.textContent=state.text;answer.classList.remove('typing');return}
  if(started===undefined)started=now;
  const progress=Math.min(1,(now-started)/duration);
  const count=Math.ceil(progress*chars.length);
  answer.textContent=chars.slice(0,count).join('');
  if(count>lastCount&&chars.slice(lastCount,count).some(c=>!/\s/.test(c)))playTypingKey();lastCount=count;
  if(progress<1)state.frame=requestAnimationFrame(tick);
  else{answer.textContent=state.text;answer.classList.remove('typing');state.frame=0}
 }
 state.frame=requestAnimationFrame(tick);
},true);

// Animate the disclosure itself, reserving answer space while text appears.
const disclosureMotions=new WeakMap();
el('content').addEventListener('click',event=>{
 const summary=event.target.closest('summary');if(!summary)return;
 const details=summary.parentElement,answer=details.querySelector('.answer');
 if(!answer)return;event.preventDefault();prepareTypingAudio();
 let motion=disclosureMotions.get(details);
 const opening=motion?!motion.opening:!details.open;if(!opening){stopTypingSounds();const typing=answerAnimations.get(answer);if(typing){cancelAnimationFrame(typing.frame);typing.generation=(typing.generation||0)+1;answer.textContent=typing.text;answer.classList.remove('typing')}}
 const from=details.getBoundingClientRect().height;
 if(motion){motion.animation.cancel();motion.fade?.cancel()}
 if(opening){
  const typing=answerAnimations.get(answer);if(typing){cancelAnimationFrame(typing.frame);answer.textContent=typing.text;answer.classList.remove('typing')}
  details.open=true;answer.style.minHeight='';
  answer.style.minHeight=answer.getBoundingClientRect().height+'px';
 }
 const target=opening?summary.getBoundingClientRect().height+answer.getBoundingClientRect().height:summary.getBoundingClientRect().height;
 details.style.overflow='hidden';
 const animation=details.animate([{height:from+'px'},{height:target+'px'}],{duration:opening?360:260,easing:'cubic-bezier(.22,.8,.25,1)'});
 const fade=answer.animate(opening?[{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'translateY(0)'}]:[{opacity:1},{opacity:0}],{duration:opening?320:180,easing:'ease-out'});
 motion={opening,animation,fade};disclosureMotions.set(details,motion);
 animation.onfinish=()=>{if(disclosureMotions.get(details)!==motion)return;details.open=opening;details.style.overflow='';disclosureMotions.delete(details)};
});


window.LiveGuide={leave(){view='';stopTypingSounds();if(sessionDialog.open)sessionDialog.close();},render(next){if(!['recommend','teacher','faq'].includes(next))return;if(next==='faq'&&next===view&&el('content').classList.contains('faq-list'))return;view=next;render()},changed(){if(['recommend','teacher'].includes(view))refreshGuideSoon()},invalidate(){scan.started=0;liveMemo=null;summaryMemo.clear();refreshGuideSoon()}};
})();
