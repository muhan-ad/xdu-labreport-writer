// Reports consume a reviewed PNG only; model code must not execute in the report worker.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'public/report-runtime');
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json')));
const py=await loadPyodide({indexURL:runtime+path.sep,stdout:()=>{},stderr:s=>console.error(s)});
await py.loadPackage(['numpy','matplotlib','lxml','pillow']);
const site=py.runPython('import site; site.getsitepackages()[0]');
for(const file of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(runtime,file))),'zip',{extractDir:site});
py.FS.mkdirTree('/lab');for(const file of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+file,fs.readFileSync(path.join(runtime,file)));
py.FS.writeFile('/lab/catalog.json',fs.readFileSync(path.join(root,'src/data/catalog.json')));
py.FS.writeFile('/lab/insert_chart.py',fs.readFileSync(path.join(root,'src/engine/vendor/insert_chart.py')));
await py.runPythonAsync(fs.readFileSync(path.join(root,'src/engine/runner.py'),'utf8').replace(/^\uFEFF/,''));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments,samples=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json')));
const png=fs.readFileSync(path.join(root,'artifacts/verification/ai-plot-runtime/solenoid.png')),image={base64:png.toString('base64'),sha256:crypto.createHash('sha256').update(png).digest('hex'),caption:'AI绘图验证 $d_{m1}$',section:'数据处理'};
const output=path.join(root,'artifacts/verification/ai-plot-report');fs.mkdirSync(output,{recursive:true});
const state=()=>py.runPython("json.dumps({'jobs':os.listdir('/lab/jobs'),'cwd':os.getcwd(),'path':sys.path},sort_keys=True)");const before=state(),results=[];
const jobFor=exp=>({experimentId:exp.id,data:samples[exp.id],profile:{name:'AI插图离线验证',studentId:'TEST',className:'模拟数据'},date:'2026-10-24',seed:42,options:{},code:'raise RuntimeError("MODEL_CODE_MUST_NOT_RUN")'});
async function generate(job){py.globals.set('report_job',JSON.stringify(job));return JSON.parse(await py.runPythonAsync('generate_report(report_job)'));}
const release=report=>{py.globals.set('finished_job',report.job);py.runPython('release_report(finished_job)');};
for(const exp of catalog.filter(e=>/直螺线管|凹透镜|电路的稳态/.test(e.sourceId))){
 const baseline=await generate(jobFor(exp));const section=baseline.headings.includes('数据处理')?'数据处理':baseline.headings[0],formulas=baseline.formulaCount;release(baseline);
 const report=await generate({...jobFor(exp),aiPlotImage:{...image,section}});
 try{
  assert.equal(report.text.split('AI绘图验证').length-1,1);assert.ok(report.formulaCount>=formulas);assert.ok(report.charts.some(chart=>chart.name.includes('AI绘图验证')));
  assert.ok(report.charts.some(chart=>crypto.createHash('sha256').update(py.FS.readFile(chart.path)).digest('hex')===image.sha256));
  fs.writeFileSync(path.join(output,exp.id+'.docx'),py.FS.readFile(report.path));results.push({experimentId:exp.id,name:exp.name,result:'PASS',formulas:report.formulaCount});
 }finally{release(report);}assert.equal(state(),before);
}
const exp=catalog.find(e=>e.sourceId==='直螺线管磁场分布的测量');
const group=Array.from({length:3},(_,i)=>({...image,caption:`图组顺序${i+1} $d_{m1}$`}));
const groupReport=await generate({...jobFor(exp),aiPlotImages:group});
try{for(const row of group)assert.equal(groupReport.text.split(row.caption.split(' ')[0]).length-1,1);assert.ok(groupReport.text.indexOf('图组顺序1')<groupReport.text.indexOf('图组顺序2'));assert.ok(groupReport.text.indexOf('图组顺序2')<groupReport.text.indexOf('图组顺序3'));fs.writeFileSync(path.join(output,'multi-image.docx'),py.FS.readFile(groupReport.path));}finally{release(groupReport);}assert.equal(state(),before);
for(const [name,job,pattern] of [
 ['bad-second',{aiPlotImages:[image,{...image,sha256:'0'.repeat(64)}]},/校验失败/],
 ['too-many',{aiPlotImages:Array.from({length:9},()=>image)},/最多八张/],
 ['ambiguous',{aiPlotImage:image,aiPlotImages:[image]},/配置重复/],
]){await assert.rejects(generate({...jobFor(exp),...job}),pattern);assert.equal(state(),before,name+' cleanup');}
const invalid=[
 ['hash',{...image,sha256:'0'.repeat(64)},/校验失败/],
 ['section',{...image,section:'不存在的章节'},/没有章节/],
 ['caption',{...image,caption:''},/图注/],
 ['format',{...image,base64:Buffer.from('not a png').toString('base64'),sha256:crypto.createHash('sha256').update('not a png').digest('hex')},/cannot identify image file/],
];
for(const [name,bad,pattern] of invalid){await assert.rejects(generate({...jobFor(exp),aiPlotImage:bad}),pattern);assert.equal(state(),before,name+' cleanup');}
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({createdAt:new Date().toISOString(),results,multiImageCount:3,multiImageNegativeCases:3,negativeCases:invalid.length,pngPreserved:true,modelCodeNotExecuted:true,cleanup:true,scope:'Local WASM report pipeline with simulated reviewed PNG; not Android file integration'},null,2));
console.log(`AI plot report insertion: ${results.length} experiments, ${invalid.length} failures PASS`);
