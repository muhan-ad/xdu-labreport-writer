import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const out='artifacts/report-tests/low-resistance-0.107.0',dir=path.resolve('public/report-runtime');fs.mkdirSync(out,{recursive:true});
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.sourceId==='低电阻的测量'),base=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id];
const cases=[];
for(const mode of ['proportional','perturbed']){
 const data=structuredClone(base);data.L=[137,173,209,245,281,317,353,389];
 data.R_n_zheng=data.L.map((x,i)=>x*.00005*(mode==='perturbed'?(1+(i%2?0.02:-0.02)):1));
 data.R_n_fan=data.R_n_zheng.map(x=>x);
 const rho=data.L.map((x,i)=>Math.PI*(data.d.reduce((a,b)=>a+b,0)/data.d.length)**2*(data.R_n_zheng[i]*data.R_3/data.R_1*1000)*100/(4*x));
 const mean=rho.reduce((a,b)=>a+b)/rho.length,ua=Math.sqrt(rho.reduce((s,x)=>s+(x-mean)**2,0)/((rho.length-1)*rho.length));
 cases.push({id:'low-'+mode,experimentId:exp.id,sourceId:exp.sourceId,data,mean,ua});
}
fs.writeFileSync(out+'/jobs.json',JSON.stringify(cases));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),py=await loadPyodide({indexURL:dir+path.sep,stdout:()=>{},stderr:s=>console.error(s)});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const f of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir,f))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');for(const f of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+f,fs.readFileSync(path.join(dir,f)));py.FS.writeFile('/lab/catalog.json',fs.readFileSync('src/data/catalog.json'));await py.runPythonAsync(fs.readFileSync('src/engine/runner.py','utf8').replace(/^\uFEFF/,''));
const results=[];
for(const c of cases){
 py.globals.set('job',JSON.stringify({experimentId:c.experimentId,data:c.data,profile:{name:'测试',studentId:'',className:''},date:'2026-10-28',seed:42,options:{variants:{},disabledSections:[]}}));
 const context=JSON.parse(await py.runPythonAsync('calculate_context(job)')).values;
 assert.ok(Math.abs(context.rho_a-c.mean)<1e-10,JSON.stringify(context));
 assert.ok(Math.abs(context.rho_ua-c.ua)<1e-10);
 assert.ok(context.rho_u == null);assert.ok(context.R_x_ua == null);
 const result=JSON.parse(await py.runPythonAsync('generate_report(job)'));
 fs.writeFileSync(out+'/text.txt',result.text);assert.match(result.text,/L = 137(?:\.0+)? mm/);assert.ok(result.text.includes('不能据此给出完整合成不确定度'));assert.ok(result.text.includes('4×137.00'), '实际长度未进入公式分母');
 assert.ok(!result.text.includes('各长度点读数的分散性按 A 类不确定度评定'));
 py.globals.set('report_path',result.path);
 const xml=JSON.parse(await py.runPythonAsync("json.dumps(zipfile.ZipFile(report_path).read('word/document.xml').decode('utf-8'))"));
 assert.ok(xml.includes('137'), 'first length missing');
 fs.writeFileSync(path.join(out,c.id+'.docx'),py.FS.readFile(result.path));results.push({id:c.id,mean:c.mean,ua:c.ua,formulas:result.formulaCount});
 py.globals.set('finished',result.job);py.runPython('release_report(finished)');
}
py.globals.set('key',exp.sourceId+'/generate.py');py.runPython("SOURCES[key]=SOURCES[key].replace('# MOBILE_LOW_RESISTANCE_V1','# old')");
py.globals.set('bad',JSON.stringify({experimentId:exp.id,data:cases[0].data,profile:{},date:'',options:{}}));
await assert.rejects(()=>py.runPythonAsync('generate_report(bad)'),/低电阻不确定度计算尚未修正/);
fs.writeFileSync(out+'/results.json',JSON.stringify({results,oldPackageRejected:true,scope:'synthetic proportional and perturbed measurements, independent arithmetic; combined uncertainty intentionally not claimed'},null,2));console.log(JSON.stringify({passed:results.length,oldPackageRejected:true,out}));



