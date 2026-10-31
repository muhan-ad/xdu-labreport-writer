// Controlled simulated Python snippets in WASM only; never executes AI code in host Python.
import {scienceData,scienceCode} from '../tests/fixtures/plot-science.mjs';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'public/report-runtime');
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json')));
const py=await loadPyodide({indexURL:runtime+path.sep,stdout:()=>{},stderr:s=>console.error(s)});
await py.loadPackage(['numpy','matplotlib','lxml','pillow','scipy','pandas']);
const site=py.runPython('import site; site.getsitepackages()[0]');
for(const file of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(runtime,file))),'zip',{extractDir:site});
py.FS.mkdirTree('/lab');
for(const file of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+file,fs.readFileSync(path.join(runtime,file)));
py.FS.writeFile('/lab/catalog.json',fs.readFileSync(path.join(root,'src/data/catalog.json')));
py.FS.writeFile('/lab/ai_plot.py',fs.readFileSync(path.join(root,'src/engine/vendor/ai_plot.py')));
await py.runPythonAsync(fs.readFileSync(path.join(root,'src/engine/runner.py'),'utf8').replace(/^\uFEFF/,''));
const exp=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments.find(e=>e.sourceId==='直螺线管磁场分布的测量');
const data=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json')))[exp.id];
const code=`import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
x=np.asarray(DATA["x_mm"],dtype=float)
left=np.asarray(DATA["d_left_cm"],dtype=float)
right=np.asarray(DATA["d_right_cm"],dtype=float)
fig,ax=plt.subplots(figsize=(8,4.8))
ax.plot(-x,left,"o-",color="#15803d")
ax.plot(x,right,"s-",color="#9a5b25")
ax.set_xlabel("$x$ / mm")
ax.set_ylabel("$d_{m1},d_{m2}$ / cm")
ax.grid(True,alpha=0.25)
fig.tight_layout()
save(fig,"fig1.png")
caption("fig1.png","图1 左侧 $d_{m1}$ 与右侧 $d_{m2}$ 随位置的分布")`;
const output=path.join(root,'artifacts/verification/ai-plot-runtime');fs.mkdirSync(output,{recursive:true});
const state=()=>py.runPython("json.dumps({'cwd':os.getcwd(),'jobs':os.listdir('/lab/jobs')},sort_keys=True)");
const before=state();
async function run(code,values=data){py.globals.set('plot_job',JSON.stringify({experimentId:exp.id,data:values,code}));return JSON.parse(await py.runPythonAsync('generate_ai_plot_preview(plot_job)'));}
const result=await run(code);
assert.equal(result.charts.length,1);assert.ok(result.charts[0].name.includes('$d_{m1}$'));
const bytes=py.FS.readFile(result.charts[0].path);assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
fs.writeFileSync(path.join(output,'solenoid.png'),bytes);fs.writeFileSync(path.join(output,'simulated-model.py'),code);
py.globals.set('finished_job',result.job);py.runPython('release_report(finished_job)');assert.equal(state(),before);
const reader=await run(`import json\nwith open(DATA_FILE,encoding="utf-8") as stream:\n    copy=json.load(stream)\nassert copy==DATA\n`+code);
py.globals.set('finished_job',reader.job);py.runPython('release_report(finished_job)');assert.equal(state(),before);
const scientific=await run(scienceCode,scienceData);fs.writeFileSync(path.join(output,'science.png'),py.FS.readFile(scientific.charts[0].path));py.globals.set('finished_job',scientific.job);py.runPython('release_report(finished_job)');assert.equal(state(),before);
const group=await run(code+'\n'+Array.from({length:7},(_,i)=>`save(fig,"fig${i+2}.png")\ncaption("fig${i+2}.png","图${i+2} 实测曲线")`).join('\n'));
assert.equal(group.charts.length,8);assert.ok(group.charts[7].name.startsWith('图8'));for(const image of group.charts)assert.ok(py.FS.readFile(image.path).length>33);py.globals.set('finished_job',group.job);py.runPython('release_report(finished_job)');assert.equal(state(),before);
const cases=[
 ['pandas-file','import pandas as pd\npd.read_csv("/other.csv")',/不支持此属性/],
 ['pandas-import-file','from pandas import read_csv',/模块成员无效/],
 ['scipy-file','from scipy.io import loadmat',/模块不在允许范围/],
 ['system-import','import os',/暂不支持模块/],['js-bridge','import js',/暂不支持模块/],
 ['introspection','value=DATA.__class__',/不支持此属性/],
 ['foreign-read','open("/other.json").read()',/只能读取 DATA_FILE/],
 ['direct-file-api','import numpy as np\nnp.load("/other.npy")',/不支持此属性/],
 ['traversal',code.replace('save(fig,"fig1.png")','save(fig,"../outside.png")'),/最多保存八张图/],
 ['oversize',code.replace('(8,4.8)','(11,8)'),/尺寸不能超过/],
 ['dpi',code.replace('save(fig,"fig1.png")','save(fig,"fig1.png",dpi=1000)'),/dpi/],
 ['no-caption',code.split('\n').filter(s=>!s.startsWith('caption(')).join('\n'),/未提供 caption/],
 ['no-image','x=DATA["x_mm"]',/未调用 save/],
 ['two-images',code+'\nsave(fig,"fig1.png")',/最多保存八张图/],
 ['missing-second-caption',code+'\nsave(fig,"fig2.png")',/未提供 caption/],
 ['skipped-number',code+'\nsave(fig,"fig3.png")',/最多保存八张图/],
 ['extra-caption',code+'\ncaption("fig2.png","不存在的图")',/未保存图片/],
 ['ninth-image',code+'\n'+Array.from({length:8},(_,i)=>`save(fig,"fig${i+2}.png")\ncaption("fig${i+2}.png","图注")`).join('\n'),/最多保存八张图/],
 ['syntax','if :',/语法错误/],['missing-data',code.replace('DATA["x_mm"]','DATA["missing"]'),/missing/],
 ['oversize-code','x'.repeat(30001),/超过 30000/],['log-limit','print("x"*16001)',/日志过长/],
];
const results=[];
for(const [name,code,pattern] of cases){await assert.rejects(run(code),pattern);assert.equal(state(),before,name+' leaked temporary jobs');results.push({name,result:'PASS'});}
const again=await run(code);py.globals.set('finished_job',again.job);py.runPython('release_report(finished_job)');assert.equal(state(),before);
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'WASM adapter foundation only; no Android UI, model request or formal sandbox guarantee',normalCases:5,negativeCases:results,pngBytes:bytes.length,cleanup:true},null,2));
console.log(`AI plot WASM adapter: 5 normal and ${results.length} negative cases PASS`);
