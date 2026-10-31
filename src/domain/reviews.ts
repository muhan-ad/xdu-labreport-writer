import guides from "../data/portal-guides.json" with { type: "json" };
import groups from "../data/course-aliases.json" with { type: "json" };
export const experimentReviews = guides.recommendations;
export const teacherGuides = guides.teachers;
const key = (v: string) =>
  v.replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")");
export const nameMatches = (a: string, b: string) =>
  key(a) === key(b) ||
  groups.some(
    (group) =>
      group.some((n) => key(n) === key(a)) &&
      group.some((n) => key(n) === key(b)),
  );
export function experimentReview(name: string) {
  return (
    guides.recommendations.find((e) => key(e.name) === key(name)) ??
    guides.recommendations.find((e) => nameMatches(e.name, name)) ??
    null
  );
}
export function teacherReviews(name: string, experiment: string) {
  const teacher = guides.teachers.find((t) => t.name === name.trim());
  return teacher
    ? {
        ...teacher,
        groups: teacher.groups.filter((r) =>
          r.experiments.some((e) => nameMatches(e, experiment)),
        ),
      }
    : null;
}
