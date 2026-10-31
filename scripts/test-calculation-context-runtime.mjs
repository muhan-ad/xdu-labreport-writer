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
  console.log("Runtime ready", Math.round(performance.now() - started), "ms");

 const samples=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/measurements.json'))),catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'))).experiments;
 const jobsArg=process.argv.indexOf('--jobs'),outputArg=process.argv.indexOf('--output');
 if(jobsArg>=0&&!process.argv[jobsArg+1]||outputArg>=0&&!process.argv[outputArg+1])throw Error('Missing test input/output path');
 const jobs=jobsArg>=0?JSON.parse(fs.readFileSync(path.resolve(root,process.argv[jobsArg+1]),'utf8')):catalog.map(exp=>({...exp,data:samples[exp.id]}));
 const contexts={};for(const exp of jobs){py.globals.set('context_job',JSON.stringify({experimentId:exp.experimentId??exp.id,data:exp.data}));try{const result=JSON.parse(await py.runPythonAsync('calculate_context(context_job)'));assert.ok(!Object.hasOwn(contexts,exp.id),'Duplicate test job');contexts[exp.id]=result.values;console.log(exp.name??exp.id,Object.keys(result.values).length);}catch(e){console.error(String(e));throw e;}}
 const target=path.resolve(root,outputArg>=0?process.argv[outputArg+1]:'artifacts/science-audit/wasm-context.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(contexts));assert.equal(Object.keys(contexts).length,jobs.length);
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
