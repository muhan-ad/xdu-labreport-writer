import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const dir=path.resolve('public/report-runtime'),out='artifacts/report-tests/sound-average-error';fs.mkdirSync(out,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),py=await loadPyodide({indexURL:dir+path.sep,stdout:()=>{},stderr:s=>console.error(s)});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const f of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir,f))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');for(const f of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+f,fs.readFileSync(path.join(dir,f)));py.FS.writeFile('/lab/catalog.json',fs.readFileSync('src/data/catalog.json'));await py.runPythonAsync(fs.readFileSync('src/engine/runner.py','utf8').replace(/^\uFEFF/,''));
const jobs=JSON.parse(fs.readFileSync('artifacts/science-audit/sound-average-error/jobs.json')),results=[];
for(const j of jobs.filter(x=>x.id.endsWith('-alternating'))){py.globals.set('job',JSON.stringify({experimentId:j.experimentId,data:j.data,profile:{name:'测试',studentId:'',className:''},date:'2026-10-28',seed:42,options:{variants:{},disabledSections:[]}}));const result=JSON.parse(await py.runPythonAsync('generate_report(job)'));assert.ok(result.formulaCount>0);assert.equal(result.copyMath.unmapped,0);py.globals.set('doc_path',result.path);const conclusion=JSON.parse(await py.runPythonAsync(`
from xml.etree import ElementTree as ET
with zipfile.ZipFile(doc_path) as archive: root=ET.fromstring(archive.read('word/document.xml'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
parts=[];active=False
for p in root.findall('.//w:p',ns):
 text=''.join(n.text or '' for n in p.iter() if n.tag in ('{'+ns['w']+'}t','{'+ns['m']+'}t'))
 if '由测量数据计算得' in text: active=True
 if active: parts.append(text)
 if active and ('%。' in text or '%。' in text or '％。' in text): break
json.dumps([''.join(parts)],ensure_ascii=False)
`));assert.equal(conclusion.length,1,j.id);const target=j.expected<1e-8?'0.00':'15.00';assert.ok(conclusion[0].includes(target),j.id+': '+conclusion[0]);fs.writeFileSync(path.join(out,j.id+'.docx'),py.FS.readFile(result.path));results.push({id:j.id,conclusion:conclusion[0]});py.globals.set('finished',result.job);py.runPython('release_report(finished)');}
for(const j of [jobs[0],jobs[4]]){py.globals.set('key',j.sourceId+'/generate.py');py.runPython("saved=SOURCES[key];SOURCES[key]=saved.replace('# MOBILE_SOUND_AVG_ERROR_V1','# old')");py.globals.set('job',JSON.stringify({experimentId:j.experimentId,data:j.data,profile:{},date:'',options:{}}));try{await assert.rejects(()=>py.runPythonAsync('generate_report(job)'),/尚未修正平均声速误差/);await assert.rejects(()=>py.runPythonAsync('calculate_context(job)'),/尚未修正平均声速误差/);}finally{py.runPython('SOURCES[key]=saved');}}
fs.writeFileSync(out+'/results.json',JSON.stringify({results,oldPackagesRejected:4},null,2));console.log(JSON.stringify({reports:results.length,oldPackagesRejected:4,out}));
