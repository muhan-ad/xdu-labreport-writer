import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {patchMobileSources} from './lib/report-source-patches.mjs';
const root = path.resolve(import.meta.dirname, ".."),
  dir = path.join(root, "public/report-runtime");
const guideAudio=JSON.parse(fs.readFileSync(path.join(root,'src/data/guide-audio-manifest.json'),'utf8'));
for(const [name,expected] of Object.entries(guideAudio)){
 if(!['keyboard.wav','config.json','LICENSE.txt','SOURCE.txt'].includes(name))throw Error('音效资源名称无效');
 const bytes=fs.readFileSync(path.join(root,'public/guide-audio',name));
 if(bytes.length!==expected.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('问答音效资源损坏：'+name);
}
const plotFrame=fs.readFileSync(path.join(root,'src/engine/ai-plot-frame.js'),'utf8').replace(/\r\n?/g,'\n');
const plotFrameHash=crypto.createHash('sha256').update(plotFrame).digest('base64');
fs.mkdirSync(path.join(root,'public/ai-plot'),{recursive:true});
fs.writeFileSync(path.join(root,'public/ai-plot/frame.html'),`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src blob: 'sha256-${plotFrameHash}' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; img-src blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>${plotFrame}</script></body></html>`);
fs.copyFileSync(path.join(root,"src/native/report-reader.js"), path.join(root,"android/app/src/main/assets/report-reader.js"));
if (!fs.existsSync(path.join(dir, "manifest.json")))
  throw Error(
    "报告运行资源尚未准备，请先运行 scripts/prepare-report-runtime.py",
  );
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
const sourceCredits=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,'report-sources.json'),'utf8'))['common/credits.json']);
if(JSON.stringify(sourceCredits)!==JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'src/data/credits.json'),'utf8'))))throw Error('内置致谢名单与报告源资源不一致');
for (const [name, entry] of Object.entries(manifest.files)) {
  if (["runner.py", "catalog.json", "chart_preview.py", "insert_chart.py", "ai_plot.py", "variant_edits.py"].includes(name)) continue;
  const bytes = fs.readFileSync(path.join(dir, name));
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw Error("报告运行资源损坏：" + name);
}
const archived=JSON.parse(fs.readFileSync(path.join(dir,'report-sources.json'),'utf8')),patched=patchMobileSources(archived);
if(Object.entries(patched).some(([name,text])=>text!==archived[name]))fs.writeFileSync(path.join(dir,'report-sources.json'),JSON.stringify(patched));
for (const [source, dest] of [
  ["src/engine/runner.py", "runner.py"],
  ["src/data/catalog.json", "catalog.json"],
  ["src/engine/vendor/chart_preview.py", "chart_preview.py"],
  ["src/engine/vendor/insert_chart.py", "insert_chart.py"],
  ["src/engine/vendor/ai_plot.py", "ai_plot.py"],
  ["src/engine/vendor/variant_edits.py", "variant_edits.py"],
])
  fs.copyFileSync(path.join(root, source), path.join(dir, dest));
for (const name of ["report-sources.json", "runner.py", "catalog.json", "package.json", "chart_preview.py", "insert_chart.py", "ai_plot.py", "variant_edits.py"]) {
  const bytes = fs.readFileSync(path.join(dir, name));
  manifest.files[name] = {
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
fs.writeFileSync(
  path.join(dir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  "Verified offline report runtime:",
  Object.keys(manifest.files).length,
  "files",
);

fs.copyFileSync(path.join(root,"src/data/course-aliases.json"),path.join(root,"android/app/src/main/assets/report-aliases.json"));
fs.copyFileSync(path.join(root,"src/native/timetable-reader.js"),path.join(root,"android/app/src/main/assets/timetable-reader.js"));
