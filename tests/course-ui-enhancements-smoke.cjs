const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_COURSE_SMOKE_WORK;
if(!work)throw Error('Isolated directory required');fs.mkdirSync(work,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(work,'ui-profile-')));app.on('browser-window-created',(_,w)=>w.hide());
app.whenReady().then(async()=>{let controller;let enabled=false;const timer=setTimeout(()=>app.exit(1),25000);
try{
 controller=require('../src/main/course-selection').createCourseSelection({electron:require('electron'),root,getParent:()=>null,resolvePython:()=>path.join(root,'python-runtime/python.exe'),userData:app.getPath('userData'),getSavedLogin:async()=>({enabled,credentials:{username:'TEST_ACCOUNT',password:'TEST_PASSWORD'}})});
 assert.equal((await controller.open()).ok,true);const win=BrowserWindow.getAllWindows()[0];win.hide();
 await win.webContents.executeJavaScript(`new Promise(resolve=>{const check=()=>busy||autoLoggingIn||!csrf?setTimeout(check,20):resolve();check();})`);
 const result=await win.webContents.executeJavaScript(`(async()=>{
  document.getElementById('loginDialog').close();queueCourseMetadata=()=>{};
  const slot={name:'测试实验',week:6,day:5,period:'B',time:'星期五下午15:55-18:10',date:'2026/10/16',remaining:5,hours:3,cancellable:true,room:'F217',teacher:'教师甲'};
  const fixture={identity:{account:'TEST_ACCOUNT',name:'测试同学'},rules:{requiredHours:12,weeklyHourLimit:6,selectedHours:6},enrolled:[{...slot,date:'2020/10/16'},{...slot,name:'未来实验',week:7,date:'2099/10/16'}],weeks:[6,7],currentWeek:6};
  overview=fixture;weekData={week:6,slots:[slot,{...slot,name:'其他实验'}]};document.getElementById('week').innerHTML='<option value="6">第6周</option><option value="7">第7周</option>';view='choose';render();
  const cards={count:document.querySelectorAll('.course').length,enrolled:document.querySelectorAll('.course.enrolled').length,adds:document.querySelectorAll('[data-action="add"]').length,font:getComputedStyle(document.querySelector('.course p')).fontSize};
  const originalWeek=weekData;
  weekData={week:6,slots:['拉伸法测量杨氏模量','光栅衍射','霍尔效应','理想气体'].map((name,i)=>({...slot,name,day:i+1,time:'星期'+'一二三四'[i]+'下午15:55-18:10'}))};render();
  const contrast={colors:[...document.querySelectorAll('.course:not(.unavailable)')].map(el=>getComputedStyle(el).backgroundColor),whiteText:[...document.querySelectorAll('.course:not(.unavailable) h3')].every(el=>getComputedStyle(el).color==='rgb(255, 255, 255)')};weekData=originalWeek;
  view='enrolled';render();const records={green:document.querySelectorAll('.schedule-row.done').length,grey:document.querySelectorAll('.schedule-row:not(.done)').length,segments:document.querySelectorAll('.schedule-segment').length,lit:document.querySelectorAll('.schedule-row.done .schedule-segment').length,latest:document.querySelectorAll('.schedule-row.current').length,aligned:[...document.querySelectorAll('.schedule-row')].every(row=>{const a=row.querySelector('.schedule-card').getBoundingClientRect(),b=row.querySelector('.schedule-segment').getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1;}),textless:[...document.querySelectorAll('.schedule-rail')].every(el=>!el.textContent.trim()),viewerRemoved:!document.getElementById('openAcademicWeeks')&&!document.getElementById('academicWeeksDialog'),validText:!document.getElementById('calendar').textContent.includes('\uFFFD')};
  view='cancel';document.getElementById('search').value='未来';render();const cancelStyle={cards:document.querySelectorAll('.schedule-card').length,index:document.querySelector('[data-action="cancel"]').dataset.index,segments:document.querySelectorAll('.schedule-segment').length};document.getElementById('search').value='';view='enrolled';render();
  window.__calls=[];sendApi=async(p,data)=>{window.__calls.push(p);if(p==='academic/state')return {status:'fresh',snapshot:null};if(p==='login')return fixture;throw Error('Unexpected mock API: '+p);};
  api=sendApi;loadWeek=async()=>{};academicStarted='';academicAccount='';academicPending=false;
  await syncAcademic(false);const academicNoLogin=!window.__calls.includes('academic/browser-start');
  return {cards,records,contrast,cancelStyle,academicNoLogin};
 })()`);
 assert.deepEqual(result.cards,{count:2,enrolled:1,adds:1,font:'14px'});assert.deepEqual(result.records,{green:1,grey:1,segments:2,lit:1,latest:1,aligned:true,textless:true,viewerRemoved:true,validText:true});assert.equal(result.academicNoLogin,true);assert.equal(new Set(result.contrast.colors).size,4);assert.equal(result.contrast.whiteText,true);assert.deepEqual(result.cancelStyle,{cards:1,index:'1',segments:1});
 // Native capture is unavailable on some hidden Windows surfaces; interaction checks remain independent.

 enabled=true;
 const login=await win.webContents.executeJavaScript(`(async()=>{document.getElementById('account').value='';document.getElementById('password').value='';await openCourseLogin(true);await new Promise(resolve=>setTimeout(resolve,100));return {requests:window.__calls.filter(p=>p==='login').length,passwordCleared:document.getElementById('password').value==='',closed:!document.getElementById('loginDialog').open,silent:!document.getElementById('busy').hidden?false:true,leaked:typeof window.labAPI};})()`);
 assert.deepEqual(login,{requests:1,passwordCleared:true,closed:true,silent:true,leaked:'undefined'});
 fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,...result,login},null,2));controller.shutdown();clearTimeout(timer);app.exit(0);
}catch(error){fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.stack}));controller?.shutdown();clearTimeout(timer);app.exit(1);}
});
