import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const out='artifacts/report-tests/low-resistance-course-formula',dir=path.resolve('public/report-runtime');fs.mkdirSync(out,{recursive:true});
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments.find(e=>e.sourceId==='低电阻的测量'),base=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id];
const cases=[];
for(const mode of ['proportional','perturbed','zero-offset']){
 const data=structuredClone(base);
 data.L=[137,173,209,245,281,317,353,389];
 data.d=[0.500,0.501,0.499,0.500,0.500,0.500];
 if(mode==='zero-offset')data.d0=0.01;
 data.R_n_zheng=data.L.map((length,i)=>length*.00005*(mode==='proportional'?1:1+(i%2?0.02:-0.02)));
 data.R_n_fan=[...data.R_n_zheng];
 const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
 const sem=values=>Math.sqrt(values.reduce((sum,value)=>sum+(value-mean(values))**2,0)/(values.length*(values.length-1)));
 const diameter=mean(data.d)-(data.d0??0);
 const ratios=data.L.map((length,i)=>((data.R_n_zheng[i]+data.R_n_fan[i])/2*data.R_3/data.R_1)/(length/1000));
 const t=mean(ratios),uT=sem(ratios);
 const rho=Math.PI*(diameter/1000)**2*t/4*1e8;
 const uD=Math.hypot(1.11*sem(data.d),data.d_inst/Math.sqrt(3));
 const uRho=rho*Math.hypot(2*uD/diameter,uT/t);
 cases.push({id:'low-'+mode,experimentId:exp.id,data,diameter,t,uT,rho,uRho});
}
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),py=await loadPyodide({indexURL:dir+path.sep,stdout:()=>{},stderr:s=>console.error(s)});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const f of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir,f))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');for(const f of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+f,fs.readFileSync(path.join(dir,f)));py.FS.writeFile('/lab/catalog.json',fs.readFileSync('src/data/catalog.json'));await py.runPythonAsync(fs.readFileSync('src/engine/runner.py','utf8').replace(/^\uFEFF/,''));
const results=[];
for(const c of cases){
 py.globals.set('job',JSON.stringify({experimentId:c.experimentId,data:c.data,profile:{name:'测试',studentId:'',className:''},date:'2026-10-28',seed:42,options:{variants:{},disabledSections:[]}}));
 const context=JSON.parse(await py.runPythonAsync('calculate_context(job)')).values;
 for(const [actual,expected] of [[context.d_a,c.diameter],[context.t_mean,c.t],[context.u_t,c.uT],[context.rho_a,c.rho],[context.rho_u,c.uRho]]){
  assert.ok(Math.abs(actual-expected)<1e-10, JSON.stringify({actual,expected,case:c.id}));
 }
 const result=JSON.parse(await py.runPythonAsync('generate_report(job)'));
 assert.match(result.text,/L = 137(?:\.0+)? mm/);
 assert.ok(result.text.includes('8 组 T = Rx/L'));
 assert.equal(result.text.includes('千分尺零点读数'),c.id==='low-zero-offset');
 results.push({id:c.id,formulas:result.formulaCount});
 py.globals.set('finished',result.job);py.runPython('release_report(finished)');
}
py.globals.set('key',exp.sourceId+'/generate.py');py.runPython("SOURCES[key]=SOURCES[key].replace('# XDU_LOW_RESISTANCE_T_V2','# old')");
py.globals.set('bad',JSON.stringify({experimentId:exp.id,data:cases[0].data,profile:{},date:'',options:{}}));
await assert.rejects(()=>py.runPythonAsync('generate_report(bad)'),/低电阻不确定度计算尚未修正/);
fs.writeFileSync(out+'/results.json',JSON.stringify({results,oldPackageRejected:true,scope:'synthetic data with independent SI arithmetic for course T-based uncertainty and optional zero correction'},null,2));console.log(JSON.stringify({passed:results.length,oldPackageRejected:true,out}));



