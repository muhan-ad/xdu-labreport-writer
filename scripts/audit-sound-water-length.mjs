import fs from 'node:fs';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const out='artifacts/science-audit/sound-water-length',catalog=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments,exp=catalog.find(e=>e.sourceId==='声速的测量（水中）'),sample=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json'))[exp.id],jobs=[];fs.mkdirSync(out,{recursive:true});
for(const n1 of [10,12])for(const n2 of [10,12])for(const [mode,phase] of [['alternating',0.5],['same',1]]){
 const data={...sample,L1:Array.from({length:n1},(_,i)=>20+i*20),L2:Array.from({length:n2},(_,i)=>30+i*40*phase),phase_step:phase};
 jobs.push({id:`water-${n1}-${n2}-${mode}`,experimentId:exp.id,sourceId:exp.sourceId,data,n1,n2,mode});
}
fs.writeFileSync(out+'/jobs.json',JSON.stringify(jobs));
function run(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},maxBuffer:16*1024*1024});if(r.status!==0)throw Error((r.stderr||r.stdout).slice(-3000));return r.stdout}
const native=JSON.parse(run(process.env.LAB_MAKER_TEST_PYTHON||'E:/apps/xdu-labreport-writer-master/python-runtime/python.exe',['scripts/context-native-reference.py','--jobs',out+'/jobs.json']));
run(process.execPath,['scripts/test-calculation-context-runtime.mjs','--jobs',out+'/jobs.json','--output',out+'/wasm.json']);
const wasm=JSON.parse(fs.readFileSync(out+'/wasm.json')),checks=[];
for(const job of jobs)for(const [runtime,result] of [['native',native],['wasm',wasm]])for(const key of ['v1','v2']){const observed=result[job.id][key],expected=job.data.f*40;assert.ok(Math.abs(observed-expected)<1e-8,`${job.id} ${runtime} ${key}=${observed}`);checks.push({id:job.id,runtime,key,observed,expected});}
fs.writeFileSync(out+'/results.json',JSON.stringify({checks,scope:'synthetic controlled spacings, independently calculated wavelength 40 mm; not measured data'},null,2));console.log(JSON.stringify({jobs:jobs.length,checks:checks.length,out}));
