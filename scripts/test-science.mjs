// Development-only independent audit. No network, account access or submissions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.LAB_MAKER_TEST_PYTHON || 'E:/apps/xdu-labreport-writer-master/python-runtime/python.exe';
if(!fs.existsSync(python))throw Error('Set LAB_MAKER_TEST_PYTHON to a Python interpreter with the report dependencies.');
const output=path.join(root,'artifacts/science-audit');fs.mkdirSync(output,{recursive:true});
function run(exe,args,options={}){
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'},...options});
 if(r.error)throw r.error;
 if(r.status!==0)throw Error(`${path.basename(exe)} ${args[0]} failed (${r.status})\n${r.stdout}\n${r.stderr}`);
 return r.stdout;
}
run(process.execPath,['scripts/sync-report-assets.mjs']);
run(python,['scripts/test-photo-layout.py']);
run(python,['scripts/science/test_independent.py']);
fs.writeFileSync(path.join(output,'python-context.json'),run(python,['scripts/context-native-reference.py']));
console.log(run(python,['scripts/science/verify_independent.py','--output','artifacts/science-audit/python-independent-results.json']).trim());
run(process.execPath,['scripts/test-calculation-context-runtime.mjs']);
console.log(run(python,['scripts/science/verify_independent.py','--context','artifacts/science-audit/wasm-context.json','--output','artifacts/science-audit/wasm-independent-results.json']).trim());
// Deliberately introduce a common unit error; success here would invalidate the checker.
const source=JSON.parse(fs.readFileSync(path.join(output,'python-context.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(output,'python-independent-results.json'),'utf8'));
const target=report.checks.find(c=>c.quantity==='B0_theory');assert.ok(target);
source[target.id][target.quantity]*=1000;
fs.writeFileSync(path.join(output,'deliberate-unit-error.json'),JSON.stringify(source));
const probe=spawnSync(python,['scripts/science/verify_independent.py','--context','artifacts/science-audit/deliberate-unit-error.json','--output','artifacts/science-audit/rejected-unit-error.json'],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
assert.equal(probe.status,1,'Audit must reject a 1000-fold unit error');
const rejected=JSON.parse(fs.readFileSync(path.join(output,'rejected-unit-error.json'),'utf8'));
assert.equal(rejected.failed,1);assert.equal(rejected.checks.find(c=>!c.pass).quantity,'B0_theory');
// Reject an uncertainty-unit mutation separately so a correct mean cannot hide it.
const uncertain=JSON.parse(fs.readFileSync(path.join(output,'python-context.json'),'utf8'));
const uncertaintyTarget=report.checks.find(c=>c.quantity==='u_lam_nm');assert.ok(uncertaintyTarget);
uncertain[uncertaintyTarget.id][uncertaintyTarget.quantity]*=1000;
fs.writeFileSync(path.join(output,'deliberate-uncertainty-error.json'),JSON.stringify(uncertain));
const badUncertainty=spawnSync(python,['scripts/science/verify_independent.py','--context','artifacts/science-audit/deliberate-uncertainty-error.json','--output','artifacts/science-audit/rejected-uncertainty-error.json'],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
assert.equal(badUncertainty.status,1,'Audit must reject an uncertainty-only unit error');
const rejectedUncertainty=JSON.parse(fs.readFileSync(path.join(output,'rejected-uncertainty-error.json'),'utf8'));
assert.equal(rejectedUncertainty.failed,1);assert.equal(rejectedUncertainty.checks.find(c=>!c.pass).quantity,'u_lam_nm');
// The plate, hole and slot all use the same thickness. Treating their
// uncertainties as independent results loses that shared-input relationship.
const badVolume=JSON.parse(fs.readFileSync(path.join(output,'python-context.json'),'utf8'));
const volumeTarget=report.checks.find(c=>c.name==='长度与体积的测量'&&c.quantity==='uV');assert.ok(volumeTarget);
const v=badVolume[volumeTarget.id];v.uV=Math.hypot(v.uVp,v.uVh,v.uVs);
fs.writeFileSync(path.join(output,'deliberate-volume-correlation-error.json'),JSON.stringify(badVolume));
const volumeProbe=spawnSync(python,['scripts/science/verify_independent.py','--context','artifacts/science-audit/deliberate-volume-correlation-error.json','--output','artifacts/science-audit/rejected-volume-correlation-error.json'],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
assert.equal(volumeProbe.status,1,'Audit must reject independent-subvolume uncertainty propagation');
const rejectedVolume=JSON.parse(fs.readFileSync(path.join(output,'rejected-volume-correlation-error.json'),'utf8'));assert.equal(rejectedVolume.failed,1);assert.equal(rejectedVolume.checks.find(c=>!c.pass).quantity,'uV');
// Execute a copy with the actual old double-averaging defect reintroduced.
const mutantSources=JSON.parse(fs.readFileSync(path.join(root,'public/report-runtime/report-sources.json'),'utf8'));
const solenoidKey='直螺线管磁场分布的测量/generate.py';
for(const [list,key] of [['dm1_cm_list','dm1_cm'],['dm2_cm_list','dm2_cm']]){
 const before=`"${key}": (${list}[i], u_dm_single_cm)`;assert.ok(mutantSources[solenoidKey].includes(before));
 mutantSources[solenoidKey]=mutantSources[solenoidKey].replace(before,`"${key}": (${list}[i], u_dm_cm)`);
}
fs.writeFileSync(path.join(output,'solenoid-mutant-sources.json'),JSON.stringify(mutantSources));
fs.writeFileSync(path.join(output,'solenoid-mutant-context.json'),run(python,['scripts/context-native-reference.py','--sources','artifacts/science-audit/solenoid-mutant-sources.json']));
const badSolenoid=spawnSync(python,['scripts/science/verify_independent.py','--context','artifacts/science-audit/solenoid-mutant-context.json','--output','artifacts/science-audit/rejected-solenoid-double-average.json'],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
assert.equal(badSolenoid.status,1,'Audit must reject the original double-averaging defect');
const solenoidFailures=JSON.parse(fs.readFileSync(path.join(output,'rejected-solenoid-double-average.json'),'utf8')).checks.filter(c=>!c.pass);
assert.equal(solenoidFailures.length,4);assert.ok(solenoidFailures.every(c=>c.name==='直螺线管磁场分布的测量'));
const mutantContext=JSON.parse(fs.readFileSync(path.join(output,'solenoid-mutant-context.json'),'utf8'));
for(const key of ['RKb_mean','B_exp_center','B0_theory','E_rel'])assert.equal(mutantContext[solenoidFailures[0].id][key],JSON.parse(fs.readFileSync(path.join(output,'python-context.json'),'utf8'))[solenoidFailures[0].id][key]);
console.log(`Independent oracle: CPython ${report.passed}/${report.checks.length}; WASM checked separately; mean and uncertainty unit-error mutations rejected.`);
console.log(run(python,['scripts/science/uncertainty_cases.py','prepare']).trim());
fs.writeFileSync(path.join(output,'python-uncertainty-context.json'),run(python,['scripts/context-native-reference.py','--jobs','artifacts/science-audit/uncertainty-jobs.json']));
console.log(run(python,['scripts/science/uncertainty_cases.py','verify','--context','artifacts/science-audit/python-uncertainty-context.json','--output','artifacts/science-audit/python-uncertainty-results.json']).trim());
run(process.execPath,['scripts/test-calculation-context-runtime.mjs','--jobs','artifacts/science-audit/uncertainty-jobs.json','--output','artifacts/science-audit/wasm-uncertainty-context.json']);
console.log(run(python,['scripts/science/uncertainty_cases.py','verify','--context','artifacts/science-audit/wasm-uncertainty-context.json','--output','artifacts/science-audit/wasm-uncertainty-results.json']).trim());
const wasmReport=JSON.parse(fs.readFileSync(path.join(output,'wasm-independent-results.json'),'utf8'));
const sensitivityPython=JSON.parse(fs.readFileSync(path.join(output,'python-uncertainty-results.json'),'utf8'));
const sensitivityWasm=JSON.parse(fs.readFileSync(path.join(output,'wasm-uncertainty-results.json'),'utf8'));
assert.equal(report.failed+wasmReport.failed+sensitivityPython.failed+sensitivityWasm.failed,0);
fs.writeFileSync(path.join(output,'audit-summary.json'),JSON.stringify({scope:'Simulated independent formula and selected uncertainty checks; no real user data or model requests',version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,reportSourcesSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/report-runtime/report-sources.json'))).digest('hex'),pythonChecks:report.passed,wasmChecks:wasmReport.passed,uncertaintyCases:sensitivityPython.cases,pythonSensitivityChecks:sensitivityPython.passed,wasmSensitivityChecks:sensitivityWasm.passed,deliberateUnitErrorsRejected:2,sharedThicknessErrorRejected:true,solenoidDoubleAverageRejected:true,completeScientificAcceptance:false},null,2));
