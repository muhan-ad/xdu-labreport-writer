import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHTML } from "linkedom";
import {
  metadataKey,
  metadataQuery,
  parseRooms,
  parseSchedule,
  matchTeachers,
} from "../src/domain/course-metadata.ts";
import {
  resolveSlotDate,
  eligibilityReason,
  experimentConflict,
} from "../src/domain/course-eligibility.ts";
const page = (html) =>
  parseHTML("<html><body>" + html + "</body></html>").document;
const details = (schedules) => ({
  name: "A",
  rooms: [],
  schedules,
  warnings: [],
  fetchedAt: 0,
});
test("read-only metadata form uses official selector postback, fresh hidden state, and rejects ambiguous options", () => {
  const doc = page(
    '<form><input name="__VIEWSTATE" type="hidden" value="fresh"><select name="plan1$ExpeList"><option value="A1">A 3学时</option></select></form>',
  );
  const result = metadataQuery(doc, "A", "schedule");
  assert.equal(result.scoped, true);
  assert.equal(result.form.__VIEWSTATE, "fresh");
  assert.equal(result.form.__EVENTTARGET, "plan1$ExpeList");
  assert.equal(result.form["plan1$ExpeList"], "A1");
  const submit = metadataQuery(
    page(
      '<form><select name="Header$Name"><option value="A1">A(3学时)</option></select><input name="Query" type="submit" value="查询"></form>',
    ),
    "A",
    "schedule",
  );
  assert.equal(submit.form.Query, "查询");
  assert.throws(
    () =>
      metadataQuery(
        page(
          '<form><select name="a"><option>A</option></select><select name="b"><option>A</option></select></form>',
        ),
        "A",
        "schedule",
      ),
    /不唯一/,
  );
});
test("official room sample expands nested headers and merged cells without cross-table ownership leaks", () => {
  const result = parseRooms(
    page(
      fs.readFileSync(
        new URL("./fixtures/course-room-projects.html", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.equal(Object.keys(result).length, 18);
  assert.deepEqual(result["电子束的电磁偏转特性实验"], ["F217"]);
  assert.deepEqual(result["RLC电路的稳态特性研究实验"], ["F218"]);
  assert.deepEqual(
    parseRooms(
      page(
        '<table><tr><th>实验项目</th><th>实验室</th></tr><tr><td>A</td><td rowspan="2">楼201</td></tr><tr><td>B</td></tr><tr><td>A</td><td>楼202</td></tr></table>',
      ),
    ),
    { A: ["楼201", "楼202"], B: ["楼201"] },
  );
  assert.deepEqual(
    parseRooms(
      page(
        "<div><table><tr><th>实验项目</th><th>上课教室</th></tr></table></div><div><table><tr><td>A</td><td>错误教室</td></tr></table></div>",
      ),
    ),
    {},
  );
  assert.equal(metadataKey("A （3 学时）"), "A");
});
test("teacher scope, actual week ranges, parity, full times and ambiguity are preserved", () => {
  const html =
    "<table><tr><th>实验时间</th><th>教师</th><th>开始周</th><th>结束周</th><th>单双周</th><th>开课状态</th></tr>" +
    [
      ["星期四下午15:55-18:10", "教师甲、教师乙", "2", "8", "单周", "是"],
      ["星期四下午15:55-18:10", "教师丙", "9", "14", "", "是"],
      ["星期五晚上18:30-20:45", "停课教师", "2", "14", "", "否"],
    ]
      .map(
        (row) =>
          "<tr>" + row.map((c) => "<td>" + c + "</td>").join("") + "</tr>",
      )
      .join("") +
    "</table>";
  assert.deepEqual(parseSchedule(page(html), "A"), []);
  const rows = parseSchedule(page(html), "A", true);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    matchTeachers(details(rows), { week: 7, time: "星期四下午15:55-18:10" }),
    ["教师乙", "教师甲"],
  );
  assert.deepEqual(
    matchTeachers(details(rows), { week: 8, time: "星期四下午15:55-18:10" }),
    [],
  );
  assert.deepEqual(
    matchTeachers(details(rows), { week: 9, time: "星期四下午15:55-18:10" }),
    ["教师丙"],
  );
  assert.deepEqual(
    matchTeachers(details(rows), { week: 7, time: "星期四下午15:55-17:30" }),
    [],
  );
  assert.deepEqual(
    matchTeachers(details([...rows, { ...rows[0], teacher: "另一个教师" }]), {
      week: 7,
      time: "星期四下午15:55-18:10",
    }),
    [],
  );
  const named = page(
    "<table><tr><th>实验名称</th><th>实验时间</th><th>教师</th><th>起止周</th></tr><tr><td>B</td><td>星期四下午15:55-18:10</td><td>教师乙</td><td>1-19</td></tr></table>",
  );
  assert.deepEqual(parseSchedule(named, "A"), []);
});
const overview = {
  identity: { name: "测试", account: "2500000000" },
  currentWeek: 7,
  calendarAnchor: { date: "2026-10-23", week: 7, day: 5 },
  rules: { requiredHours: 24, weeklyHourLimit: 9, selectedHours: 3 },
  enrolled: [],
  allowedWeeks: [7, 8],
  fetchedAt: "",
};
const slot = {
  name: "A",
  week: 8,
  time: "星期四下午15:55-18:10",
  day: 4,
  period: "B",
  start: "15:55",
  end: "18:10",
  remaining: 2,
  hours: 3,
};
test("official calendar anchors determine dates; inconsistent or missing semester anchors remain unknown", () => {
  assert.equal(resolveSlotDate(slot, overview), "2026-10-29");
  assert.equal(
    resolveSlotDate(slot, { ...overview, calendarAnchor: null }),
    null,
  );
  const wrong = {
    ...overview,
    enrolled: [
      {
        name: "X",
        week: 7,
        date: "2026-10-16",
        time: "星期五晚上18:30-20:45",
        hours: 3,
        room: "",
        officialCancellable: true,
      },
    ],
  };
  assert.equal(resolveSlotDate(slot, wrong), null);
  assert.equal(
    resolveSlotDate(slot, {
      ...overview,
      calendarAnchor: { date: "2026-10-23", week: 7, day: 4 },
    }),
    null,
  );
});
test("qualification checks full time overlap, past start, duplicate labs, capacity and weekly hours independently", () => {
  const now = Date.parse("2026-10-23T08:00:00+08:00");
  assert.equal(eligibilityReason(slot, overview, now), "");
  assert.match(
    eligibilityReason({ ...slot, remaining: 0 }, overview, now),
    /无名额/,
  );
  assert.match(
    eligibilityReason(slot, overview, Date.parse("2026-10-29T15:55:00+08:00")),
    /已经开始/,
  );
  const enrolled = {
    name: "B",
    week: 8,
    date: "2026-10-29",
    time: "星期四下午16:00-18:00",
    hours: 3,
    room: "F219",
    officialCancellable: true,
  };
  assert.equal(
    experimentConflict(slot, { ...overview, enrolled: [enrolled] }).name,
    "B",
  );
  assert.match(
    eligibilityReason(slot, { ...overview, enrolled: [enrolled] }, now),
    /冲突/,
  );
  assert.match(
    eligibilityReason(
      slot,
      { ...overview, enrolled: [{ ...enrolled, name: "A" }] },
      now,
    ),
    /已选过/,
  );
  assert.match(
    eligibilityReason(
      slot,
      { ...overview, rules: { ...overview.rules, weeklyHourLimit: 2 } },
      now,
    ),
    /学时上限/,
  );
});
