import crypto from 'node:crypto';
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";


import { loadPyodide } from "../public/report-runtime/pyodide.mjs";
async function main() {
  const root = path.resolve(import.meta.dirname, ".."),
    dir = path.join(root, "public/report-runtime");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
  const started = performance.now();
  const py = await loadPyodide({
    indexURL: dir + path.sep,
    stdout: () => {},
    stderr: (s) => console.error(s),
  });
  await py.loadPackage(["numpy", "matplotlib", "lxml", "pillow"]);
  const site = py.runPython("import site; site.getsitepackages()[0]");
  for (const file of manifest.pureWheels)
    py.unpackArchive(
      new Uint8Array(fs.readFileSync(path.join(dir, file))),
      "zip",
      { extractDir: site },
    );
  py.FS.mkdirTree("/lab");
  for (const file of ["report-sources.json", "LabMakerSansSC.ttf"])
    py.FS.writeFile("/lab/" + file, fs.readFileSync(path.join(dir, file)));
  py.FS.writeFile(
    "/lab/catalog.json",
    fs.readFileSync(path.join(root, "src/data/catalog.json")),
  );
  await py.runPythonAsync(
    fs
      .readFileSync(path.join(root, "src/engine/runner.py"), "utf8")
      .replace(/^\uFEFF/, ""),
  );
  for (const file of ["chart_preview.py", "insert_chart.py"])
    py.FS.writeFile(
      "/lab/" + file,
      fs.readFileSync(path.join(root, "src/engine/vendor", file)),
    );
  console.log("Runtime ready", Math.round(performance.now() - started), "ms");
  const catalog = JSON.parse(
    fs.readFileSync(path.join(root, "src/data/catalog.json")),
  ).experiments;

 const samples=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json'))),guides=JSON.parse(fs.readFileSync(path.join(root,'src/data/chart-presets.json')));
 const output=path.join(root,'artifacts/verification/official-presets');fs.mkdirSync(output,{recursive:true});const results=[];
 for(const exp of catalog){const guide=guides[exp.sourceId];if(!guide?.charts.length)continue;
  for(const preset of ['all',...guide.charts.map(c=>c.id)]){
   const job={experimentId:exp.id,data:samples[exp.id],options:{officialCharts:{preset,embed:false,section:'数据处理'}}};
   py.globals.set('mobile_job',JSON.stringify(job));
   try{const preview=JSON.parse(await py.runPythonAsync('generate_chart_preview(mobile_job)'));assert.ok(preview.charts.length>0);if(preset!=='all')assert.equal(preview.charts.length,1);
    for(let i=0;i<preview.charts.length;i++){const bytes=py.FS.readFile(preview.charts[i].path);assert.equal(Buffer.from(bytes.subarray(0,8)).toString('hex'),'89504e470d0a1a0a');if(preset==='all')fs.writeFileSync(path.join(output,exp.id+'-'+i+'.png'),bytes);}
    py.globals.set('finished_job',preview.job);py.runPython('release_report(finished_job)');results.push({experiment:exp.sourceId,preset,count:preview.charts.length,ok:true});
   }catch(error){results.push({experiment:exp.sourceId,preset,ok:false,error:String(error).slice(-1200)});}
   assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"),0,'Temporary job leak');
  }
 }
 const reportResults=[];
 for(const exp of catalog){if(!guides[exp.sourceId]?.charts.length)continue;
  const base={experimentId:exp.id,data:samples[exp.id],profile:{name:'预设验证',studentId:'000000',className:'模拟'},date:'2026-10-24',seed:42,options:{}};
  py.globals.set('mobile_job',JSON.stringify(base));const before=JSON.parse(await py.runPythonAsync('generate_report(mobile_job)'));
  const section=before.headings.find(s=>s==='数据处理')??before.headings[0];
  py.globals.set('test_path',before.path);const count=py.runPython("len(__import__('docx').Document(test_path).inline_shapes)");py.globals.set('finished_job',before.job);py.runPython('release_report(finished_job)');
  base.options={officialCharts:{preset:'all',embed:true,section}};let reportJob; 
  try{py.globals.set('mobile_job',JSON.stringify(base));const after=JSON.parse(await py.runPythonAsync('generate_report(mobile_job)'));reportJob=after.job;py.globals.set('test_path',after.path);
   const actual=py.runPython("len(__import__('docx').Document(test_path).inline_shapes)"),expected=results.find(r=>r.experiment===exp.sourceId&&r.preset==='all').count;
   assert.equal(actual,count+expected);assert.ok(after.formulaCount>0);
   py.globals.set('preview_image_hashes',JSON.stringify(Array.from({length:expected},(_,i)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(output,exp.id+'-'+i+'.png'))).digest('hex'))));
   py.globals.set('expected_headings',JSON.stringify(before.headings));py.globals.set('selected_section',section);
   await py.runPythonAsync(`
from docx import Document
_doc=Document(test_path);_paras=_doc.paragraphs;_headings=json.loads(expected_headings)
_start=next(i for i,p in enumerate(_paras) if section_name(p.text)==section_name(selected_section))
_end=next((i for i in range(_start+1,len(_paras)) if section_name(_paras[i].text) in {section_name(h) for h in _headings}),len(_paras))
_inserted=[]
for _p in _paras[_start+1:_end]:
    for _blip in _p._p.xpath('.//a:blip'):
        _rid=_blip.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        _inserted.append(hashlib.sha256(_doc.part.related_parts[_rid].blob).hexdigest())
# Check insertion against this job's image sequence, then independently assert
# that report rendering matches the corresponding preview byte for byte.
_files=sorted((Path(test_path).parent/'official').glob('official*.png'),key=lambda p:1 if p.stem=='official' else int(p.stem.rsplit('_',1)[1]))
_expected=[hashlib.sha256(p.read_bytes()).hexdigest() for p in _files]
assert _expected==json.loads(preview_image_hashes), 'Preview/report PNG pixels or styles differ'
assert _inserted[-len(_expected):]==_expected, str({'section':selected_section,'actual':_inserted[-len(_expected):],'expected':_expected,'headings':_headings,'start':_start,'end':_end,'positions':[i for i,p in enumerate(_paras) if p._p.xpath('.//a:blip')]})
`);
   fs.writeFileSync(path.join(output,exp.id+'.docx'),py.FS.readFile(after.path));
   py.globals.set('finished_job',after.job);py.runPython('release_report(finished_job)');reportResults.push({experiment:exp.sourceId,section,added:expected,ok:true});
  }catch(error){console.error(exp.sourceId,String(error).slice(-1200));reportResults.push({experiment:exp.sourceId,ok:false,error:String(error).slice(-1000)});}finally{if(reportJob){py.globals.set('finished_job',reportJob);py.runPython('release_report(finished_job)');}}
  assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"),0,'Report job leak');
 }
 const failures=[];
 const rlc=catalog.find(e=>e.sourceId==='RLC电路的稳态特性研究实验');
 for(const item of [{data:{},preset:'all'},{data:samples[rlc.id],preset:'../bad'},{data:samples[rlc.id],preset:'missing'}]){
  py.globals.set('mobile_job',JSON.stringify({experimentId:rlc.id,data:item.data,options:{officialCharts:{preset:item.preset}}}));
  await assert.rejects(py.runPythonAsync('generate_chart_preview(mobile_job)'));assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"),0);failures.push({preset:item.preset,rejected:true});
 }
 py.globals.set('mobile_job',JSON.stringify({experimentId:rlc.id,data:samples[rlc.id],options:{officialCharts:{preset:'all',embed:true,section:'不存在章节'}}}));await assert.rejects(py.runPythonAsync('generate_report(mobile_job)'));assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"),0);failures.push({section:'不存在章节',rejected:true});
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,reportResults,failures},null,2));console.log(JSON.stringify({previews:results.filter(r=>r.ok).length,reports:reportResults.filter(r=>r.ok).length,rejections:failures.length,failed:[...results,...reportResults].filter(r=>!r.ok)}));assert.ok([...results,...reportResults].every(r=>r.ok));
}
main().catch(error=>{console.error(String(error).slice(-1800));process.exitCode=1;});
