import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCourseFilters,
  filterCount,
  checkCourseFilters,
  matchesCourseFilters,
} from "../src/domain/course-filters.ts";
import { FilterPreferences } from "../src/domain/filter-preferences.ts";
const slot = {
  name: "冲击法测量直螺线管磁场实验",
  week: 7,
  time: "星期四下午15:55-18:10",
  day: 4,
  period: "B",
  start: "15:55",
  end: "18:10",
  remaining: 0,
  hours: 3,
};
const overview = {
  identity: { name: "模拟", account: "2500000000" },
  currentWeek: 6,
  calendarAnchor: { date: "2026-10-23", week: 6, day: 5 },
  enrolled: [],
  allowedWeeks: [7, 8],
  rules: { requiredHours: 24, selectedHours: 0, weeklyHourLimit: 9 },
};
test("different filter conditions intersect; selected experiments and teachers each form unions; unknown teacher cannot match", () => {
  const f = {
    ...defaultCourseFilters(),
    experimentsEnabled: true,
    teachersEnabled: true,
    experiments: ["别的实验", "直螺线管磁场分布的测量"],
    teachers: ["老师甲", "老师乙"],
  };
  assert.equal(matchesCourseFilters(slot, overview, ["老师乙"], f), true);
  assert.equal(matchesCourseFilters(slot, overview, [], f), false);
  assert.equal(
    matchesCourseFilters(
      { ...slot, name: "不相关实验" },
      overview,
      ["老师乙"],
      f,
    ),
    false,
  );
  assert.equal(filterCount(f), 2);
  assert.equal(
    matchesCourseFilters(slot, overview, ["未知"], {
      ...f,
      teachersEnabled: false,
    }),
    true,
  );
});
test("hide selected uses explicit aliases and real time overlaps; unknown conflicts remain labelled instead of invented", () => {
  const f = { ...defaultCourseFilters(), hideSelected: true };
  assert.equal(
    matchesCourseFilters(
      slot,
      {
        ...overview,
        enrolled: [
          { ...slot, name: "直螺线管磁场分布的测量", date: "2026-10-29" },
        ],
      },
      [],
      f,
    ),
    false,
  );
  assert.equal(
    matchesCourseFilters(
      slot,
      {
        ...overview,
        enrolled: [
          {
            ...slot,
            name: "其他实验",
            time: "星期四下午16:00-18:00",
            date: "2026-10-29",
          },
        ],
      },
      [],
      f,
    ),
    false,
  );
  assert.equal(
    matchesCourseFilters(slot, { ...overview, calendarAnchor: null }, [], f),
    true,
  );
  assert.equal(
    matchesCourseFilters(
      slot,
      overview,
      [],
      { ...f, hideAcademic: true },
      null,
    ),
    false,
  );
  assert.equal(
    matchesCourseFilters(
      slot,
      overview,
      [],
      { ...f, hideAcademic: true },
      false,
    ),
    true,
  );
});
test("empty enabled multi-select and unavailable academic session are explicit; unknown/mixed teachers are not recommended", () => {
  assert.throws(
    () =>
      checkCourseFilters({
        ...defaultCourseFilters(),
        experimentsEnabled: true,
      }),
    /先选择/,
  );
  assert.throws(
    () => checkCourseFilters({ ...defaultCourseFilters(), hideAcademic: true }),
    /未连接/,
  );
  assert.equal(
    matchesCourseFilters(slot, overview, ["张欢"], {
      ...defaultCourseFilters(),
      recommendedTeachers: true,
    }),
    false,
  );
  assert.equal(
    matchesCourseFilters(slot, overview, [], {
      ...defaultCourseFilters(),
      recommendedTeachers: true,
    }),
    false,
  );
});
test("account preferences survive reload and retain account isolation, recover one corrupt copy, and require explicit reset for both", async () => {
  const files = new Map(),
    store = {
      read: async (k) => files.get(k) ?? null,
      write: async (k, v) => {
        files.set(k, v);
      },
      remove: async (k) => files.delete(k),
    };
  let prefs = new FilterPreferences(store);
  const f = { ...defaultCourseFilters(), recommendedExperiments: true };
  await prefs.save("2500000000", f);
  prefs = new FilterPreferences(store);
  assert.deepEqual(await prefs.load("2500000000"), f);
  assert.deepEqual(await prefs.load("2500000001"), defaultCourseFilters());
  assert.ok([...files.keys()].every((k) => !k.includes("2500000000")));
  const keys = [...files.keys()];
  files.set(keys[0], "broken");
  assert.deepEqual(await prefs.load("2500000000"), f);
  files.set(keys[1], "broken");
  await assert.rejects(() => prefs.load("2500000000"), /损坏/);
  await assert.rejects(() => prefs.save("2500000000", f), /损坏/);
  await prefs.save("2500000000", defaultCourseFilters(), true);
  assert.deepEqual(await prefs.load("2500000000"), defaultCourseFilters());
});
