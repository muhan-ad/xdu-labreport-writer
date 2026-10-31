import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fields,
  makeDraft,
  convert,
  inspect,
  parseNumber,
  validateDraft,
  validRecord,
  recordBlank,
  resizePoints,
  importMeasurements,
  exportMeasurements,
} from "../src/domain/model.ts";
import { Repository } from "../src/domain/repository.ts";
const experiments = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog.json", import.meta.url)),
).experiments;
const fixtures = JSON.parse(
  fs.readFileSync(new URL("./fixtures/measurements.json", import.meta.url)),
);
const exp = experiments[0];
const store = () => {
  const data = new Map();
  return {
    data,
    async read(k) {
      return data.get(k) ?? null;
    },
    async write(k, v) {
      data.set(k, v);
    },
    async remove(k) {
      data.delete(k);
    },
  };
};
test("28 desktop templates and sample round trips retain values, never prefill measurements", () => {
  assert.equal(experiments.length, 28);
  assert.deepEqual(
    ["mechanics", "optics", "electromagnetism", "other"].map(
      (c) => experiments.filter((e) => e.category === c).length,
    ),
    [4, 10, 10, 4],
  );
  for (const e of experiments) {
    const empty = convert(e.schema, makeDraft(e.schema));
    assert.equal(empty.issues.length, 0);
    assert.ok(
      Object.values(empty.data)
        .flat(2)
        .every((x) => x === null),
      e.name,
    );
    const draft = importMeasurements(e, fixtures[e.id]);
    assert.ok(validateDraft(e.schema, draft), e.name);
    assert.deepEqual(inspect(e.schema, draft), [], e.name);
    const record = { ...recordBlank(e), draft };
    assert.deepEqual(
      importMeasurements(
        e,
        exportMeasurements(e, record, {
          name: "",
          studentId: "",
          className: "",
        }),
      ),
      draft,
    );
  }
});
test("strict numbers preserve zero and precision; reject malformed, infinity and underflow", () => {
  assert.equal(parseNumber("0"), 0);
  assert.equal(parseNumber(" １.２３ "), 1.23);
  assert.equal(parseNumber("2.7e-9"), 2.7e-9);
  assert.equal(parseNumber("1.23456789123456"), 1.23456789123456);
  assert.equal(parseNumber(""), null);
  for (const x of [
    "NaN",
    "Infinity",
    "0x10",
    "1e-",
    "1e999",
    "1e-999",
    "2 + 3",
  ])
    assert.throws(() => parseNumber(x), x);
  const e = experiments.find((e) =>
      fields(e.schema).some((f) => f.type === "science"),
    ),
    f = fields(e.schema).find((f) => f.type === "science");
  const d = makeDraft(e.schema);
  d[f.key] = { mantissa: "2.7", exponent: "-9" };
  assert.equal(convert(e.schema, d).data[f.key], 2.7e-9);
  assert.deepEqual(f.expSuggestions, [-6, -7, -8, -9, -10, -11, -12]);
  d[f.key].exponent = "";
  assert.ok(inspect(e.schema, d, false).some((i) => i.key === f.key));
});
test("paired electronic-deflection arrays resize together, preserve values and clear completely", () => {
  const e = experiments.find((e) =>
    fields(e.schema).some((f) => f.pairedMatrix),
  );
  const f = fields(e.schema).find((f) => f.pairedMatrix);
  let d = makeDraft(e.schema);
  const n = d[f.key].length;
  d[f.key][0] = "0";
  d[f.pairedMatrix][0][0] = "2";
  for (let i = 0; i < 15; i++) d = resizePoints(e.schema, d, f.key, 1);
  assert.equal(d[f.key].length, n + 15);
  assert.ok(d[f.pairedMatrix].every((r) => r.length === n + 15));
  for (let i = 0; i < 15; i++) d = resizePoints(e.schema, d, f.key, -1);
  assert.equal(d[f.key][0], "0");
  assert.equal(d[f.pairedMatrix][0][0], "2");
  assert.ok(validateDraft(e.schema, d));
  const bad = structuredClone(d);
  bad[f.pairedMatrix][0].pop();
  assert.equal(validateDraft(e.schema, bad), false);
  assert.throws(() => importMeasurements(e, { [f.key]: [1] }));
  assert.ok(
    Object.values(convert(e.schema, recordBlank(e).draft).data)
      .flat(2)
      .every((v) => v === null),
  );
});
test("solenoid legacy units convert once; foreign experiment and malformed record rejected", () => {
  const e = experiments.find((e) =>
    fields(e.schema).some((f) => f.key === "I_mA"),
  );
  assert.ok(e);
  const d = importMeasurements(e, { I_A: 0.117, r0_m: 0.014 });
  const v = convert(e.schema, d).data;
  assert.equal(v.I_mA, 117);
  assert.equal(v.r0_cm, 1.4);
  assert.equal(
    validRecord(e, { ...recordBlank(e), date: "2026-02-30" }),
    false,
  );
  assert.throws(() =>
    importMeasurements(e, {
      format: "lab-maker-measurements",
      version: 1,
      experiment: "other",
      data: { I_mA: 117 },
    }),
  );
});
test("queued saves and reset do not resurrect old measurements; profile and other experiment survive", async () => {
  const s = store(),
    r = new Repository(s);
  await r.load(exp);
  const d = recordBlank(exp);
  const f = fields(exp.schema).find((f) => f.type === "number");
  d.draft[f.key] = "1e-";
  await r.save(exp, d);
  assert.equal((await r.load(exp)).record.draft[f.key], "1e-");
  await r.saveProfile({ name: "本地学生", studentId: "001", className: "A" });
  const other = experiments[1];
  await r.load(other);
  await r.save(other, recordBlank(other));
  const saves = [r.save(exp, d), r.save(exp, d)];
  const reset = r.reset(exp, async () => {});
  const results = await Promise.allSettled([...saves, reset]);
  for (const result of results.slice(0, 2)) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /测量数据已变化/);
  }
  assert.equal(results[2].status, 'fulfilled');
  const loaded = await r.load(exp);
  assert.deepEqual(loaded.record.draft, makeDraft(exp.schema));
  assert.equal((await r.loadProfile()).studentId, "001");
  assert.ok(s.data.has(`record-${other.id}-a`));
  for (const slot of ["a", "b"])
    assert.deepEqual(
      JSON.parse(s.data.get(`record-${exp.id}-${slot}`)).payload.draft,
      makeDraft(exp.schema),
    );
});
test("corrupt slot falls back; both corrupt block writes until explicit reset", async () => {
  const s = store(),
    r = new Repository(s);
  await r.load(exp);
  await r.save(exp, recordBlank(exp));
  await r.save(exp, recordBlank(exp));
  s.data.set(`record-${exp.id}-b`, "broken");
  assert.match((await r.load(exp)).warning, /副本异常/);
  s.data.set(`record-${exp.id}-a`, "broken");
  await assert.rejects(r.load(exp), /损坏/);
  assert.equal(s.data.get(`record-${exp.id}-a`), "broken");
  await r.reset(exp, async () => {});
  assert.equal((await r.load(exp)).warning, "");
});
test('interrupted clear restores the old record after a new repository starts',async()=>{
 const backend=store(),original=recordBlank(exp),field=fields(exp.schema).find(f=>f.type==='number');original.draft[field.key]='37.5';await new Repository(backend).save(exp,original);
 let writes=0;const faulty={...backend,write:async(k,v)=>{if(k.startsWith(`record-${exp.id}-`)&&++writes===2)return;await backend.write(k,v);}};
 await assert.rejects(new Repository(faulty).reset(exp,async()=>{}),/保存未能核实/);
 const restored=await new Repository(backend).load(exp);assert.equal(restored.record.draft[field.key],'37.5');assert.match(restored.warning,/清除未完成/);
 for(const slot of ['a','b'])assert.equal(JSON.parse(backend.data.get(`record-${exp.id}-${slot}`)).payload.draft[field.key],'37.5');
 assert.equal([...backend.data.keys()].some(k=>k.startsWith(`reset-journal-${exp.id}-`)),false);
 await new Repository(backend).reset(exp,async()=>{});assert.deepEqual((await new Repository(backend).load(exp)).record.draft,makeDraft(exp.schema));
});
test('failed interrupted-clear recovery retains its journal for retry',async()=>{
 const backend=store(),original=recordBlank(exp),field=fields(exp.schema).find(f=>f.type==='number');original.draft[field.key]='9.5';await new Repository(backend).save(exp,original);
 let writes=0;const first={...backend,write:async(k,v)=>{if(k.startsWith(`record-${exp.id}-`)&&++writes===2)return;await backend.write(k,v);}};await assert.rejects(new Repository(first).reset(exp,async()=>{}));
 const retryFault={...backend,write:async(k,v)=>{if(k.startsWith(`record-${exp.id}-`))throw Error('storage unavailable');await backend.write(k,v);}};
 await assert.rejects(new Repository(retryFault).load(exp),/storage unavailable/);assert.ok([...backend.data.keys()].some(k=>k.startsWith(`reset-journal-${exp.id}-`)));
 assert.equal((await new Repository(backend).load(exp)).record.draft[field.key],'9.5');
});
test('committed reset is not undone if journal removal is interrupted',async()=>{
 const backend=store(),original=recordBlank(exp),field=fields(exp.schema).find(f=>f.type==='number');original.draft[field.key]='11';await new Repository(backend).save(exp,original);
 const faulty={...backend,remove:async(k)=>{if(k.startsWith(`reset-journal-${exp.id}-`))throw Error('remove failed');await backend.remove(k);}};
 await assert.rejects(new Repository(faulty).reset(exp,async()=>{}),/remove failed/);
 assert.deepEqual((await new Repository(backend).load(exp)).record.draft,makeDraft(exp.schema));
 assert.equal([...backend.data.keys()].some(k=>k.startsWith(`reset-journal-${exp.id}-`)),false);
});
test("storage failure propagates and retry succeeds; photo path traversal rejected", async () => {
  const s = store(),
    r = new Repository(s);
  await r.load(exp);
  const write = s.write;
  s.write = async () => {
    throw Error("disk full");
  };
  await assert.rejects(r.save(exp, recordBlank(exp)), /disk full/);
  s.write = write;
  await r.save(exp, recordBlank(exp));
  assert.ok((await r.load(exp)).record);
  await r.savePhoto(exp.id, {
    path: `photos/${exp.id}/abcd-1234.png`,
    mime: "image/png",
    name: "原图",
  });
  assert.ok(await r.loadPhoto(exp.id));
  await assert.rejects(r.savePhoto(exp.id, {
    path: "../../secret",
    mime: "image/png",
    name: "bad",
  }),/照片信息无效/);
  s.data.set('photo-'+exp.id+'-a','broken');
  s.data.set('photo-'+exp.id+'-b','broken');
  await assert.rejects(r.loadPhoto(exp.id), /损坏/);
});
test("photo index is verified before replacing the last usable copy",async()=>{
 for(const mode of ['first-corrupt','first-noop','second-corrupt']){
  const backend=store(),old={path:'photos/'+exp.id+'/abcd-1234.png',mime:'image/png',name:'旧照片'},next={path:'photos/'+exp.id+'/abcd-5678.png',mime:'image/png',name:'新照片'};
  const first=new Repository(backend);await first.savePhoto(exp.id,old);await first.savePhoto(exp.id,old);
  let writes=0;const faulty={...backend,async write(k,v){writes++;if(writes===1&&mode==='first-noop')return;if((writes===1&&mode==='first-corrupt')||(writes===2&&mode==='second-corrupt'))return backend.write(k,'broken');return backend.write(k,v);}};
  const restarted=new Repository(faulty);await assert.rejects(restarted.savePhoto(exp.id,next),/核实|回读/);
  assert.equal(writes,mode.startsWith('first')?1:2);const restored=await new Repository(backend).loadPhoto(exp.id);
  assert.equal(restored.path,mode.startsWith('first')?old.path:next.path);
 }
});
test("student profile writes verify each copy and preserve a recoverable version on faults",async()=>{
 const old={name:'旧姓名',studentId:'001234',className:'原班'},next={name:'新姓名',studentId:'001234',className:'新班'};
 for(const mode of ['first-corrupt','first-noop','second-corrupt']){
  const backend=store();await new Repository(backend).saveProfile(old);let writes=0;
  const faulty={...backend,async write(k,v){writes++;if(writes===1&&mode==='first-noop')return;if((writes===1&&mode==='first-corrupt')||(writes===2&&mode==='second-corrupt'))return backend.write(k,'broken');return backend.write(k,v);}};
  await assert.rejects(new Repository(faulty).saveProfile(next),/保存未能核实/);assert.equal(writes,mode.startsWith('first')?1:2);
  assert.deepEqual(await new Repository(backend).loadProfile(),mode.startsWith('first')?old:next);
  await new Repository(backend).saveProfile(next);assert.deepEqual(await new Repository(backend).loadProfile(),next);
 }
});
test("OCR student merge also verifies each copy before replacing the remaining old profile",async()=>{
 const old={name:'原姓名',studentId:'001234',className:'原班'},backend=store();await new Repository(backend).saveProfile(old);let writes=0;
 const faulty={...backend,async write(k,v){writes++;if(writes===1)return backend.write(k,'broken');return backend.write(k,v);}};
 await assert.rejects(new Repository(faulty).mergeOCRProfile({name:'新姓名'},old),/保存未能核实/);assert.equal(writes,1);assert.deepEqual(await new Repository(backend).loadProfile(),old);
});
test("measurement saves detect silent corruption without destroying the last confirmed copy",async()=>{
 for(const mode of ['first-noop','first-corrupt','second-corrupt']){
  const backend=store(),old=recordBlank(exp),next=structuredClone(old);const field=exp.schema.groups.flatMap(g=>g.fields).find(f=>f.type==='number');assert.ok(field);old.draft[field.key]='1';next.draft[field.key]='2';await new Repository(backend).save(exp,old);
  let writes=0;const faulty={...backend,async write(k,v){writes++;if(writes===1&&mode==='first-noop')return;if((writes===1&&mode==='first-corrupt')||(writes===2&&mode==='second-corrupt'))return backend.write(k,'broken');return backend.write(k,v);}};
  await assert.rejects(new Repository(faulty).save(exp,next),/保存未能核实/);assert.equal(writes,mode==='second-corrupt'?2:1);
  assert.equal((await new Repository(backend).load(exp)).record.draft[field.key],mode==='second-corrupt'?'2':'1');
  await new Repository(backend).save(exp,next);assert.equal((await new Repository(backend).load(exp)).record.draft[field.key],'2');
 }
});
test("measurement reset does not claim success when blank record cannot be verified",async()=>{
 const backend=store(),old=recordBlank(exp),field=exp.schema.groups.flatMap(g=>g.fields).find(f=>f.type==='number');old.draft[field.key]='7';await new Repository(backend).save(exp,old);let writes=0,cleaned=false;
 backend.data.set('ocr-'+exp.id+'-a','previous OCR draft');backend.data.set('ocr-'+exp.id+'-b','backup OCR draft');
 const faulty={...backend,async write(k,v){if(k.startsWith('record-')){writes++;return;}return backend.write(k,v);}};
 await assert.rejects(new Repository(faulty).reset(exp,async()=>{cleaned=true;}),/保存未能核实/);assert.equal(writes,1);assert.equal(cleaned,false);assert.equal((await new Repository(backend).load(exp)).record.draft[field.key],'7');assert.equal(backend.data.get('ocr-'+exp.id+'-a'),'previous OCR draft');assert.equal(backend.data.get('ocr-'+exp.id+'-b'),'backup OCR draft');
});
test("transient measurement read errors do not clear OCR drafts or write blank records",async()=>{
 const backend=store(),old=recordBlank(exp),field=exp.schema.groups.flatMap(g=>g.fields).find(f=>f.type==='number');old.draft[field.key]='7';await new Repository(backend).save(exp,old);backend.data.set('ocr-'+exp.id+'-a','preserved draft');let writes=0;
 const faulty={...backend,async read(k){if(k.startsWith('record-'))throw Error('存储暂不可读');return backend.read(k);},async write(k,v){if(k.startsWith('record-'))writes++;return backend.write(k,v);}};
 await assert.rejects(new Repository(faulty).reset(exp,async()=>{}),/存储暂不可读/);assert.equal(writes,0);assert.equal(backend.data.get('ocr-'+exp.id+'-a'),'preserved draft');assert.equal((await new Repository(backend).load(exp)).record.draft[field.key],'7');
});
