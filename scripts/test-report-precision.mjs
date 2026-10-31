import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const dir=path.resolve('public/report-runtime'),out='artifacts/verification/report-precision-0.92.0';fs.mkdirSync(out,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),py=await loadPyodide({indexURL:dir+path.sep,stdout:()=>{},stderr:s=>console.error(s)});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const f of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir,f))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');for(const f of ['report-sources.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+f,fs.readFileSync(path.join(dir,f)));py.FS.writeFile('/lab/catalog.json',fs.readFileSync('src/data/catalog.json'));await py.runPythonAsync(fs.readFileSync('src/engine/runner.py','utf8').replace(/^\uFEFF/,''));
const direct=JSON.parse(await py.runPythonAsync(`
from common.report_precision import limit_numeric_text
cases=[('1.23456789',False,'1.2346'),('-0.013999999999999999',True,'-0.014'),('1.23456789e-40',True,r'1.2346\\times 10^{-40}'),('2026-10-28',False,'2026-10-28'),('https://example.test/123456789',False,'https://example.test/123456789')]
json.dumps([{'input':s,'output':limit_numeric_text(s, math_mode=m),'expected':e} for s,m,e in cases])
`));for(const x of direct)assert.equal(x.output,x.expected,x.input);
const catalog=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments,samples=JSON.parse(fs.readFileSync('tests/fixtures/measurements.json')),checks=[];
for(const exp of catalog){const before=structuredClone(samples[exp.id]);const job={experimentId:exp.id,data:before,profile:{name:'精度测试',studentId:'001234567890',className:'班级20261028'},date:'2026-10-28',seed:42,options:{variants:{},disabledSections:[]}};py.globals.set('precision_job',JSON.stringify(job));const res=JSON.parse(await py.runPythonAsync('generate_report(precision_job)'));assert.ok(res.formulaCount>0);py.globals.set('precision_path',res.path);const check=JSON.parse(await py.runPythonAsync(`
from xml.etree import ElementTree as ET
import re
with zipfile.ZipFile(precision_path) as archive: precision_xml=ET.fromstring(archive.read('word/document.xml'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','m':'http://schemas.openxmlformats.org/officeDocument/2006/math'}
plain=''.join(n.text or '' for n in precision_xml.findall('.//w:t',ns))
pattern=re.compile(r'(?<![A-Za-z0-9_.])(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?(?![\\d.])')
violations=[]
for node in precision_xml.findall('.//m:t',ns):
 for match in pattern.finditer(node.text or ''):
  literal=match.group(0);significant=re.split('[eE]',literal)[0].replace('.','').lstrip('0')
  if len(significant)>5:violations.append(literal)
math_paragraphs=[''.join(n.text or '' for n in p.findall('.//m:t',ns)) for p in precision_xml.findall('.//w:p',ns)]
json.dumps({'idPreserved':'001234567890' in plain,'classPreserved':'班级20261028' in plain,'datePreserved':'2026-10-28' in plain,'radiusClean':any('0.302' in p and '0.014' in p and '0.013999' not in p for p in math_paragraphs),'violations':violations})
`));assert.equal(check.idPreserved,true,exp.name);assert.equal(check.classPreserved,true,exp.name);assert.equal(check.datePreserved,true,exp.name);assert.deepEqual(check.violations,[],exp.name);if(exp.sourceId==='直螺线管磁场分布的测量'){assert.equal(check.radiusClean,true,'螺线管半径出现浮点尾数');fs.writeFileSync(out+'/solenoid.docx',py.FS.readFile(res.path));}checks.push({id:exp.id,name:exp.name,formulas:res.formulaCount,...check});py.globals.set('finished',res.job);py.runPython('release_report(finished)');}
fs.writeFileSync(out+'/results.json',JSON.stringify({cases:direct,reports:checks.length,checks,scope:'synthetic sample reports; individual Word math text nodes, not merged mathematical structures or scientific correctness'},null,2));console.log(JSON.stringify({direct:direct.length,reports:checks.length,out}));
