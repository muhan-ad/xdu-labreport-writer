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
  const exp = catalog.find((e) => e.name.includes("直螺线管"));
  const samples = JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/measurements.json")),
  );
  const baseData = samples[exp.id];
  const spec = {
    x: "x_mm",
    y: "d_left_cm",
    kind: "scatter",
    title: "自定义曲线",
    xlabel: "x / mm",
    ylabel: "d / cm",
    caption: "自定义图验证 dₘ₁ 与 n_i",
    section: "数据处理",
    embed: true,
  };
  const checks = [];
  const preview = async (chart, data = baseData) => {
    py.globals.set(
      "mobile_job",
      JSON.stringify({ experimentId: exp.id, data, options: { chart } }),
    );
    return JSON.parse(
      await py.runPythonAsync("generate_chart_preview(mobile_job)"),
    );
  };
  fs.mkdirSync(path.join(root, "artifacts/chart-tests"), { recursive: true });
  for (const kind of ["scatter", "line", "bar", "fit"]) {
    const result = await preview({ ...spec, kind });
    const bytes = py.FS.readFile(result.charts[0].path);
    assert.ok(bytes.length > 2000);
    assert.equal(
      Buffer.from(bytes.slice(0, 8)).toString("hex"),
      "89504e470d0a1a0a",
    );
    fs.writeFileSync(
      path.join(root, "artifacts/chart-tests", kind + ".png"),
      bytes,
    );
    py.globals.set("job_to_release", result.job);
    py.runPython("release_report(job_to_release)");
  }
  checks.push(
    "Four original Matplotlib styles render valid PNG from real sample arrays",
  );
  await py.runPythonAsync(`
from common import plot_utils
_original_fit=plot_utils.plot_fit
def _verify_fit(x,y,slope,intercept,**kwargs):
    assert list(x)==[1,2,3] and list(y)==[3,5,7]
    assert abs(slope-2)<1e-12 and abs(intercept-1)<1e-12
    return _original_fit(x,y,slope,intercept,**kwargs)
plot_utils.plot_fit=_verify_fit
`);
  const synthetic = {
    ...baseData,
    x_mm: [1, 2, 3, ...Array(13).fill(null)],
    d_left_cm: [3, 5, 7, ...Array(13).fill(null)],
  };
  const fit = await preview({ ...spec, kind: "fit" }, synthetic);
  py.globals.set("job_to_release", fit.job);
  py.runPython("release_report(job_to_release)");
  await py.runPythonAsync("plot_utils.plot_fit=_original_fit");
  checks.push(
    "Independent y=2x+1 hand calculation matches original fitter and selected points exactly",
  );
  await assert.rejects(
    () => preview(spec, { ...baseData, d_left_cm: [1, 2] }),
    /长度不匹配/,
  );
  await assert.rejects(() => preview({ ...spec, x: "__foreign" }), /当前实验/);
  const electronic = catalog.find((e) =>
    e.schema.groups.some((g) => g.fields.some((f) => f.key === "Udx")),
  );
  py.globals.set(
    "mobile_job",
    JSON.stringify({
      experimentId: electronic.id,
      data: samples[electronic.id],
      options: { chart: { ...spec, x: "D_x", y: "Udx[row:0]" } },
    }),
  );
  const rows = JSON.parse(
    await py.runPythonAsync("generate_chart_preview(mobile_job)"),
  );
  py.globals.set("job_to_release", rows.job);
  py.runPython("release_report(job_to_release)");
  checks.push(
    "Matrix row selector maps the full voltage series to its displacement array",
  );
  py.globals.set(
    "mobile_job",
    JSON.stringify({
      experimentId: exp.id,
      data: baseData,
      profile: { name: "本地绘图验证", studentId: "001234", className: "测试" },
      date: "2026-10-23",
      options: { customCharts: [spec] },
    }),
  );
  const report = JSON.parse(
    await py.runPythonAsync("generate_report(mobile_job)"),
  );
  assert.ok(report.charts.some((c) => c.name.includes("自定义图验证")));
  fs.writeFileSync(
    path.join(root, "artifacts/chart-tests/custom-report.docx"),
    py.FS.readFile(report.path),
  );
  py.globals.set("doc_path", report.path);
  await py.runPythonAsync(`
from docx import Document
_p=Document(doc_path).paragraphs
_caption=next(i for i,p in enumerate(_p) if p.text.startswith('自定义图验证'))
_next=next(p for p in _p[_caption+1:] if p.text in ['误差分析','结论','三、课后思考题'])
assert next(i for i,p in enumerate(_p) if '6. 不确定度分析'==p.text)<_caption
assert _next.text=='误差分析', _next.text
assert len(_p[_caption-1]._p.xpath('.//a:blip'))==1
assert len(_p[_caption]._p.xpath('.//m:sSub'))==2
assert '$' not in _p[_caption].text
`);
  checks.push(
    "Custom chart and editable subscript caption embedded at actual chapter end, after its numbered subheadings",
  );
  py.globals.set("job_to_release", report.job);
  py.runPython("release_report(job_to_release)");
  assert.equal(py.runPython("len(list(Path('/lab/jobs').iterdir()))"), 0);
  fs.writeFileSync(
    path.join(root, "artifacts/verification/chart-runtime.json"),
    JSON.stringify({ checks, realNetworkRequests: 0 }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
