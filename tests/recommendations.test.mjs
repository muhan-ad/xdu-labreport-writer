import test from "node:test";
import assert from "node:assert/strict";
import { guideAvailability } from "../src/domain/recommendations.ts";
import { metadataKey } from "../src/domain/course-metadata.ts";
const name = "冲击法测量直螺线管磁场实验",
  time = "星期四下午15:55-18:10",
  now = Date.parse("2026-10-23T12:00:00+08:00");
const slot = {
  name,
  week: 7,
  time,
  day: 4,
  period: "B",
  start: "15:55",
  end: "18:10",
  remaining: 2,
  hours: 3,
};
const overview = {
  identity: { name: "模拟", account: "2500000000" },
  currentWeek: 6,
  allowedWeeks: [7, 8],
  calendarAnchor: { date: "2026-10-23", week: 6, day: 5 },
  enrolled: [],
  rules: { requiredHours: 24, weeklyHourLimit: 9, selectedHours: 0 },
  fetchedAt: "",
};
const metadata = (teacher = "吴兴林") =>
  new Map([
    [
      metadataKey(name),
      {
        name,
        rooms: ["F219"],
        warnings: [],
        fetchedAt: now,
        schedules: [
          { teacher, time, firstWeek: 1, lastWeek: 16, parity: "每周" },
        ],
      },
    ],
  ]);
const run = (slots = [slot], o = overview, m = metadata(), scope = {}) =>
  guideAvailability(slots, o, m, scope, now);
test("recommendation seats deduplicate actual sessions, match explicit aliases and sort future dates independently of availability input order", () => {
  const later = { ...slot, week: 8, remaining: 3 };
  const r = run([later, slot, slot], overview, metadata(), {
    experiment: "直螺线管磁场分布的测量",
  });
  assert.equal(r.seats, 5);
  assert.deepEqual(
    r.sessions.map((s) => s.item.week),
    [7, 8],
  );
  assert.equal(run([{ ...slot, remaining: 0 }]).seats, 0);
  assert.equal(run([slot], null).seats, null);
});
test("teacher seat attribution requires one official matching teacher, not static reviews or a joint ambiguous group", () => {
  assert.equal(
    run([slot], overview, metadata(), { teacher: "吴兴林" }).seats,
    2,
  );
  assert.equal(
    run([slot], overview, new Map(), { teacher: "吴兴林" }).seats,
    null,
  );
  assert.equal(
    run([slot], overview, metadata("吴兴林／王小芳"), { teacher: "吴兴林" })
      .seats,
    null,
  );
  assert.equal(
    run([slot], overview, metadata("王小芳"), { teacher: "吴兴林" }).seats,
    0,
  );
  assert.equal(
    run([slot], overview, metadata(), { teacher: "不存在的教师" }).seats,
    0,
  );
});
test("past, duplicate experiment aliases, real conflicts and weekly limit are excluded, unknown dates are not reported as zero", () => {
  assert.equal(
    run([{ ...slot, week: 6 }], { ...overview, allowedWeeks: [6, 7] }).seats,
    0,
  );
  assert.equal(
    run([slot], {
      ...overview,
      enrolled: [
        {
          ...slot,
          name: "直螺线管磁场分布的测量",
          date: "2026-10-29",
          room: "",
          officialCancellable: true,
        },
      ],
    }).seats,
    0,
  );
  const conflict = {
    ...slot,
    name: "其他实验",
    date: "2026-10-29",
    room: "",
    officialCancellable: true,
  };
  assert.equal(run([slot], { ...overview, enrolled: [conflict] }).seats, 0);
  assert.equal(
    run([slot], {
      ...overview,
      rules: { ...overview.rules, weeklyHourLimit: 2 },
    }).seats,
    0,
  );
  const uncertain = run([slot], { ...overview, calendarAnchor: null });
  assert.equal(uncertain.seats, null);
  assert.equal(uncertain.uncertain, true);
  assert.equal(uncertain.sessions.length, 0);
  assert.equal(run([slot], { ...overview, currentWeek: null }).seats, null);
});
