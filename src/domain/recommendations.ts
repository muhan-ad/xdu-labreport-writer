import { courseStart, type Overview, type Slot } from "./portal.ts";
import { eligibilityReason, resolveSlotDate } from "./course-eligibility.ts";
import {
  matchTeachers,
  metadataKey,
  type CourseDetails,
} from "./course-metadata.ts";
import { nameMatches, teacherGuides } from "./reviews.ts";

export interface GuideScope {
  experiment?: string;
  teacher?: string;
}
export interface GuideSession {
  item: Slot;
  date: string;
  teachers: string[];
}
export interface GuideAvailability {
  seats: number | null;
  sessions: GuideSession[];
  uncertain: boolean;
}
/** Never derive an official teaching relationship from a review entry. */
export function guideAvailability(
  slots: Iterable<Slot>,
  overview: Overview | null,
  metadata: ReadonlyMap<string, CourseDetails>,
  scope: GuideScope,
  now = Date.now(),
): GuideAvailability {
  const sessions: GuideSession[] = [];
  if (!overview) return { seats: null, sessions, uncertain: false };
  const seen = new Set<string>();
  let uncertain = false;
  const teacher = scope.teacher
    ? teacherGuides.find((t) => t.name === scope.teacher)
    : null;
  for (const item of slots) {
    if (scope.experiment && !nameMatches(item.name, scope.experiment)) continue;
    if (
      scope.teacher &&
      !scope.experiment &&
      !teacher?.groups.some((g) =>
        g.experiments.some((e) => nameMatches(e, item.name)),
      )
    )
      continue;
    if (
      !overview.allowedWeeks.includes(item.week) ||
      (overview.currentWeek !== null && item.week < overview.currentWeek) ||
      !Number.isInteger(item.remaining) ||
      item.remaining <= 0
    )
      continue;
    const id = JSON.stringify([item.name, item.week, item.time]);
    if (seen.has(id)) continue;
    seen.add(id);
    if (overview.enrolled.some((e) => nameMatches(e.name, item.name))) continue;
    const date = resolveSlotDate(item, overview),
      start = date ? courseStart({ ...item, date }) : null;
    if (start === null || overview.currentWeek === null) {
      uncertain = true;
      continue;
    }
    if (start <= now) continue;
    const reason = eligibilityReason(item, overview, now);
    if (reason) {
      if (reason.includes("待核实")) uncertain = true;
      continue;
    }
    const teachers = matchTeachers(metadata.get(metadataKey(item.name)), item);
    if (scope.teacher) {
      // Preserve the original recommendation page's conservative seat attribution:
      // a joint session is not counted once for each teacher.
      if (
        !teachers.length ||
        (teachers.length > 1 && teachers.includes(scope.teacher))
      ) {
        uncertain = true;
        continue;
      }
      if (teachers.length !== 1 || teachers[0] !== scope.teacher) continue;
    }
    sessions.push({ item, date: date!, teachers });
  }
  sessions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.item.start.localeCompare(b.item.start) ||
      a.item.name.localeCompare(b.item.name, "zh"),
  );
  return {
    seats: uncertain
      ? null
      : sessions.reduce((n, s) => n + s.item.remaining, 0),
    sessions,
    uncertain,
  };
}
