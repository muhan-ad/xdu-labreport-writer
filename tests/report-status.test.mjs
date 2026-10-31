import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DOMParser } from "linkedom";
import {
  numericReportScore,
  parseSchoolReports,
  applyReportRecognition,
} from "../src/domain/report-status.ts";
test("report score accepts zero/fullwidth decimals, rejects ambiguous, nonfinite and out-of-range text", () => {
  assert.equal(numericReportScore("４．５ 分"), 4.5);
  assert.equal(numericReportScore("0"), 0);
  for (const v of ["4.5已上传", "101", "-1", "1e2", "NaN", "4.567"])
    assert.equal(numericReportScore(v), null);
});
test("native report mapping keeps text authoritative, restricts images and never permits uploading a graded row", () => {
  const base = {
    fingerprint: '[1,7,"T","实验"]',
    name: "实验",
    week: "7",
    time: "T",
    gradeText: "4.5",
    gradeImage: "https://evil/image.png",
    canUpload: true,
  };
  const row = parseSchoolReports({ phase: "ready", rows: [base] }).rows[0];
  assert.equal(row.score, 4.5);
  assert.equal(row.gradeImage, "");
  assert.equal(row.canUpload, false);
  assert.equal(
    applyReportRecognition(row, { score: 99, status: "已上传" }).score,
    4.5,
  );
  const picture = { ...row, gradeText: "", score: null };
  assert.equal(
    applyReportRecognition(picture, { status: "已上传" }).status,
    "已上传",
  );
  assert.equal(applyReportRecognition(picture, { score: 101 }).score, null);
  assert.throws(() =>
    parseSchoolReports({ phase: "ready", rows: [{ name: "missing key" }] }),
  );
  assert.throws(() =>
    parseSchoolReports({ phase: "ready", page: 3, pages: 2, rows: [] }),
  );
});
const source = fs.readFileSync("src/native/report-reader.js", "utf8");
function fixture() {
  const actions = [],
    record = {
      get: (k) =>
        ({ id: "r", 0: "7", 1: "周四晚上", 2: "霍尔效应实验", 3: "已上传" })[k],
    };
  const store = {
    currentPage: 1,
    getTotalCount: () => 2,
    getPageSize: () => 1,
    getRange: () => [record],
    isLoading: () => false,
    nextPage: () => actions.push("next"),
    previousPage: () => actions.push("previous"),
    reload: () => actions.push("reload"),
  };
  const grid = {
    getColumns: () =>
      ["0", "1", "2", "3"]
        .map((dataIndex) => ({ dataIndex }))
        .concat({
          xtype: "actioncolumn",
          items: [{ tooltip: "上传" }, { tooltip: "报告预览" }],
        }),
    getStore: () => store,
    getView: () => ({
      getNode: () => ({
        querySelector: () => ({
          classList: { contains: () => false },
          getClientRects: () => [{}],
        }),
      }),
    }),
  };
  class Parser {
    parseFromString(raw) {
      return new DOMParser().parseFromString(
        "<html><head></head><body>" + raw + "</body></html>",
        "text/html",
      );
    }
  }
  const context = vm.createContext({
    URL,
    Map,
    DOMParser: Parser,
    location: {
      origin: "http://wlsy.xidian.edu.cn",
      pathname: "/wgyreport/wgyreport.dll/",
    },
    Ext: { ComponentQuery: { query: (q) => (q === "grid" ? [grid] : []) } },
  });
  vm.runInContext(source, context);
  return {
    context,
    actions,
    run: (command, payload = {}) =>
      JSON.parse(
        JSON.stringify(
          context.labReportReader(
            command,
            payload,
            "http://wlsy.xidian.edu.cn",
          ),
        ),
      ),
  };
}
test("report adapter matches observed grid fields and only exposes read, page and refresh, with bounded pages", () => {
  const f = fixture(),
    state = f.run("read");
  assert.equal(state.rows[0].name, "霍尔效应实验");
  assert.equal(state.rows[0].gradeText, "已上传");
  assert.equal(state.rows[0].canUpload, true);
  f.run("page", { direction: 1 });
  f.run("refresh");
  assert.deepEqual(f.actions, ["next", "reload"]);
  for (const action of ["upload", "row", "button", "file-input"])
    assert.equal(f.run(action).phase, "error");
  assert.equal(f.run("page", { direction: -1 }).phase, "error");
});
test("foreign report pages and ambiguous grids never expose rows or trigger operations", () => {
  const f = fixture();
  f.context.location.origin = "https://evil.example";
  assert.equal(
    f.run("login", { account: "mock", password: "mock" }).phase,
    "error",
  );
  assert.deepEqual(f.actions, []);
  f.context.location.origin = "http://wlsy.xidian.edu.cn";
  const query = f.context.Ext.ComponentQuery.query;
  f.context.Ext.ComponentQuery.query = (q) =>
    q === "grid" ? [...query(q), ...query(q)] : [];
  assert.equal(f.run("read").phase, "error");
  assert.equal(f.run("page", { direction: 1 }).phase, "error");
  assert.deepEqual(f.actions, []);
});
