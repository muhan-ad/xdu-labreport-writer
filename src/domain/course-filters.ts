import type { Slot, Overview } from "./portal.ts";
import { experimentConflict } from "./course-eligibility.ts";
import { experimentReview, teacherReviews, nameMatches } from "./reviews.ts";
export interface CourseFilters {
  version: 1;
  hideSelected: boolean;
  hideAcademic: boolean;
  recommendedExperiments: boolean;
  recommendedTeachers: boolean;
  experimentsEnabled: boolean;
  teachersEnabled: boolean;
  experiments: string[];
  teachers: string[];
}
export const defaultCourseFilters = (): CourseFilters => ({
  version: 1,
  hideSelected: false,
  hideAcademic: false,
  recommendedExperiments: false,
  recommendedTeachers: false,
  experimentsEnabled: false,
  teachersEnabled: false,
  experiments: [],
  teachers: [],
});
export const filterCount = (f: CourseFilters) =>
  [
    "hideSelected",
    "hideAcademic",
    "recommendedExperiments",
    "recommendedTeachers",
    "experimentsEnabled",
    "teachersEnabled",
  ].filter((k) => f[k as keyof CourseFilters] === true).length;
export function validCourseFilters(raw: unknown): raw is CourseFilters {
  const f = raw as CourseFilters;
  return (
    !!f &&
    f.version === 1 &&
    [
      "hideSelected",
      "hideAcademic",
      "recommendedExperiments",
      "recommendedTeachers",
      "experimentsEnabled",
      "teachersEnabled",
    ].every((k) => typeof f[k as keyof CourseFilters] === "boolean") &&
    [f.experiments, f.teachers].every(
      (a) =>
        Array.isArray(a) &&
        a.length <= 500 &&
        a.every(
          (s) =>
            typeof s === "string" && s.trim().length > 0 && s.length <= 200,
        ) &&
        new Set(a).size === a.length,
    )
  );
}
export function checkCourseFilters(
  f: CourseFilters,
  academicAvailable = false,
) {
  if (!validCourseFilters(f)) throw Error("筛选配置格式无效");
  if (f.experimentsEnabled && !f.experiments.length)
    throw Error("请先选择指定实验");
  if (f.teachersEnabled && !f.teachers.length) throw Error("请先选择指定老师");
  if (f.hideAcademic && !academicAvailable)
    throw Error("教务课表未连接，无法应用教务冲突筛选");
}
export function matchesCourseFilters(
  slot: Slot,
  overview: Overview,
  teachers: string[],
  f: CourseFilters,
  academicConflict: boolean | null = null,
) {
  if (
    f.hideSelected &&
    (overview.enrolled.some((e) => nameMatches(e.name, slot.name)) ||
      (experimentConflict(slot, overview) !== null &&
        experimentConflict(slot, overview) !== "unknown"))
  )
    return false;
  if (f.hideAcademic && academicConflict !== false) return false;
  if (
    f.recommendedExperiments &&
    experimentReview(slot.name)?.category !== "recommended"
  )
    return false;
  if (
    f.recommendedTeachers &&
    !teachers.some(
      (t) => teacherReviews(t, slot.name)?.category === "recommended",
    )
  )
    return false;
  if (
    f.experimentsEnabled &&
    !f.experiments.some((n) => nameMatches(n, slot.name))
  )
    return false;
  if (f.teachersEnabled && !teachers.some((n) => f.teachers.includes(n)))
    return false;
  return true;
}
