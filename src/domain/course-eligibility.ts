import {
  courseStart,
  normalizeCourseDate,
  type Enrolled,
  type Overview,
  type Slot,
} from "./portal.ts";
export function resolveSlotDate(
  slot: Pick<Slot, "week" | "time">,
  overview: Overview,
): string | null {
  const match = /星期([一二三四五六日天])/.exec(slot.time);
  if (!match || !Number.isInteger(slot.week)) return null;
  const day = "一二三四五六日".indexOf(match[1].replace("天", "日")) + 1,
    anchors: { date: string; week: number; day: number }[] = [];
  for (const item of overview.enrolled) {
    const m = /星期([一二三四五六日天])/.exec(item.time);
    if (m && item.date)
      anchors.push({
        date: item.date,
        week: item.week,
        day: "一二三四五六日".indexOf(m[1].replace("天", "日")) + 1,
      });
  }
  if (overview.calendarAnchor) anchors.push(overview.calendarAnchor);
  const starts = new Set<number>();
  for (const anchor of anchors) {
    const date = normalizeCourseDate(anchor.date);
    if (
      !date ||
      !Number.isInteger(anchor.week) ||
      anchor.week < 1 ||
      anchor.day < 1 ||
      anchor.day > 7
    )
      continue;
    const value = Date.parse(date + "T00:00:00Z");
    if (((new Date(value).getUTCDay() + 6) % 7) + 1 !== anchor.day) return null;
    starts.add(value - ((anchor.week - 1) * 7 + anchor.day - 1) * 86400000);
  }
  if (starts.size !== 1) return null;
  return new Date([...starts][0] + ((slot.week - 1) * 7 + day - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
}
const clock = (item: { time: string }) => {
  const m = /(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/.exec(item.time);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]),
    end = Number(m[3]) * 60 + Number(m[4]);
  return +m[1] < 24 && +m[3] < 24 && +m[2] < 60 && +m[4] < 60 && start < end
    ? { start, end }
    : null;
};
export function experimentConflict(
  slot: Slot,
  overview: Overview,
): Enrolled | null | "unknown" {
  const date = resolveSlotDate(slot, overview),
    time = clock(slot);
  if (!date || !time) return "unknown";
  for (const item of overview.enrolled) {
    if (item.week !== slot.week) continue;
    const date2 = normalizeCourseDate(item.date),
      time2 = clock(item);
    if (!date2 || !time2) return "unknown";
    if (date2 === date && time.start < time2.end && time2.start < time.end)
      return item;
  }
  return null;
}
export function eligibilityReason(
  slot: Slot,
  overview: Overview,
  now = Date.now(),
): string {
  if (!Number.isInteger(slot.remaining) || slot.remaining <= 0)
    return "此场次已无名额";
  if (overview.currentWeek === null) return "当前周次待核实";
  if (
    !overview.allowedWeeks.includes(slot.week) ||
    slot.week < overview.currentWeek
  )
    return "官网当前不允许选择此周次";
  const date = resolveSlotDate(slot, overview),
    start = date ? courseStart({ ...slot, date }) : null;
  if (start === null) return "场次日期待核实";
  if (start <= now) return "此场次已经开始";
  if (overview.enrolled.some((item) => item.name === slot.name))
    return "已选过该实验";
  const conflict = experimentConflict(slot, overview);
  if (conflict === "unknown") return "已选实验时间待核实，无法校验冲突";
  if (conflict) return "与已选实验时间冲突";
  if (
    overview.enrolled
      .filter((item) => item.week === slot.week)
      .reduce((sum, item) => sum + item.hours, 0) +
      slot.hours >
    overview.rules.weeklyHourLimit
  )
    return "超过官网每周学时上限";
  return "";
}
