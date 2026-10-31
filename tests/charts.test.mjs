import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  chartFields,
  chartValues,
  validateChart,
  validChartSpec,
} from "../src/domain/charts.ts";
import {
  defaultReportSettings,
  validReportSettings,
  sameReportInputs,
} from "../src/domain/reports.ts";
const catalog = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog.json", import.meta.url)),
).experiments;
const samples = JSON.parse(
  fs.readFileSync(new URL("./fixtures/measurements.json", import.meta.url)),
);
const solenoid = catalog.find((e) => e.name.includes("直螺线管"));
const electronic = catalog.find((e) =>
  e.schema.groups.some((g) => g.fields.some((f) => f.key === "Udx")),
);
const spec = {
  x: "x_mm",
  y: "d_left_cm",
  kind: "scatter",
  title: "",
  xlabel: "",
  ylabel: "",
  caption: "",
  section: "数据处理",
  embed: false,
};
test("chart selectors expose arrays and actual matrix rows/columns without inventing readings", () => {
  const data = structuredClone(samples[electronic.id]);
  const original = structuredClone(data);
  assert.deepEqual(chartValues(data, "Udx[row:0]"), data.Udx[0]);
  assert.deepEqual(
    chartValues(data, "Udx[1]"),
    data.Udx.map((row) => row[1]),
  );
  assert.ok(chartFields(electronic, data).some((f) => f.key === "Udx[row:0]"));
  data.Udx.forEach((row) => row.push(5));
  assert.ok(chartFields(electronic, data).some((f) => f.key === "Udx[9]"));
  assert.equal(original.Udx[0].length, 9);
});
test("chart validation preserves raw precision/zero, skips paired blanks and rejects one-sided or invalid values", () => {
  const data = {
    ...samples[solenoid.id],
    x_mm: [0, 1.123456789, null],
    d_left_cm: [2, 3.987654321, null],
  };
  assert.deepEqual(validateChart(solenoid, data, spec), [
    [0, 2],
    [1.123456789, 3.987654321],
  ]);
  assert.throws(
    () =>
      validateChart(solenoid, { ...data, d_left_cm: [2, null, null] }, spec),
    /第 2 行/,
  );
  assert.throws(
    () =>
      validateChart(
        solenoid,
        { ...data, d_left_cm: [2, Infinity, null] },
        spec,
      ),
    /有限数值/,
  );
  assert.throws(
    () => validateChart(solenoid, { ...data, d_left_cm: [2, 3] }, spec),
    /长度不匹配/,
  );
  assert.throws(
    () =>
      validateChart(
        solenoid,
        { ...data, x_mm: [null, null, null], d_left_cm: [null, null, null] },
        spec,
      ),
    /至少需要/,
  );
  assert.throws(
    () => validateChart(solenoid, data, { ...spec, x: "foreign" }),
    /当前实验/,
  );
});
test("linear fit rejects degenerate X independently of chart style", () => {
  const data = { ...samples[solenoid.id], x_mm: [0, 0], d_left_cm: [1, 2] };
  assert.equal(validateChart(solenoid, data, spec).length, 2);
  assert.throws(
    () => validateChart(solenoid, data, { ...spec, kind: "fit" }),
    /不同的 X/,
  );
  assert.equal(validChartSpec({ ...spec, kind: "execute" }), false);
  assert.equal(validChartSpec({ ...spec, title: "x".repeat(201) }), false);
});
test("saved chart settings validate limits and participate in report snapshot identity", () => {
  const settings = { ...defaultReportSettings(), customCharts: [spec] };
  assert.equal(validReportSettings(settings), true);
  assert.equal(
    validReportSettings({ ...settings, customCharts: Array(9).fill(spec) }),
    false,
  );
  const snapshot = {
    record: { draft: { x: ["0"] }, date: "2026-10-23" },
    profile: {},
    photoPath: null,
    settings,
  };
  const changed = structuredClone(snapshot);
  changed.settings.customCharts[0].embed = true;
  assert.equal(sameReportInputs(snapshot, changed), false);
});
