import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {loadPyodide} from '../public/report-runtime/pyodide.mjs';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'public/report-runtime'),manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'))),py=await loadPyodide({indexURL:runtime+path.sep,stdout:()=>{},stderr:()=>{}});await py.loadPackage(['numpy','matplotlib','lxml','pillow']);const site=py.runPython('import site; site.getsitepackages()[0]');for(const name of manifest.pureWheels)py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(runtime,name))),'zip',{extractDir:site});py.FS.mkdirTree('/lab');for(const name of ['report-sources.json','catalog.json','LabMakerSansSC.ttf'])py.FS.writeFile('/lab/'+name,fs.readFileSync(path.join(runtime,name)));await py.runPythonAsync(fs.readFileSync(path.join(root,'src/engine/runner.py'),'utf8'));
const result=JSON.parse(await py.runPythonAsync(String.raw`
from docx import Document
from lxml import etree
import common.docx_omml as math_module
import common.docx_report as writer_module
old=(math_module.latex_to_omml,writer_module.latex_to_omml)
cap=ReportCopySources();cap.install()
try:
    doc=Document();doc.add_heading('数据处理',1)
    p=doc.add_paragraph('中心结果：')
    p._p.append(etree.fromstring(math_module.latex_to_omml(r'B=2.1\times10^{-3}\mathrm{T}').encode()))
    a=etree.fromstring(math_module.latex_to_omml('x').encode());b=etree.fromstring(math_module.latex_to_omml(r'\mathbf{x}').encode())
    assert cap.signature(a)!=cap.signature(b),'bold vector must retain distinct provenance'
    table=doc.add_table(rows=1,cols=2);table.cell(0,0).text='1.2';table.cell(0,0).add_paragraph('3.4');table.cell(0,1).text='5.6'
    doc.add_heading('思考题',1);doc.add_paragraph('说明实验原理。')
    file=Path('/lab/source-copy-test.docx');doc.save(file)
    digest=hashlib.sha256(file.read_bytes()).hexdigest();sections,issues,coverage=cap.extract(file,['数据处理','思考题'])
    assert r'$B=2.1\times10^{-3}\mathrm{T}$' in sections['analysis'];assert '1.2\n3.4\t5.6' in sections['analysis'];assert not issues;assert coverage=={'total':1,'unmapped':0};assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
    unknown=etree.fromstring(('<m:oMath xmlns:m="'+math_module.M_NS+'"><m:r><m:t>UNKNOWN</m:t></m:r></m:oMath>').encode());p._p.append(unknown);doc.save(file)
    sections,issues,_=cap.extract(file,['数据处理','思考题']);assert 'analysis' not in sections;assert '公式源文未核实' in issues['analysis'];assert 'quiz' in sections
    empty=Document();empty.add_paragraph('个人资料不得作为缺失章节兜底');empty.save(file);sections,issues,_=cap.extract(file,[]);assert not sections;assert len(issues)==2
finally:cap.restore()
assert (math_module.latex_to_omml,writer_module.latex_to_omml)==old
json.dumps({'formulaText':True,'mathStyleDistinct':True,'tableCellParagraphs':True,'noDocumentMutation':True,'unknownFormulaRejected':True,'noFullTextFallback':True,'converterRestored':True})
`));assert.ok(Object.values(result).every(Boolean));const out=path.join(root,'artifacts/verification/report-copy-runtime');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual offline WASM OOXML source reader; synthetic edge cases',checks:result},null,2));console.log(JSON.stringify(result));
