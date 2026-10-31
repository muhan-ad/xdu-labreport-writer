import test from "node:test";
import assert from "node:assert/strict";
import { uniqueReportRow } from "../src/domain/report-upload.ts";
const row = (name, id, score = null) => ({
  fingerprint: id,
  name,
  week: "7",
  time: "T",
  gradeText: score === null ? "未上传" : String(score),
  gradeImage: "",
  imageState: "",
  score,
  status: "未上传",
  canUpload: score === null,
  canPreview: false,
});
const run = async (pages, name, start = 1) => {
  let p = start;
  const state = () => ({
    phase: "ready",
    message: "",
    rows: pages[p - 1],
    page: p,
    pages: pages.length,
  });
  return uniqueReportRow(
    name,
    async () => state(),
    async (d) => {
      p += d;
      return state();
    },
  );
};
test("automatic upload resolves one explicit alias across every page and returns to its exact record", async () => {
  const r = await run(
    [
      [row("其他", "1")],
      [row("冲击法测量直螺线管磁场实验", "2")],
      [row("其他", "3")],
    ],
    "直螺线管磁场分布的测量",
    3,
  );
  assert.equal(r.fingerprint, "2");
});
test("automatic upload refuses duplicate labs, fuzzy names, graded rows and forbidden capabilities", async () => {
  await assert.rejects(
    run(
      [[row("霍尔效应实验", "1")], [row("霍尔效应测量磁场实验", "2")]],
      "霍尔效应实验",
    ),
    /多条/,
  );
  await assert.rejects(
    run([[row("霍尔效应实验附加项目", "1")]], "霍尔效应实验"),
    /没有找到/,
  );
  await assert.rejects(
    run([[row("霍尔效应实验", "1", 0)]], "霍尔效应实验"),
    /已有成绩/,
  );
});
test("page-count drift cannot select a row from a partially scanned changing catalog", async () => {
  await assert.rejects(
    uniqueReportRow(
      "霍尔效应实验",
      async () => ({ phase: "ready", page: 1, pages: 2, rows: [] }),
      async () => ({
        phase: "ready",
        page: 2,
        pages: 3,
        rows: [row("霍尔效应实验", "1")],
      }),
    ),
    /已变化/,
  );
});
