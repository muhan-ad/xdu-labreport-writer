import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const adb='E:/tools/app-maker/android-sdk/platform-tools/adb.exe',serial='emulator-5560';
const testPackage='com.labmaker.app.acceptance';
const run=(...a)=>execFileSync(adb,['-s',serial,...a],{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const name='冲击法测量直螺线管磁场实验',time='星期四下午15:55-18:10',now=Date.parse('2026-10-23T12:00:00+08:00');
let enrolled=true,mutations=0,view=0,active=0,maxActive=0,slowCommit=false, teacherNames='吴兴林／王小芳',delayWeeks=false,expireWeeks=false;
const state=new Map(),records=[],checks=[];
const hidden=path=>{const token='fresh-'+(++view);state.set(path,token);return `<input type=hidden name=__VIEWSTATE value="${token}">`;};
let selection={week:'7',time:'0',experiment:'0'};
const select=(id,value,options)=>`<select id="${id}" name="ctl$${id}">${options.map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}</select>`;
const addForm=path=>'<form>'+hidden(path)+select('ExpeWeekList',selection.week,[['7','7'],['8','8']])+select('ExpeTimeList',selection.time,[['0','请选择'],['4B',time]])+select('ExpeClassList','1',[['1','电磁学']])+select('ExpeNameList',selection.experiment,[['0','请选择'],['E',name+'（3学时）']])+'<input type=submit id=btnAdd name="ctl$btnAdd" value="选课"></form>';
const server=http.createServer((req,res)=>{
 active++;maxActive=Math.max(maxActive,active);res.on('close',()=>active--);
 let body='';req.on('data',b=>body+=b);req.on('end',()=>{
  try{
   const path=req.url.split('?')[0].toLowerCase(),form=new URLSearchParams(body);
   records.push({path,method:req.method,keys:[...form.keys()]});
   res.setHeader('Content-Type','text/html; charset=utf-8');
   if(path==='/phyews/'&&req.method==='GET'){res.setHeader('Set-Cookie','pre=1; Path=/');res.end(`<form>${hidden(path)}<input name="login1$StuLoginID"><input type=password name="login1$StuPassword"></form>`);return;}
   if(path==='/phyews/'&&req.method==='POST'){
    assert.equal(form.get('__VIEWSTATE'),state.get(path));assert.equal(form.get('login1$StuPassword'),'mock-only-password');
    res.writeHead(302,{'Set-Cookie':['auth=1; Path=/',`PhyEws_StuName=${Buffer.from('模拟同学','utf8').toString('latin1')}; Path=/; HttpOnly`],Location:'/PhyEws/student/student.aspx'});res.end();return;
   }
   assert.ok(req.headers.cookie?.includes('auth=1'));
   assert.ok(Buffer.from(req.headers.cookie,'latin1').toString('utf8').includes('PhyEws_StuName=模拟同学'),'raw UTF-8 school name cookie must survive native transport');
   if(path.endsWith('/student.aspx'))res.end(`模拟同学（2500000000）同学 第6周 2026年10月23日 星期五 必须完成的实验项目总学时数为24 每周可选的实验项目总学时数为9 已选实验项目的总学时数为${enrolled?3:0}`);
   else if(path.endsWith('/select.aspx'))res.end('实验项目<table>'+(enrolled?'<tr>'+['1',name+'（3学时）','7',time,'2026/10/29','F219','','','',''].map(v=>`<td>${v}</td>`).join('')+'</tr>':'')+'</table>');
   else if(path.endsWith('/del.aspx')){
    if(req.method==='POST'){assert.equal(form.get('__VIEWSTATE'),state.get(path));assert.equal(form.get('ctl$choice'),'ROW');assert.equal(form.get('ctl$btnDel'),'取消');mutations++;enrolled=false;res.end('已取消');return;}
    res.end('取消<form>'+hidden(path)+'<table>'+(enrolled?'<tr>'+['1',name+'（3学时）','7',time,'<input type=radio name="ctl$choice" value=ROW>','3'].map(v=>`<td>${v}</td>`).join('')+'</tr>':'')+'</table><input type=submit id=btnDel name="ctl$btnDel" value="取消"></form>');
   }else if(path.endsWith('/addexpe.aspx')){
    if(req.method==='GET'){selection={week:'7',time:'0',experiment:'0'};res.end(addForm(path));return;}
    assert.equal(form.get('__VIEWSTATE'),state.get(path));
    if(form.has('ctl$btnAdd')){
     assert.equal(form.get('ctl$ExpeWeekList'),'7');assert.equal(form.get('ctl$ExpeTimeList'),'4B');assert.equal(form.get('ctl$ExpeNameList'),'E');mutations++;enrolled=true;
     const finish=()=>res.end('已选课');if(slowCommit)setTimeout(finish,500);else finish();return;
    }
    assert.ok(['ctl$ExpeWeekList','ctl$ExpeTimeList','ctl$ExpeNameList','ctl$ExpeClassList'].includes(form.get('__EVENTTARGET')));
    selection={week:form.get('ctl$ExpeWeekList'),time:form.get('ctl$ExpeTimeList'),experiment:form.get('ctl$ExpeNameList')};res.end(addForm(path));
   }else if(path.endsWith('/statsel.aspx')){
    if(expireWeeks){res.writeHead(401);res.end('session expired');return;}
    if(req.method==='GET'){const html=`<form>${hidden(path)}<select id=Header2_ExpeWeekList name="Header2$ExpeWeekList"><option value=7>7</option></select><input type=image id=Header2_btnSubmit name="Header2$btnSubmit"></form>`;if(delayWeeks)setTimeout(()=>res.end(html),250);else res.end(html);}
    else{assert.equal(form.get('__VIEWSTATE'),state.get(path));res.end(`第7周可选<table><tr><td>${name}（3学时）</td><td>${enrolled?'':time+' (2)'}</td></tr></table>`);}
   }else if(path.endsWith('/expeinfo.aspx'))res.end(fs.readFileSync('tests/fixtures/course-room-projects.html'));
   else if(path.endsWith('/course.aspx')){
    if(req.method==='GET')res.end(`<form>${hidden(path)}<select name="plan1$ExpeList"><option value=E>${name}</option></select></form>`);
    else{assert.equal(form.get('__VIEWSTATE'),state.get(path));res.end(`<table><tr><th>上课时间</th><th>教师</th><th>起始周</th><th>结束周</th><th>单双周</th></tr><tr><td>${time}</td><td>${teacherNames}</td><td>1</td><td>16</td><td>每周</td></tr></table>`);}
   }else throw Error('Unexpected route '+path);
  }catch(e){console.error(e);res.writeHead(500);res.end('mock assertion failure');}
 });
});
await new Promise(r=>server.listen(58441,'127.0.0.1',r));
let ws,id=0;const jobs=new Map();
const call=(method,params={})=>{const seq=++id;return new Promise((resolve,reject)=>{jobs.set(seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}));});};
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('WebView evaluation failed');return r.result.value;};
const native=(method,args={})=>evaluate(`Capacitor.nativePromise('LabPortal',${JSON.stringify(method)},${JSON.stringify(args)}).then(value=>({ok:true,value}),e=>({ok:false,code:e.code,message:e.message}))`);
async function wait(expression){for(let n=0;n<200;n++){if(await evaluate(expression))return;await pause(100);}throw Error('Timed out '+expression);}
const setClock=async now=>{const result=await native('testClock',{now});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.now,now,'测试时钟必须回读一致');};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
try{
 assert.ok(run('shell','pm','list','packages',testPackage).includes('package:'+testPackage),'隔离验收包未安装');
 run('reverse','tcp:58441','tcp:58441');run('shell','am','force-stop',testPackage);run('shell','am','start','-n',testPackage+'/com.labmaker.app.MainActivity');
 for(let n=0;n<60;n++){try{const pid=run('shell','pidof',testPackage).trim().split(/\s/)[0];run('forward','tcp:9227','localabstract:webview_devtools_remote_'+pid);const tabs=await(await fetch('http://127.0.0.1:9227/json')).json();ws=new WebSocket(tabs.find(t=>t.url.startsWith('https://localhost/')).webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});break;}catch(e){if(n===59)throw e;await pause(500);}}
 ws.onmessage=e=>{const m=JSON.parse(e.data),j=jobs.get(m.id);if(j){jobs.delete(m.id);m.error?j.reject(Error(m.error.message)):j.resolve(m.result);}};
 await wait("typeof Capacitor!=='undefined'&&typeof Capacitor.nativePromise==='function'");
 assert.equal((await native('useMock',{enabled:true})).ok,true);await setClock(now);await evaluate(`window.__realNow=Date.now;Date.now=()=>${now};location.hash='/portal'`);
 await wait("!!document.querySelector('#portal-account')");await click('[data-portal=recommend]');assert.equal(await evaluate("document.querySelectorAll('[data-guide-card]').length"),28);assert.ok(await evaluate("document.querySelector('#guide-progress').textContent.includes('登录后')"));assert.equal(records.length,0);
 await click('[data-portal=teachers]');await click('[data-guide-category=mixed]');assert.ok(await evaluate("document.querySelector('#course-guides').innerText.includes('张欢')"));assert.equal(records.length,0);
 checks.push('Experiment and teacher reviews work offline without school requests and preserve mixed teacher classification');
 await evaluate("document.querySelector('#portal-account').value='2500000000';document.querySelector('#portal-password').value='mock-only-password'");await click('[data-portal="login"]');
 await wait("document.querySelector('#portal-status')?.textContent.includes('已连接学校')");assert.equal(mutations,0);await setClock(now);
 await click('[data-portal=available]');await wait("!document.querySelector('[data-portal=week]').disabled");assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]').length"),0);await click('[data-portal=filters]');await click('[data-filter-action=experiments]');await wait("document.querySelectorAll('[data-candidate]').length===1");assert.ok(await evaluate("document.querySelector('#filter-cards').innerText.includes('周四下午')"));await click('[data-filter-action=cancel]');await click('[data-filter-action=cancel]');await click('[data-portal=selected]');
 checks.push('Future enrolled sessions remain in candidate directory when absent from availability results');
 const start=Date.parse('2026-10-29T15:55:00+08:00'),boundary=start-72*3600000;
 await setClock(boundary);const exactly=await native('prepare',{action:'cancel',item:{name,week:7,time},expectedTeachers:[]});assert.equal(exactly.code,'CANCEL_POLICY');assert.equal(mutations,0);
 await setClock(boundary-1);const beforeBoundary=await native('prepare',{action:'cancel',item:{name,week:7,time},expectedTeachers:[]});assert.equal(beforeBoundary.ok,true,JSON.stringify(beforeBoundary));
 await setClock(boundary);const crossed=await native('commit',{ticket:beforeBoundary.value.ticket,confirmed:true,academicUncheckedConfirmed:false});assert.equal(crossed.code,'CANCEL_POLICY');assert.equal(mutations,0);await setClock(now);
 checks.push('Native exact 72-hour boundary rejects cancellation and crossing it after confirmation never submits');
 await click('[data-portal="cancel"]');await wait("document.querySelector('#course-confirm').open");assert.equal(mutations,0);await click('[data-course-confirm="cancel"]');await wait("!document.querySelector('#course-confirm').open");assert.equal(mutations,0);
 checks.push('Preparation and dialog cancellation never submit; school raw UTF-8 cookie retained');
 await click('[data-portal="cancel"]');await wait("document.querySelector('#course-confirm').open");await click('[data-course-confirm="continue"]');await wait("document.querySelector('#portal-status').textContent.includes('已取消选课')");assert.equal(mutations,1);assert.equal(enrolled,false);
 checks.push('Native cancellation final form and timetable readback update the UI');
 await click('[data-portal="available"]');await wait("!!document.querySelector('[data-portal=add]:not(:disabled)')");await click('[data-portal="filters"]');await wait("document.querySelector('#course-filters').open");await click('[data-filter-action=reset]');await click('[data-filter-action=apply]');await wait("!document.querySelector('#course-filters').open");await click('[data-portal=filters]');
 await evaluate("document.querySelector('[data-filter=recommendedTeachers]').checked=true;document.querySelector('[data-filter=recommendedTeachers]').dispatchEvent(new Event('change',{bubbles:true}))");await click('[data-filter-action=cancel]');assert.equal(await evaluate("document.querySelector('[data-portal=filters]').textContent.includes(' · ')"),false);
 await click('[data-portal=filters]');await click('[data-filter-action=teachers]');await wait("document.querySelectorAll('[data-candidate]').length===2");
 assert.ok(await evaluate("document.querySelector('#filter-cards').innerText.includes('对应时间：周四下午')"));
 await evaluate("document.querySelector('#filter-search').value='王小芳';document.querySelector('#filter-search').dispatchEvent(new Event('input',{bubbles:true}))");await click('[data-filter-action=all]');await click('[data-filter-action=confirm]');await click('[data-filter-action=apply]');await wait("!document.querySelector('#course-filters').open");assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]:not([hidden])').length"),1);
 await click('[data-portal=clear]');await wait("!!document.querySelector('#portal-account')");await evaluate("document.querySelector('#portal-account').value='2500000000';document.querySelector('#portal-password').value='mock-only-password'");await click('[data-portal=login]');await wait("document.querySelector('#portal-status')?.textContent.includes('已连接学校')");await setClock(now);await click('[data-portal=available]');await wait("!!document.querySelector('[data-portal=add]:not(:disabled)')");
 await click('[data-portal=filters]');assert.equal(await evaluate("document.querySelector('[data-filter=teachersEnabled]').checked"),true);
 await click('[data-filter-action=experiments]');await wait("document.querySelectorAll('[data-candidate]').length===1");
 await wait("document.querySelector('#filter-directory-status').textContent.includes('未完整获取')");
 for(const [width,height] of [[320,640],[360,800],[430,932],[768,1024],[1024,1366],[1280,800]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(180);assert.ok(await evaluate("document.querySelector('#course-filters').getBoundingClientRect().width<=innerWidth && document.querySelector('#course-filters .modal-actions').getBoundingClientRect().bottom<=innerHeight"));const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/filters-${width}.png`,Buffer.from(shot.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');
 await click('[data-filter-action=cancel]');await click('[data-filter-action=reset]');await click('[data-filter-action=apply]');await wait("!document.querySelector('#course-filters').open");
 checks.push('Filter draft cancellation, teacher multi-select/search, per-account save and session-clear restoration, incomplete directory and phone/tablet dialogs verified');
 await click('[data-portal=cross-week]');await wait("document.querySelector('#portal-scan-status').textContent.includes('未完整获取')");
 assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]:not([hidden])').length"),1);
 await evaluate("document.querySelector('#portal-search').value='不存在的实验';document.querySelector('#portal-search').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]:not([hidden])').length"),0);
 await evaluate("document.querySelector('#portal-search').value='冲击';document.querySelector('#portal-search').dispatchEvent(new Event('input',{bubbles:true}))");
 await pause(500);await evaluate("window.__crossCard=document.querySelector('[data-slot-index]');document.querySelector('#portal-search').focus();window.dispatchEvent(new Event('focus'))");await pause(300);assert.equal(await evaluate("window.__crossCard===document.querySelector('[data-slot-index]')"),true);assert.equal(await evaluate("document.querySelector('#portal-search').value"),'冲击');assert.equal(await evaluate("document.activeElement===document.querySelector('#portal-search')"),true);checks.push('Android focus refresh preserves unchanged cross-week cards and search focus');
 await click('[data-portal=slot-review]');await wait("document.querySelector('#course-review').open");assert.ok(await evaluate("document.querySelector('#course-review').innerText.includes('冲击')"));await click('[data-review-close]');assert.equal(mutations,1);
 for(const [width,height] of [[320,640],[768,1024]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(150);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/crossweek-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');

 await click('[data-portal=filters]');await click('[data-filter-action=teachers]');await wait("document.querySelectorAll('[data-candidate]').length===2");await click('[data-filter-action=clear]');await evaluate("document.querySelector('#filter-search').value='王小芳';document.querySelector('#filter-search').dispatchEvent(new Event('input',{bubbles:true}))");await click('[data-filter-action=all]');await click('[data-filter-action=confirm]');await click('[data-filter-action=apply]');await wait("!document.querySelector('#course-filters').open");assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]:not([hidden])').length"),1);assert.ok(await evaluate("document.querySelector('[data-portal=filters]').innerText.includes('1')"));
 await click('[data-portal=filters]');await click('[data-filter-action=reset]');await click('[data-filter-action=apply]');await wait("!document.querySelector('#course-filters').open");
 for(const [width,height] of [[320,640],[768,1024]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate("document.querySelector('#portal-search').scrollIntoView({block:'start'})");await pause(180);const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/crossweek-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');
 checks.push('Cross-week partial results share search and filters, preserve card identity, and review never submits');
 await click('[data-portal=recommend]');await wait("document.querySelector('#guide-progress').textContent.includes('未完整获取')");assert.equal(await evaluate("document.querySelectorAll('[data-guide-card]').length"),28);
 const experimentCard="[data-guide-name='直螺线管磁场分布的测量']";
 for(const [width,height] of [[320,640],[768,1024]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate("document.querySelector('#guide-search').scrollIntoView({block:'start'})");await pause(150);const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/experiments-guide-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');

 assert.ok(await evaluate(`document.querySelector(${JSON.stringify(experimentCard)}).innerText.includes('已获取 2 人')`));
 await evaluate("document.querySelector('#guide-remaining').checked=true;document.querySelector('#guide-remaining').dispatchEvent(new Event('change',{bubbles:true}))");assert.equal(await evaluate("document.querySelectorAll('[data-guide-card]:not([hidden])').length"),1);
 await wait("!document.querySelector('[data-guide-refresh]').disabled");const readsBeforeTeacher=records.filter(r=>r.path.endsWith('/statsel.aspx')).length;
 await click('[data-portal=teachers]');await click('[data-guide-category=not_recommended]');
 assert.equal(records.filter(r=>r.path.endsWith('/statsel.aspx')).length,readsBeforeTeacher);

 assert.ok(await evaluate("document.querySelector('[data-guide-name=吴兴林]').innerText.includes('场次待核实')"));
 await evaluate("document.querySelector('#guide-remaining').checked=false;document.querySelector('#guide-remaining').dispatchEvent(new Event('change',{bubbles:true}))");
 teacherNames='吴兴林';await click('[data-portal=metadata]');await wait("document.querySelector('#portal-status').textContent.includes('已重新核对')");
 assert.ok(await evaluate("document.querySelector('[data-guide-name=吴兴林]').innerText.includes('已获取 2 人')"));
 await evaluate("window.__guideStart=performance.now();Date.now=()=>Date.parse('2026-10-29T15:55:00+08:00')-100+(performance.now()-window.__guideStart);window.dispatchEvent(new Event('focus'))");await pause(250);assert.ok(await evaluate("document.querySelector('[data-guide-name=吴兴林]').innerText.includes('已获取 0 人')"));
 await evaluate(`Date.now=()=>${now};window.dispatchEvent(new Event('focus'))`);assert.ok(await evaluate("document.querySelector('[data-guide-name=吴兴林]').innerText.includes('已获取 2 人')"));

 await evaluate("document.querySelector('#guide-search').value='吴兴林';document.querySelector('#guide-search').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await evaluate("document.querySelectorAll('[data-guide-card]:not([hidden])').length"),1);
 for(const [width,height] of [[320,640],[360,800],[430,932],[768,1024],[1024,1366],[1280,800]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate("document.querySelector('#guide-search').scrollIntoView({block:'start'})");await pause(150);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/guides-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');
 await evaluate("document.querySelector('[data-guide-name=吴兴林] > .guide-seats [data-guide-scope]').click()");await wait("document.querySelector('#guide-sessions').open");assert.ok(await evaluate("document.querySelector('#guide-sessions').innerText.includes('2026-10-29')"));assert.equal(mutations,1);
 for(const [width,height] of [[320,640],[768,1024]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await pause(150);assert.ok(await evaluate("document.querySelector('#guide-sessions .modal-actions').getBoundingClientRect().bottom<=innerHeight"));const image=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`artifacts/verification/guide-sessions-${width}.png`,Buffer.from(image.data,'base64'));}await call('Emulation.clearDeviceMetricsOverride');await click('[data-guide-close]');
 await click('[data-portal=available]');await wait("!!document.querySelector('[data-portal=add]:not(:disabled)')");assert.equal(await evaluate("document.querySelectorAll('[data-slot-index]:not([hidden])').length"),1);
 await click('[data-portal=teachers]');await wait("!!document.querySelector('[data-guide-name=吴兴林]')");await evaluate("document.querySelector('[data-guide-name=吴兴林] > .guide-seats [data-guide-scope]').click()");await wait("document.querySelector('#guide-sessions').open");
 checks.push('Guide seats use confirmed teacher relationships, independent seat switch, cached serial scan, search and six responsive viewports');
 await evaluate("document.querySelector('[data-guide-pick=\"0\"]').click();document.querySelector('[data-guide-close]').click()");await wait("!document.querySelector('[data-portal=metadata]').disabled");assert.equal(await evaluate("document.querySelector('#course-confirm').open"),false);assert.equal(mutations,1);
 await evaluate("document.querySelector('[data-guide-name=吴兴林] > .guide-seats [data-guide-scope]').click()");await wait("document.querySelector('#guide-sessions').open");
 checks.push('Time-boundary timer and focus refresh recalculate guide seats; closing during preparation discards the ticket without a confirmation or submission');



 await click('[data-guide-pick="0"]');await wait("document.querySelector('#course-confirm').open");assert.equal(await evaluate("document.querySelector('#guide-sessions').open"),false);
 assert.equal(await evaluate("document.querySelector('[data-course-confirm=continue]').disabled"),true);assert.equal(mutations,1);
 await evaluate("document.querySelector('#course-academic-ack').checked=true;document.querySelector('#course-academic-ack').dispatchEvent(new Event('change',{bubbles:true}))");
 assert.equal(await evaluate("document.querySelector('[data-course-confirm=continue]').disabled"),false);
 await call('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:true});await pause(200);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('artifacts/verification/course-confirm-small.png',Buffer.from(shot.data,'base64'));await call('Emulation.clearDeviceMetricsOverride');
 checks.push('Add confirmation requires explicit unverified academic-conflict acknowledgement; small dialog fits 320px');
 slowCommit=true;await click('[data-course-confirm="continue"]');await wait("document.querySelector('[data-course-confirm=cancel]').disabled");
 assert.equal((await native('clear')).code,'COMMIT_BUSY');await evaluate("location.hash='/settings'");await pause(150);assert.equal(await evaluate("location.hash.includes('/portal')"),true);
 await click('[data-course-confirm="continue"]');await wait("document.querySelector('#portal-status').textContent.includes('选课成功')");assert.equal(mutations,2);assert.equal(enrolled,true);
 checks.push('Commit blocks clear/navigation/double submit; add happens once and readback is authoritative');
 const prepared=await native('prepare',{action:'cancel',item:{name,week:7,time},expectedTeachers:[]});assert.equal(prepared.ok,true);await native('clear');const stale=await native('commit',{ticket:prepared.value.ticket,confirmed:true,academicUncheckedConfirmed:false});assert.equal(stale.code,'TICKET');assert.equal(mutations,2);
 checks.push('Clearing native session invalidates outstanding ticket');
 await click('[data-portal=clear]');await wait("!!document.querySelector('#portal-account')");enrolled=false;await evaluate("document.querySelector('#portal-account').value='2500000000';document.querySelector('#portal-password').value='mock-only-password'");await click('[data-portal=login]');await wait("document.querySelector('#portal-status')?.textContent.includes('已连接学校')");await setClock(now);
 const oldReads=records.filter(r=>r.path.endsWith('/statsel.aspx')).length;delayWeeks=true;await click('[data-portal=teachers]');for(let n=0;n<50&&records.filter(r=>r.path.endsWith('/statsel.aspx')).length===oldReads;n++)await pause(20);assert.ok(records.filter(r=>r.path.endsWith('/statsel.aspx')).length>oldReads);
 await click('[data-portal=clear]');await wait("!!document.querySelector('#portal-account')");await pause(400);assert.ok(await evaluate("document.querySelector('#guide-progress').textContent.includes('登录后')"));assert.equal(await evaluate("Array.from(document.querySelectorAll('.guide-seat-label')).every(e=>e.textContent==='未登录')"),true);assert.equal(mutations,2);assert.equal(maxActive,1);
 checks.push('Clearing while a delayed directory response is in flight prevents old session seat results from reappearing');
 delayWeeks=false;await evaluate("document.querySelector('#portal-account').value='2500000000';document.querySelector('#portal-password').value='mock-only-password'");await click('[data-portal=login]');await wait("document.querySelector('#portal-status')?.textContent.includes('已连接学校')");await setClock(now);expireWeeks=true;await click('[data-portal=teachers]');await wait("!!document.querySelector('#portal-account') && document.querySelector('#portal-status').textContent.includes('登录已失效')");assert.equal(await evaluate("Array.from(document.querySelectorAll('.guide-seat-label')).every(e=>e.textContent==='未登录')"),true);assert.equal(mutations,2);
 checks.push('Expired school authentication during progressive statistics clears live seat claims and returns to login');


 fs.writeFileSync('artifacts/verification/transactions-native.json',JSON.stringify({checks,mocked:true,realSchoolMutations:0,mutations,maxActive,requestCount:records.length},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(e){console.error(await evaluate('document.body.innerText').catch(()=>''));console.error(JSON.stringify(records));throw e;}finally{await evaluate('if(window.__realNow){Date.now=window.__realNow;delete window.__realNow}').catch(()=>{});await native('clear').catch(()=>{});await native('useMock',{enabled:false}).catch(()=>{});ws?.close();server.closeAllConnections();server.close();try{run('reverse','--remove','tcp:58441');}catch{}}
