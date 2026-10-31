import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelReason,
  courseStart,
  nearestFuture,
  normalizeCourseDate,
} from "../src/domain/portal.ts";
import {
  experimentReview,
  teacherReviews,
  nameMatches,
} from "../src/domain/reviews.ts";
const item = {
  name: "测试",
  week: 7,
  time: "星期四下午15:55-18:10",
  date: "2026/10/29",
  room: "F219",
  hours: 3,
  officialCancellable: true,
};
test("school dates use CST and strictly reject unverified dates; 72h boundary exact", () => {
  const start = Date.parse("2026-10-29T15:55:00+08:00");
  assert.equal(courseStart(item), start);
  assert.equal(cancelReason(item, start - 72 * 3600000 - 1), "");
  assert.match(cancelReason(item, start - 72 * 3600000), /72小时/);
  assert.equal(cancelReason(item, start), "已开始");
  assert.equal(cancelReason(item, start + 1), "已开始");
  assert.equal(cancelReason({ ...item, date: "未知" }), "实验时间待核实");
  assert.equal(
    cancelReason({ ...item, officialCancellable: false }, start - 73 * 3600000),
    "官网当前不允许取消",
  );
  assert.equal(normalizeCourseDate("10/29/2026"), "2026-10-29");
  assert.equal(normalizeCourseDate("2026/02/30"), "");
  assert.equal(courseStart({ ...item, time: "下午25:00-26:00" }), null);
});
test("nearest experiment excludes started and unknown dates, selects by future time instead of list order", () => {
  const now = Date.parse("2026-10-23T08:00:00+08:00");
  const rows = [
    { ...item, date: "2026/10/22" },
    { ...item, date: "2026/11/15" },
    { ...item, date: "2026/10/26" },
    { ...item, date: "" },
  ];
  assert.equal(nearestFuture(rows, now), 2);
  assert.equal(nearestFuture([{ ...item, date: "2026/10/22" }], now), -1);
});
test("review aliases preserve approved classifications and never borrow another experiment teacher review", () => {
  assert.equal(
    nameMatches("冲击法测量直螺线管磁场实验", "直螺线管磁场分布的测量"),
    true,
  );
  assert.ok(experimentReview("冲击法测量直螺线管磁场实验"));
  const teacher = teacherReviews("吴兴林", "直螺线管磁场分布的测量");
  assert.equal(teacher.groups.length, 1);
  assert.equal(
    teacherReviews("吴兴林", "薄透镜焦距的测量（凸透镜）").groups.length,
    0,
  );
  assert.equal(teacherReviews("待核实", "直螺线管磁场分布的测量"), null);
  assert.equal(teacherReviews("张欢", "任意").category, "mixed");
});
