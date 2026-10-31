import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { reviewOCR, applyOCR } from "../src/domain/ocr.ts";
import { makeDraft, convert } from "../src/domain/model.ts";
import {
  defaultReportSettings,
  validReportSettings,
  sameReportInputs,
} from "../src/domain/reports.ts";
const experiments = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog.json", import.meta.url)),
).experiments;
test("AI report imports validate question/answer pairs, size, and exact snapshot changes", () => {
  const settings = defaultReportSettings();
  settings.ai = {
    source: '{"draft":{}}',
    customQuiz: {
      questions: ["原理是什么？"],
      answers: { 1: ["磁通量变化产生感应电动势。"] },
    },
    polish: { 实验原理: "正文 $Q=K_b d_m$" },
  };
  assert.equal(validReportSettings(settings), true);
  const wrong = structuredClone(settings);
  delete wrong.ai.customQuiz.answers["1"];
  assert.equal(validReportSettings(wrong), false);
  const big = structuredClone(settings);
  big.ai.polish["实验原理"] = "x".repeat(20001);
  assert.equal(validReportSettings(big), false);
  const snapshot = {
    record: { draft: { x: "1" }, date: "2026-10-22" },
    profile: { name: "", studentId: "", className: "" },
    photoPath: null,
    settings,
  };
  const changed = structuredClone(snapshot);
  changed.settings.ai.customQuiz.answers["1"] = ["另一答案"];
  assert.equal(sameReportInputs(snapshot, changed), false);
});
test("OCR accepts scientific notation, rejects malformed shapes and unknown fields without inventing data", () => {
  const schema = {
    groups: [
      {
        name: "test",
        fields: [
          { key: "n", label: "数值", type: "science", required: true },
          {
            key: "xs",
            label: "数组",
            type: "array",
            length: 3,
            required: true,
          },
        ],
      },
    ],
  };
  const result = reviewOCR(
    schema,
    "```json\n" +
      JSON.stringify({ data: { n: "2.7×10^-9", xs: [1, 2], secret: 7 } }) +
      "\n```",
  );
  assert.equal(result.values.n, 2.7e-9);
  assert.equal(result.errors.length, 2);
  assert.equal(result.values.xs, undefined);
  assert.throws(
    () => reviewOCR(schema, '{"data":{"n":"1e-9999"}}'),
    /未识别出/,
  );
  assert.throws(() => reviewOCR(schema, '{"data":{"n":{}}}'), /未识别出/);
});
test("OCR preserves blanks, zero and existing values; apply uses selected fields only for all 28 experiments", () => {
  const fixtures = JSON.parse(
    fs.readFileSync(new URL("./fixtures/measurements.json", import.meta.url)),
  );
  for (const exp of experiments) {
    const draft = makeDraft(exp.schema, fixtures[exp.id]);
    const raw = convert(exp.schema, draft).data;
    const result = reviewOCR(exp.schema, JSON.stringify({ data: raw }));
    assert.equal(result.errors.length, 0, exp.name);
    assert.deepEqual(
      applyOCR(exp.schema, draft, result, Object.keys(raw), true),
      draft,
      exp.name,
    );
    assert.deepEqual(
      convert(
        exp.schema,
        applyOCR(
          exp.schema,
          makeDraft(exp.schema),
          result,
          Object.keys(raw),
          false,
        ),
      ).data,
      raw,
      exp.name,
    );
  }
  const schema = {
    groups: [
      {
        name: "",
        fields: [
          { key: "x", label: "值", type: "number", required: true },
          { key: "y", label: "值2", type: "number", required: true },
        ],
      },
    ],
  };
  const result = reviewOCR(schema, '{"data":{"x":8,"y":null}}');
  assert.deepEqual(
    applyOCR(schema, { x: "0", y: "4" }, result, ["x", "y"], true),
    { x: "0", y: "4" },
  );
  assert.deepEqual(applyOCR(schema, { x: "0", y: "4" }, result, ["x"], false), {
    x: "8",
    y: "4",
  });
  assert.throws(
    () => applyOCR(schema, { x: "-", y: "" }, result, ["x"], false),
    /数值格式/,
  );
});
test("OCR coupled variable columns cannot truncate existing data or split measurement pair", () => {
  const schema = {
    groups: [
      {
        name: "",
        fields: [
          {
            key: "x",
            label: "点",
            type: "array",
            variableLength: true,
            minLength: 3,
            maxLength: 100,
            required: true,
          },
          {
            key: "y",
            label: "组",
            type: "matrix",
            rows: 2,
            colsFrom: "x",
            required: true,
          },
        ],
      },
    ],
  };
  const draft = {
    x: ["1", "2", "3"],
    y: [
      ["1", "2", "3"],
      ["4", "5", "6"],
    ],
  };
  const result = reviewOCR(
    schema,
    JSON.stringify({
      data: {
        x: [1, 2, 3, 4],
        y: [
          [1, 2, 3, 4],
          [5, 6, 7, 8],
        ],
      },
    }),
  );
  assert.throws(
    () => applyOCR(schema, draft, result, ["x"], false),
    /长度不同/,
  );
  const emptyOnly = applyOCR(schema, draft, result, ["x", "y"], true);
  assert.deepEqual(emptyOnly.x, ["1", "2", "3", "4"]);
  assert.deepEqual(emptyOnly.y, [["1", "2", "3", "4"], ["4", "5", "6", "8"]]);
  assert.equal(applyOCR(schema, draft, result, ["x", "y"], false).x.length, 4);
});
