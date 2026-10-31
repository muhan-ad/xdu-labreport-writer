import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Repository } from "../src/domain/repository.ts";
import { makeDraft, recordBlank } from "../src/domain/model.ts";
import { ReportGeneration } from "../src/domain/report-generation.ts";
import {
  defaultReportSettings,
  validSavedReport,
  sameReportInputs,
} from "../src/domain/reports.ts";
import { preparationTarget, preparationUrl } from "../src/domain/preparation.ts";
const exp = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog.json", import.meta.url)),
).experiments[0];
const data = new Map();
const store = () => ({
  async read(key) {
    return data.get(key) ?? null;
  },
  async write(key, value) {
    data.set(key, value);
  },
  async remove(key) {
    data.delete(key);
  },
});
const report = () => ({
  version: 1,
  experimentId: exp.id,
  generation: "12345678-1234-1234-1234-123456789abc",
  createdAt: new Date().toISOString(),
  name: "实验报告.docx",
  formulaCount: 64,
  sections: { 实验原理: "已计算" },
  charts: [{ name: "图1", file: "chart-1.png" }],
  snapshot: {
    record: recordBlank(exp),
    profile: { name: "本机", studentId: "001", className: "" },
    photoPath: null,
    settings: defaultReportSettings(),
  },
});
test("manager deletion preserves measurements and report configuration; failed file cleanup remains retryable", async () => {
  data.clear();const repo=new Repository(store()),saved=report(),settings=defaultReportSettings();settings.disabledSections=['实验原理'];
  await repo.load(exp);await repo.saveReportSettings(exp.id,settings);await repo.saveReport(exp,saved);
  const before=[...data].filter(([k])=>!k.startsWith('report-'));
  await assert.rejects(repo.deleteReport(exp,saved.generation,async()=>{throw Error('file unavailable');}),/file unavailable/);
  assert.equal((await repo.loadReport(exp)).value.generation,saved.generation);
  let cleaned=0;await repo.deleteReport(exp,saved.generation,async()=>{cleaned++;});assert.equal(cleaned,1);assert.equal((await repo.loadReport(exp)).value,null);
  assert.deepEqual([...data].filter(([k])=>!k.startsWith('report-')),before);assert.deepEqual(await repo.loadReportSettings(exp.id),settings);
});
test("manager confirmation cannot delete a replaced report; a failed index removal can be retried", async () => {
  data.clear();let fail=false;const backend=store(),repo=new Repository({...backend,async remove(key){if(fail&&key===`report-${exp.id}-b`)throw Error('storage busy');await backend.remove(key);}}),old=report(),newer={...report(),generation:'87654321-1234-1234-1234-123456789abc'};
  await repo.saveReport(exp,old);await repo.saveReport(exp,newer);let cleaned=0;
  await assert.rejects(repo.deleteReport(exp,old.generation,async()=>{cleaned++;}),/报告已变化/);assert.equal(cleaned,0);assert.equal((await repo.loadReport(exp)).value.generation,newer.generation);
  fail=true;await assert.rejects(repo.deleteReport(exp,newer.generation,async()=>{cleaned++;}),/storage busy/);assert.equal((await repo.loadReport(exp)).value.generation,newer.generation);
  fail=false;await repo.deleteReport(exp,newer.generation,async()=>{cleaned++;});assert.equal((await repo.loadReport(exp)).value,null);
});
test("report records reject foreign paths and track exact inputs, date, photo and settings", () => {
  const a = report();
  assert.ok(validSavedReport(exp, a));
  assert.equal(
    validSavedReport(exp, {
      ...a,
      charts: [{ name: "bad", file: "../secret" }],
    }),
    false,
  );
  const b = structuredClone(a.snapshot);
  b.record.updatedAt = "changed";
  assert.ok(sameReportInputs(a.snapshot, b));
  b.record.date = "2025-01-01";
  assert.equal(sameReportInputs(a.snapshot, b), false);
  const c = structuredClone(a.snapshot);
  c.settings.variants.实验原理 = 1;
  assert.equal(sameReportInputs(a.snapshot, c), false);
});
test("report metadata is recoverable in either slot; clear also removes settings but retains measurements", async () => {
  data.clear();
  const r = new Repository(store());
  await r.load(exp);
  await r.save(exp, recordBlank(exp));
  await r.loadReport(exp);
  await r.saveReportSettings(exp.id, defaultReportSettings());
  await r.saveReport(exp, report());
  data.set(`report-${exp.id}-b`, "bad");
  assert.equal((await r.loadReport(exp)).value.generation, report().generation);
  await r.clearReports(exp.id);
  assert.equal((await r.loadReport(exp)).value, null);
  assert.ok(data.has(`record-${exp.id}-a`));
  assert.equal(data.has(`options-${exp.id}-a`), false);
});
test("partial metadata write keeps the published generation addressable; a queued stale save cannot survive clear", async () => {
  data.clear();
  const s = store(),
    r = new Repository(s);
  await r.loadReport(exp);
  let writes = 0;
  const write = s.write;
  s.write = async (k, v) => {
    if (++writes === 2) throw Error("disk full");
    return write(k, v);
  };
  await assert.rejects(r.saveReport(exp, report()), /disk full/);
  assert.equal((await r.loadReport(exp)).value.generation, report().generation);
  s.write = write;
  const pending = r.saveReport(exp, report());
  const clearing = r.clearReports(exp.id);
  await Promise.allSettled([pending, clearing]);
  assert.equal((await r.loadReport(exp)).value, null);
});
test("report publication verifies each copy before overwriting the last usable index", async () => {
  for (const failure of ["first-corrupt","first-noop","second-corrupt"]) {
    data.clear();const backend=store(),old=report(),next={...report(),generation:"87654321-1234-1234-1234-123456789abc"};
    const before=new Repository(backend);await before.saveReport(exp,old);await before.saveReport(exp,old);
    let count=0;
    const faulty={...backend,async write(key,value){count++;if(count===1&&failure==="first-noop")return;if((count===1&&failure==="first-corrupt")||(count===2&&failure==="second-corrupt"))return backend.write(key,"broken");return backend.write(key,value);}};
    const cold=new Repository(faulty); // Cold app start: no prior loadReport call.
    await assert.rejects(cold.saveReport(exp,next),/回读|核实/);
    assert.equal(count,failure.startsWith("first")?1:2);
    const recovered=await new Repository(backend).loadReport(exp);
    assert.equal(recovered.value.generation,failure.startsWith("first")?old.generation:next.generation);
  }
});
test("corrupt report indexes cannot be silently overwritten at publication", async () => {
  data.clear();data.set("report-"+exp.id+"-a","broken");data.set("report-"+exp.id+"-b","broken");
  await assert.rejects(new Repository(store()).saveReport(exp,report()),/报告索引无法读取/);
  assert.equal(data.get("report-"+exp.id+"-a"),"broken");assert.equal(data.get("report-"+exp.id+"-b"),"broken");
});
test("a corrupt index write cannot prune the previous report or the staged report", async () => {
  data.clear();const backend=store(),old=report(),prior=new Repository(backend);await prior.saveReport(exp,old);
  const sample=JSON.parse(fs.readFileSync(new URL("./fixtures/measurements.json",import.meta.url)))[exp.id];
  const record={...recordBlank(exp),draft:makeDraft(exp.schema,sample)},snapshot={record,profile:old.snapshot.profile,photoPath:null,settings:defaultReportSettings()};
  const files=new Set([old.generation]);let staged="",pruned=0;
  const faulty={...backend,async write(key,value){if(key.startsWith("report-"))return backend.write(key,"broken");return backend.write(key,value);}};
  const repo=new Repository(faulty),generator=new ReportGeneration({
    generate:async()=>({docx:new Uint8Array([1,2,3]),charts:[],metadata:{formulaCount:0,sections:{},headings:[]}}),
    cancel:()=>{},photo:async()=>"",plot:async()=>"",stage:async(_id,generation)=>{staged=generation;files.add(generation);return [];},
    publish:(e,saved)=>repo.saveReport(e,saved),remove:async(_id,generation)=>files.delete(generation),
    prune:async()=>{pruned++;files.delete(old.generation);}
  });
  await assert.rejects(generator.run({exp,snapshot,templates:{},photo:null,fresh:async()=>snapshot},new AbortController().signal,()=>{},()=>{}),/回读|核实/);
  assert.equal(pruned,0);assert.ok(files.has(old.generation));assert.ok(files.has(staged));
  assert.equal((await new Repository(backend).loadReport(exp)).value.generation,old.generation);
});
test("preparation shares semester and medium resources; unknown entry opens the official catalog", () => {
  assert.equal(
    preparationUrl("薄透镜焦距的测量（凹透镜）"),
    preparationUrl("薄透镜焦距的测量（凸透镜）"),
  );
  assert.equal(
    preparationUrl("光的偏振特性测量（第一学期）"),
    preparationUrl("光的偏振特性测量（第二学期）"),
  );
  assert.equal(
    preparationUrl("声速的测量（水中）"),
    preparationUrl("声速的测量（空气）"),
  );
  assert.equal(
    preparationUrl("<script>"),
    "https://wlsyzx.xidian.edu.cn/expe/index.html",
  );
  for (const name of ['劈尖干涉', '电子元件伏安特性的测量', '长度与体积的测量']) {
    assert.deepEqual(preparationTarget(name), {url:'https://wlsyzx.xidian.edu.cn/expe/index.html',matched:false});
  }
  assert.equal(preparationTarget('光的偏振特性测量(第二学期)').matched, true);
});
test("export uses a meaningful experiment filename with no repeated suffix or path escape", async () => {
  const { reportFilename, safeReportFilename } = await import(
    "../src/domain/reports.ts"
  );
  assert.equal(
    reportFilename("RLC电路的稳态特性研究实验"),
    "RLC电路的稳态特性研究实验报告.docx",
  );
  assert.equal(
    reportFilename("三棱镜顶角的测量"),
    "三棱镜顶角的测量实验报告.docx",
  );
  assert.ok(!safeReportFilename("../invalid/report.docx").includes("/"));
  assert.ok(!safeReportFilename("a\\report.docx").includes("\\"));
});
test("web preparation does not treat the noopener null return as failure", async () => {
  const { openPreparation } = await import("../src/platform/preparation.ts");
  const old = globalThis.window;
  let target;
  globalThis.window = {
    open: (...args) => {
      target = args;
      return null;
    },
  };
  try {
    await openPreparation("薄透镜焦距的测量（凹透镜）");
    assert.equal(target[0], preparationUrl("薄透镜焦距的测量（凹透镜）"));
    assert.equal(target[2], "noopener,noreferrer");
  } finally {
    if (old === undefined) delete globalThis.window;
    else globalThis.window = old;
  }
});
