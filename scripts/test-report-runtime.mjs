import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { loadPyodide } from "../public/report-runtime/pyodide.mjs";
import {Repository} from '../src/domain/repository.ts';
import {reportSectionNames} from '../src/domain/report-sections.ts';
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
  console.log("Runtime ready", Math.round(performance.now() - started), "ms");
  const samples = JSON.parse(
      fs.readFileSync(path.join(root, "tests/fixtures/measurements.json")),
    ),
    catalog = JSON.parse(
      fs.readFileSync(path.join(root, "src/data/catalog.json")),
    ).experiments;
  const option=name=>{const i=process.argv.indexOf(name);if(i<0)return null;if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error('Missing '+name+' value');return process.argv[i+1];};
  const experimentId=option('--experiment');
  const selected = experimentId?catalog.filter(e=>e.id===experimentId):process.argv.includes("--all")
    ? catalog
    : catalog.filter((e) => /直螺线管|凹透镜|电路的稳态/.test(e.sourceId));
  const disableMode=process.argv.includes("--sections");
  assert.ok(selected.length,'No experiments selected');
  const photoFile=option('--photo-file'),withPhoto=process.argv.includes('--photo')||!!photoFile;
  const photo=withPhoto?fs.readFileSync(path.resolve(root,photoFile??'artifacts/report-tests/local-photo.png')).toString('base64'):undefined;
  const storedSections=process.argv.includes('--stored-sections');if(storedSections&&!disableMode)throw Error('--stored-sections requires --sections');
  const settingsFiles=new Map(),settingsStore={read:async key=>settingsFiles.get(key)??null,write:async(key,value)=>{settingsFiles.set(key,value);},remove:async key=>{settingsFiles.delete(key);}};
  const variantCatalog=JSON.parse(fs.readFileSync(path.join(root,"src/data/report-variants.json")));
  const result = [];
  const output = path.resolve(root,option('--output')??(withPhoto?'artifacts/report-tests/with-photo':storedSections?'artifacts/report-tests/stored-sections':disableMode?"artifacts/report-tests/disabled-sections":process.argv.includes("--resource-regression")?"artifacts/report-tests/resource-maintenance":"artifacts/report-tests"));
  assert.ok(output.startsWith(path.join(root,'artifacts')+path.sep),'Output must be inside project artifacts');
  fs.mkdirSync(output, { recursive: true });
  for (const exp of selected) {
    const start = performance.now();
    try {
      let disabledSections=disableMode?Object.keys(variantCatalog[exp.id]):[];
      if(storedSections){const names=reportSectionNames(variantCatalog[exp.id]);await new Repository(settingsStore).saveSectionSwitches(exp.id,names,names,[]);const recovered=await new Repository(settingsStore).loadReportSettings(exp.id);assert.deepEqual(recovered.disabledSections,names);disabledSections=recovered.disabledSections;}
      py.globals.set(
        "mobile_job",
        JSON.stringify({
          experimentId: exp.id,
          data: samples[exp.id],
          profile: {
            name: "移动端验证",
            studentId: "001234",
            className: "测试班",
          },
          date: "2026-10-22",
          seed: 42,
          ...(withPhoto?{photoBase64:photo}:{}),
          options: { variants: {}, disabledSections },
        }),
      );
      const report = JSON.parse(
        await py.runPythonAsync("generate_report(mobile_job)"),
      );
      if(!disableMode)assert.ok(report.formulaCount > 0);
      assert.equal(report.copyMath.total,report.formulaCount);assert.equal(report.copyMath.unmapped,0,'unmapped formulas: '+exp.name);for(const value of Object.values(report.copySections)){assert.ok(value.length<=20000);assert.ok(!value.includes('移动端验证'));}assert.ok(report.copySections.analysis||report.copyIssues.analysis);assert.ok(report.copySections.quiz||report.copyIssues.quiz);
      if(disableMode){const disabled=Object.keys(variantCatalog[exp.id]);for(const paragraph of report.paragraphs){const title=paragraph.replace(/^[一二三四五六七八九十0-9、.（）()\s]+/,'').replace(/^课后思考题$/,'思考题');assert.ok(!disabled.includes(title),'Disabled heading survives: '+exp.name+' '+title);}}
      assert.ok(report.text.includes("移动端验证"));
      py.globals.set('pagination_path',report.path);
      const pagination=JSON.parse(await py.runPythonAsync(`
import xml.etree.ElementTree as pagination_xml
with zipfile.ZipFile(pagination_path) as pagination_zip:
    pagination_doc=pagination_xml.fromstring(pagination_zip.read('word/document.xml'))
pagination_ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
pagination_tables=pagination_doc.findall('.//w:tbl',pagination_ns)
pagination_bad=[]
for pagination_index,pagination_table in enumerate(pagination_tables):
    pagination_rows=pagination_table.findall('./w:tr',pagination_ns)
    if pagination_rows and pagination_rows[0].find('w:trPr/w:tblHeader',pagination_ns) is None:pagination_bad.append('table header '+str(pagination_index))
    if any(row.find('w:trPr/w:cantSplit',pagination_ns) is None for row in pagination_rows):pagination_bad.append('split row '+str(pagination_index))
json.dumps({'tables':len(pagination_tables),'issues':pagination_bad})
`));
      assert.deepEqual(pagination.issues,[],'Pagination flags missing: '+exp.name);
      if(withPhoto){
        py.globals.set('expected_photo',photo);
        assert.equal(py.runPython(`any(hashlib.sha256(content).digest()==hashlib.sha256(prepare_report_photo(base64.b64decode(expected_photo))).digest() for content in (zipfile.ZipFile(pagination_path).read(n) for n in zipfile.ZipFile(pagination_path).namelist() if n.startswith('word/media/')))`),true,'Report-compatible photo must be embedded: '+exp.name);
      }
      fs.writeFileSync(
        path.join(output, exp.id + ".docx"),
        py.FS.readFile(report.path),
      );
      result.push({
        id: exp.id,
        name: exp.name,
        result: "PASS",
        elapsedMs: Math.round(performance.now() - start),
        bytes: report.bytes,
        formulas: report.formulaCount,
        charts: report.charts.length,
        copyScopes:Object.keys(report.copySections),copyIssues:report.copyIssues,copyMath:report.copyMath,
      });
      py.globals.set("finished_job", report.job);
      py.runPython("release_report(finished_job)");
      console.log(result.at(-1));
    } catch (e) {
      result.push({
        id: exp.id,
        name: exp.name,
        result: "FAIL",
        error: String(e),
      });
      console.error(exp.name, String(e));
    }
  }
  fs.writeFileSync(
    path.join(output, "wasm-results.json"),
    JSON.stringify(
      {
        runtime: manifest.runtimeVersion,
        storedSections,
        withPhoto,
        initializationMs: Math.round(performance.now() - started),
        results: result,
      },
      null,
      2,
    ),
  );
  assert.ok(
    result.every((r) => r.result === "PASS"),
    "Some original report generators failed in WASM",
  );
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
