const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),helpers=vm.runInNewContext(source.split('// UI')[0]+';({courseUnavailable})',{setTimeout,Promise,Map,Set});
test('only unconflicted available courses with positive known seats retain category marking',()=>{
 const item={remaining:2};assert.equal(helpers.courseUnavailable(item,'available',''),false);
 for(const remaining of [0,-1,null,undefined,Infinity,NaN])assert.equal(helpers.courseUnavailable({remaining},'available',''),true);
 assert.equal(helpers.courseUnavailable(item,'enrolled',''),true);assert.equal(helpers.courseUnavailable(item,'available','已选过该实验'),true);
 assert.equal(helpers.courseUnavailable(item,'available','与教务课程冲突'),true);
});
test('card prevents enrolling full and conflicting courses, preserves enrolled cancellation',()=>{
 const start=source.indexOf('function card('),end=source.indexOf('\nfunction renderRecords',start),scope={getCategory:()=> 'optics',CATEGORY_NAMES:{optics:'光学'},conflict:()=>'',courseUnavailable:helpers.courseUnavailable,esc:String,busy:false,uncertain:false};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
 assert.match(scope.card({name:'A',remaining:0},'available',0),/unavailable[\s\S]*data-action="add"[^>]*disabled/);
 assert.doesNotMatch(scope.card({name:'A',remaining:3},'available',0),/unavailable|disabled/);
 assert.match(scope.card({name:'A',cancellable:true},'enrolled',0),/unavailable[\s\S]*data-action="cancel"/);
 scope.conflict=()=> '已选过该实验';assert.match(scope.card({name:'A',remaining:3},'available',0),/unavailable[\s\S]*disabled/);
});
test('home uses the one-stop entry and preparation button; login controls are inside lower settings entry',()=>{
 const home=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 const button=id=>home.match(new RegExp('<button[^>]*id="'+id+'"[^>]*>[\\s\\S]*?</button>'))[0];
 assert.match(button('btnOpenCourseSelection'),/btn btn-primary btn-sm/);assert.match(button('btnExperimentPreparation'),/btn btn-outline btn-sm/);
 assert.match(button('btnExperimentPreparation'),/>实验预习 </);assert.match(button('btnOpenCourseSelection'),/>一站通</);assert.doesNotMatch(home,/id="btnOpenSchoolPortal"/);
 assert.doesNotMatch(home,/notice-reminder|务必阅读设置中的/);
 assert.match(html,/<div class="side-bottom"><button[^>]*id="openLoginSettings"/);assert.doesNotMatch(html,/打开学校官网|class="topbar"/);
 const dialog=html.slice(html.indexOf('<dialog id="loginSettingsDialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="loginSettingsDialog"')));
 assert.match(dialog,/id="accountButton"/);assert.match(dialog,/id="connectAcademic"/);
});

test('academic progress lives only inside settings and report submission shares the sidebar',()=>{
 const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');const start=html.indexOf('<dialog id="loginSettingsDialog"'),end=html.indexOf('</dialog>',start);
 assert.ok(html.indexOf('id="academicProgress"')>start&&html.indexOf('id="academicProgress"')<end);
 assert.match(html,/data-view="report">实验报告提交/);assert.match(html,/id="reportSurface"/);
 assert.doesNotMatch(source,/if\(interactive&&result.message\)notice/);
});
