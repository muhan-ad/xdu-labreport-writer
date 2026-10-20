const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const start=source.indexOf('function reportGradeMarkup('),end=source.indexOf('function renderReports(',start);
const scope={esc:v=>String(v).replaceAll('<','&lt;')};vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
test('numeric official grades use large text even when an original image exists, including zero',()=>{
 for(const score of [0,4.5,100]){const html=scope.reportGradeMarkup({score,gradeImage:'data:image/png;base64,AAA'});assert.match(html,/report-score/);assert.ok(html.includes('>'+score+'</b>'));assert.doesNotMatch(html,/<img/);}
});
test('status uses text; unreliable recognition retains official image without invented grade',()=>{
 assert.match(scope.reportGradeMarkup({score:null,gradeText:'已上传',gradeImage:'data:image/png;base64,AAA'}),/report-status[^>]*>已上传/);
 assert.match(scope.reportGradeMarkup({score:null,gradeImage:'data:image/png;base64,AAA'}),/<img/);
 assert.match(scope.reportGradeMarkup({score:NaN}),/状态待更新/);
});
