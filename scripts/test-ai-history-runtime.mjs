// Offline WASM report regression only. No emulator, credentials or API requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
import {mergePolishBatch} from '../src/domain/polish-batch.ts';
import {defaultReportSettings,detachAIHistory} from '../src/domain/reports.ts';

const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'public/report-runtime');
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json')));
const py=await loadPyodide({indexURL:runtime+path.sep,stdout:()=>{},stderr:s=>console.error(s)});
await py.loadPackage(['numpy','matplotlib','lxml','pillow']);
const site=py.runPython('import site; site.getsitepackages()[0]');
for(const file of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(runtime,file))),'zip',{extractDir:site});
py.FS.mkdirTree('/lab');
for(const file of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+file,fs.readFileSync(path.join(runtime,file)));
py.FS.writeFile('/lab/catalog.json',fs.readFileSync(path.join(root,'src/data/catalog.json')));
await py.runPythonAsync(fs.readFileSync(path.join(root,'src/engine/runner.py'),'utf8').replace(/^\uFEFF/,''));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments;
const samples=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json')));
const selected=catalog.filter(e=>/直螺线管|凹透镜|电路的稳态/.test(e.sourceId));
assert.equal(selected.length,3);
const directory=path.join(root,'artifacts/report-tests/ai-history');fs.mkdirSync(directory,{recursive:true});
const results=[];
for(const exp of process.argv.includes('--batch')?[]:selected){
 const quiz=crypto.randomUUID(),polish=crypto.randomUUID();
 const settings={...defaultReportSettings(),ai:{source:'mock-source',customQuiz:{questions:['历史回归问题标记'],answers:{1:['历史回归回答标记。公式 $Q=Kt$。']}},polish:{实验原理:'历史回归润色标记。公式 $Q=Kt$。'},historyRefs:{quiz,polish:{实验原理:polish}}}};
 const variants=[['applied',settings,true,true],['old-deleted',detachAIHistory(settings,crypto.randomUUID()),true,true],['quiz-deleted',detachAIHistory(settings,quiz),false,true],['all-deleted',detachAIHistory(settings),false,false]];
 let appliedText;
 for(const [mode,current,hasQuiz,hasPolish] of variants){
  // Same explicit AI projection used by Reports.generate: history metadata stays local.
  const options={variants:{},disabledSections:[],...(current.ai?.customQuiz?{customQuiz:current.ai.customQuiz}:{}),...(current.ai?.polish?{polish:current.ai.polish}:{})};
  py.globals.set('mobile_job',JSON.stringify({experimentId:exp.id,data:samples[exp.id],profile:{name:'离线历史验证',studentId:'TEST',className:'模拟数据'},date:'2026-10-24',seed:42,options}));
  const report=JSON.parse(await py.runPythonAsync('generate_report(mobile_job)'));
  try{
   for(const marker of ['历史回归问题标记','历史回归回答标记'])assert.equal(report.text.split(marker).length-1,hasQuiz?1:0,`${exp.name} ${mode} ${marker}`);
   assert.equal(report.text.split('历史回归润色标记').length-1,hasPolish?1:0,`${exp.name} ${mode} polish`);
   assert.ok(report.formulaCount>0,'Editable OMML formulas must remain');
   assert.ok(report.text.includes('离线历史验证'));
   if(mode==='applied')appliedText=report.text;
   if(mode==='old-deleted')assert.equal(report.text,appliedText,'Deleting unused history must not change generated report');
   fs.writeFileSync(path.join(directory,`${exp.id}-${mode}.docx`),py.FS.readFile(report.path));
   results.push({experimentId:exp.id,name:exp.name,mode,result:'PASS',formulas:report.formulaCount,bytes:report.bytes});
   console.log(`${exp.name}: ${mode} PASS`);
  }finally{py.globals.set('finished_job',report.job);py.runPython('release_report(finished_job)');}
 }
}
if(process.argv.includes('--batch'))for(const exp of selected){
 const job={experimentId:exp.id,data:samples[exp.id],profile:{name:'离线批量验证',studentId:'TEST',className:'模拟数据'},date:'2026-10-25',seed:42,options:{variants:{},disabledSections:[]}};
 py.globals.set('mobile_job',JSON.stringify(job));const baseline=JSON.parse(await py.runPythonAsync('generate_report(mobile_job)'));let original;
 try{original=baseline.sections;assert.ok(original);}
 finally{py.globals.set('finished_job',baseline.job);py.runPython('release_report(finished_job)');}
 const entries=Object.entries(original).filter(([name,text])=>name!=='思考题'&&typeof text==='string'&&text.trim()).slice(0,3).map(([section,text],i)=>({section,original:text,text:`批量回归标记${i+1}。`+text}));assert.equal(entries.length,3);
 const settings=mergePolishBatch(defaultReportSettings(),'mock-source',original,entries);job.options.polish=settings.ai.polish;py.globals.set('mobile_job',JSON.stringify(job));const report=JSON.parse(await py.runPythonAsync('generate_report(mobile_job)'));
 try{for(let i=1;i<=3;i++)assert.equal(report.text.split('批量回归标记'+i).length-1,1);assert.equal(report.formulaCount,baseline.formulaCount,'Batch must preserve editable formula count');fs.writeFileSync(path.join(directory,exp.id+'-batch.docx'),py.FS.readFile(report.path));results.push({experimentId:exp.id,name:exp.name,mode:'batch',chapters:entries.map(e=>e.section),result:'PASS',formulas:report.formulaCount,bytes:report.bytes});console.log(exp.name+': batch PASS');}
 finally{py.globals.set('finished_job',report.job);py.runPython('release_report(finished_job)');}
}
fs.writeFileSync(path.join(directory,process.argv.includes('--batch')?'batch-results.json':'results.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Local Node/WASM only; no Android UI or real API verification',runtime:manifest.runtimeVersion,results},null,2));
assert.equal(results.length,process.argv.includes('--batch')?3:12);
