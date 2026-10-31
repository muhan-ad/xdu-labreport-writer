/* Original Python generators run entirely inside this local worker. */
let runtime;
const base = new URL("./report-runtime/", self.location.href).href;
const progress = (text) => self.postMessage({ type: "progress", text });
async function initialize(dataPackage) {
  const manifest = await (await fetch(base + "manifest.json")).json();
  const read = async (name) => {
    const response = await fetch(base + name);
    if (!response.ok) throw Error("内置报告资源缺失：" + name);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== manifest.files[name]?.sha256)
      throw Error("内置报告资源校验失败：" + name);
    return bytes;
  };
  progress("正在核对本地报告引擎…");
  for (const name of [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ])
    await read(name);
  importScripts(base + "pyodide.js");
  const py = await loadPyodide({
    indexURL: base,
    stdout: () => {},
    stderr: () => {},
  });
  progress("正在载入计算、绘图与公式组件…");
  await py.loadPackage(["numpy", "matplotlib", "lxml", "pillow"]);
  const site = py.runPython("import site; site.getsitepackages()[0]");
  for (const name of manifest.pureWheels)
    py.unpackArchive(await read(name), "zip", { extractDir: site });
  py.FS.mkdirTree("/lab");
  for (const name of [
    "report-sources.json",
    "LabMakerSansSC.ttf",
    "catalog.json",
    "chart_preview.py",
    "insert_chart.py",
    "ai_plot.py",
    "variant_edits.py",
  ])
    if(dataPackage&&name==='report-sources.json')py.FS.writeFile('/lab/'+name,JSON.stringify(dataPackage.sources));
    else if(dataPackage&&name==='catalog.json')py.FS.writeFile('/lab/'+name,JSON.stringify(dataPackage.catalog));
    else if(dataPackage&&name==='LabMakerSansSC.ttf')py.FS.writeFile('/lab/'+name,Uint8Array.from(atob(dataPackage.fontBase64),c=>c.charCodeAt(0)));
    else py.FS.writeFile("/lab/" + name, await read(name));
  await py.runPythonAsync(new TextDecoder().decode(await read("runner.py")));
  return py;
}
self.onmessage = async ({ data }) => {
  let py;
  try {
    runtime ??= initialize(data.dataPackage);
    py = await runtime;
    if(data.job.mode==='diagnostic'){
      progress('正在核对全部实验脚本与模板…');
      const diagnostic=JSON.parse(await py.runPythonAsync('diagnose_runtime()'));
      self.postMessage({type:'diagnostic-result',diagnostic});
      return;
    }
    if(data.job.mode==='context'){
      progress('正在核对本次计算结果…');
      py.globals.set('mobile_job',JSON.stringify(data.job));
      const context=JSON.parse(await py.runPythonAsync('calculate_context(mobile_job)'));
      self.postMessage({type:'context-result',context});
      return;
    }
    const plot = data.job.mode === "plot";
    progress(plot ? "正在按测量数据绘图…" : "正在计算并生成 Word 报告…");
    py.globals.set("mobile_job", JSON.stringify(data.job));
    const meta = JSON.parse(
      await py.runPythonAsync(
        plot
          ? "generate_chart_preview(mobile_job)"
          : "generate_report(mobile_job)",
      ),
    );
    const docx = plot ? new Uint8Array() : py.FS.readFile(meta.path).slice();
    const charts = meta.charts.map((image) => ({
      name: image.name,
      bytes: py.FS.readFile(image.path).slice(),
    }));
    py.globals.set("finished_job", meta.job);
    py.runPython("release_report(finished_job)");
    self.postMessage(
      {
        type: "result",
        docx,
        charts,
        metadata: {
          name: meta.name,
          formulaCount: meta.formulaCount,
          sections: meta.sections,
          copySections: meta.copySections,
          copyIssues: meta.copyIssues,
          headings: meta.headings,
          log: meta.log,
        },
      },
      [docx.buffer, ...charts.map((i) => i.bytes.buffer)],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: String(error.message || error)
        .trim()
        .split("\n")
        .filter(Boolean)
        .at(-1)
        .slice(-1500),
    });
  } finally {
    if (py) {
      py.globals.delete('mobile_job');
      py.globals.delete('finished_job');
    }
  }
};
