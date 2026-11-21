/* Original Python generators run entirely inside this local worker. */
let runtime;
const base = new URL("./report-runtime/", self.location.href).href;
const progress = (text) => self.postMessage({ type: "progress", text });
async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function reportSources(dataPackage, read) {
  if (!dataPackage) return read("report-sources.json");

  // Published data may still supply known generators from before app fixes.
  const legacySources = {
    "common/docx_report.py": "9a800b5cdfbf758790b276193e01c1829138f0d897e1a5658c1d36330f1fa37c",
    "拉伸法测量钢丝杨氏弹性模量/generate.py": "47864a7f9033aebe988b6dcfaf4b821e980987cb736cb1387d0713de81fca2b0",
    "平凸透镜曲率半径的测量/generate.py": "360f1e8aaa941f963e4a61afeb8fedb23af4ff08fd46c1ed645e7ff1f49fd1f5",
    "平凸透镜曲率半径的测量/schema.json": "da7e90a3e3d1d32a4ad32365fb79b03cbd3f39afc80d5fef2a943a3625809276",
    "平凸透镜曲率半径的测量/variants.json": "aeb2644d8442dc85d59810d81527b4a6f5795ee66722ebd76aa9e4d213e75428",
  };
  const replacements = [];
  for (const [name, legacyHash] of Object.entries(legacySources)) {
    const source = dataPackage.sources[name];
    if (typeof source === "string" && await sha256(new TextEncoder().encode(source)) === legacyHash) {
      replacements.push(name);
    }
  }
  if (!replacements.length) return JSON.stringify(dataPackage.sources);
  const bundled = JSON.parse(new TextDecoder().decode(await read("report-sources.json")));
  const sources = { ...dataPackage.sources };
  for (const name of replacements) sources[name] = bundled[name];
  return JSON.stringify(sources);
}

async function initialize(dataPackage, verifyResources) {
  const response = await fetch(base + "manifest.json");
  if (!response.ok) throw Error("内置报告资源缺失：manifest.json");
  const manifest = await response.json();
  const read = async (name) => {
    const response = await fetch(base + name);
    if (!response.ok) throw Error("内置报告资源缺失：" + name);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!verifyResources) return bytes;
    const digest = await sha256(bytes);
    if (digest !== manifest.files[name]?.sha256)
      throw Error("内置报告资源校验失败：" + name);
    return bytes;
  };
  if (verifyResources) {
    progress("正在核对本地报告引擎…");
    for (const name of [
      "pyodide.js",
      "pyodide.asm.js",
      "pyodide.asm.wasm",
      "python_stdlib.zip",
      "pyodide-lock.json",
    ]) await read(name);
  }
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
    if(name==='report-sources.json')py.FS.writeFile('/lab/'+name,await reportSources(dataPackage, read));
    else if(dataPackage&&name==='catalog.json')py.FS.writeFile('/lab/'+name,JSON.stringify(dataPackage.catalog));
    else if(dataPackage&&name==='LabMakerSansSC.ttf')py.FS.writeFile('/lab/'+name,Uint8Array.from(atob(dataPackage.fontBase64),c=>c.charCodeAt(0)));
    else py.FS.writeFile("/lab/" + name, await read(name));
  await py.runPythonAsync(new TextDecoder().decode(await read("runner.py")));
  return py;
}
self.onmessage = async ({ data }) => {
  let py;
  try {
    runtime ??= initialize(data.dataPackage, data.job.mode === 'diagnostic');
    py = await runtime;
    if(data.job.mode==='warmup'){
      self.postMessage({type:'warmup-ready'});
      return;
    }
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
