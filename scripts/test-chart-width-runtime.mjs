import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
async function main(){
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'public/report-runtime'),out=path.join(root,'artifacts/verification/chart-width-runtime');fs.mkdirSync(out,{recursive:true});
const py=await loadPyodide({indexURL:runtime+path.sep,stdout:()=>{},stderr:()=>{}}),manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json')));
await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site;site.getsitepackages()[0]');
for(const file of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(runtime,file))),'zip',{extractDir:site});
py.FS.mkdirTree('/lab');for(const file of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+file,fs.readFileSync(path.join(runtime,file)));
py.FS.writeFile('/lab/catalog.json',fs.readFileSync(path.join(root,'src/data/catalog.json')));
for(const file of ['insert_chart.py','chart_preview.py'])py.FS.writeFile('/lab/'+file,fs.readFileSync(path.join(root,'src/engine/vendor',file)));
await py.runPythonAsync(fs.readFileSync(path.join(root,'src/engine/runner.py'),'utf8'));
await py.runPythonAsync(`
from collections import Counter
from docx import Document
from PIL import Image
_picture=io.BytesIO();Image.new('RGB',(100,80),'white').save(_picture,format='PNG')
_png=_picture.getvalue()
_image={'base64':base64.b64encode(_png).decode(),'sha256':hashlib.sha256(_png).hexdigest(),'caption':'宽度验证','section':'数据处理'}
def _widths(report):
    return dict(Counter(int(n.get('cx')) for n in Document(report['path'])._element.xpath('.//wp:inline/wp:extent')))
`);
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments,exp=catalog.find(e=>e.sourceId==='直螺线管磁场分布的测量'),data=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json')))[exp.id];
const base={experimentId:exp.id,data,profile:{name:'插图宽度测试',studentId:'TEST',className:'模拟数据'},date:'2026-10-26',seed:42,options:{}};
async function generate(job){py.globals.set('_job',JSON.stringify(job));return JSON.parse(await py.runPythonAsync('generate_report(_job)'));}
function release(r){py.globals.set('_release',r.job);py.runPython('release_report(_release)');}
function widths(r){py.globals.set('_report',JSON.stringify(r));return JSON.parse(py.runPython('json.dumps(_widths(json.loads(_report)))'));}
const baseline=await generate(base),before=widths(baseline);release(baseline);
const image=JSON.parse(py.runPython('json.dumps(_image)')),spec={x:'x_mm',y:'d_left_cm',kind:'line',title:'',xlabel:'',ylabel:'',caption:'宽度验证',section:'数据处理',embed:true};
const checks=[];
for(const mode of ['manual','preset','ai'])for(const widthCm of [undefined,4,7.5,20]){
 const layout=widthCm===undefined?{}:{widthCm},job={...base,options:{}};
 if(mode==='manual')job.options.customCharts=[{...spec,...layout}];
 if(mode==='preset')job.options.officialCharts={preset:'all',embed:true,section:'数据处理',...layout};
 if(mode==='ai')job.aiPlotImages=[{...image,...layout}];
 const result=await generate(job);
 try{
  const after=widths(result),added={};for(const [width,count]of Object.entries(after)){const n=count-(before[width]??0);assert.ok(n>=0);if(n)added[width]=n;}
  for(const [width,count]of Object.entries(before))assert.ok((after[width]??0)>=count);
  assert.deepEqual(Object.keys(added),[String(Math.round((widthCm??14)*360000))]);assert.ok(Object.values(added)[0]>=1);
  assert.equal(result.formulaCount,baseline.formulaCount);
  fs.writeFileSync(path.join(out,`${mode}-${widthCm??'legacy'}.docx`),py.FS.readFile(result.path));
  checks.push({mode,widthCm:widthCm??14,legacy:widthCm===undefined,added});
 }finally{release(result);}
}
for(const mode of ['manual','preset','ai'])for(const widthCm of [null,true,'8',21]){
 const job={...base,options:{}};if(mode==='manual')job.options.customCharts=[{...spec,widthCm}];if(mode==='preset')job.options.officialCharts={preset:'all',embed:true,section:'数据处理',widthCm};if(mode==='ai')job.aiPlotImages=[{...image,widthCm}];
 await assert.rejects(()=>generate(job),/图片宽度须为/);checks.push({mode,widthCm,rejected:true});
 assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"),0);
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,realApiCalls:0},null,2));console.log(JSON.stringify({passed:checks.length,validReports:12,rejectedReports:12}));

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
