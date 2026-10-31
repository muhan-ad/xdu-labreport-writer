import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const dir=path.resolve('public/report-runtime'),out='artifacts/verification/torsion-timer-report';fs.mkdirSync(out,{recursive:true});
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.sourceId==='扭摆法测量钢丝切变模量'),sample=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id],manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const py=await loadPyodide({indexURL:dir+path.sep,stdout:()=>{},stderr:s=>console.error(s)});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const file of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir,file))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');
const archive=JSON.parse(fs.readFileSync(path.join(dir,'report-sources.json'))),key=exp.sourceId+'/generate.py',old='r"\\frac{0.01}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)',fixed='r"\\frac{" + format_number(DELTA_TIMER, sig_figs=8) + r"}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)';
if(process.argv.includes('--legacy')||process.argv.includes('--incomplete')){assert.equal(archive[key].split(fixed).length-1,2);archive[key]=process.argv.includes('--legacy')?archive[key].replaceAll(fixed,old):archive[key].replace(fixed,old);}
py.FS.writeFile('/lab/report-sources.json',JSON.stringify(archive));py.FS.writeFile('/lab/LabMakerSansSC.ttf',fs.readFileSync(path.join(dir,'LabMakerSansSC.ttf')));py.FS.writeFile('/lab/catalog.json',fs.readFileSync('src/data/catalog.json'));await py.runPythonAsync(fs.readFileSync('src/engine/runner.py','utf8').replace(/^\uFEFF/,''));
if(process.argv.includes('--incomplete')){py.globals.set('job',JSON.stringify({experimentId:exp.id,data:sample,profile:{},date:'',options:{}}));await assert.rejects(()=>py.runPythonAsync('generate_report(job)'),/计时限差公式不完整/);console.log(JSON.stringify({incompleteRejected:true}));process.exit(0);}
const results=[];
for(const limit of [0.02,0.15]){
 const data={...sample,instrument_delta_timer:limit};py.globals.set('job',JSON.stringify({experimentId:exp.id,data,profile:{name:'测试',studentId:'',className:''},date:'2026-10-30',seed:42,options:{variants:{},disabledSections:[]}}));const context=JSON.parse(await py.runPythonAsync('calculate_context(job)')).values;assert.ok(Math.abs(context.B_T-limit/Math.sqrt(3))<1e-12);
 const report=JSON.parse(await py.runPythonAsync('generate_report(job)'));py.globals.set('report_path',report.path);const equations=JSON.parse(await py.runPythonAsync(`
import xml.etree.ElementTree as ET
root=ET.fromstring(zipfile.ZipFile(report_path).read('word/document.xml'))
ns={'m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
json.dumps([''.join((t.text or '') for t in e.findall('.//m:t',ns)) for e in root.findall('.//m:oMath',ns)])
`));const timer=equations.filter(e=>e.includes('T')&&e.includes('仪'));assert.equal(timer.length,2,JSON.stringify(timer));for(const equation of timer)assert.ok(equation.includes('='+String(limit)+'3'),equation);fs.writeFileSync(`${out}/${limit}.docx`,py.FS.readFile(report.path));results.push({limit,B_T:context.B_T,equations:timer});py.globals.set('finished',report.job);py.runPython('release_report(finished)');
}
const mode=process.argv.includes('--legacy')?'legacy':'builtin';fs.writeFileSync(`${out}/${mode}-results.json`,JSON.stringify({results,scope:'two synthetic inputs in actual offline report runtime; checks both editable Word equations and current calculation model'},null,2));console.log(JSON.stringify({mode,passed:results.length,out}));
