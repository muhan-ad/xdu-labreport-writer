import { CourseFilterPanel, type FilterDirectory } from '../../src/features/course-filter-panel.ts';
import { defaultCourseFilters } from '../../src/domain/course-filters.ts';

export function createFixture() {
  let account = '111111', applied = defaultCourseFilters();
  const pending: { account: string; resolve: (value: ReturnType<typeof defaultCourseFilters>) => void }[] = [];
  const listeners: ((directory: FilterDirectory) => void)[] = [];
  const panel = new CourseFilterPanel(() => account, async update => { listeners.push(update); }, value => { applied = value; }, () => {}, () => true);
  (panel as any).preferences = { load: (owner: string) => new Promise(resolve => pending.push({account: owner, resolve})), save: async () => {} };
  const data = (teacher: boolean, experiment: boolean) => ({...defaultCourseFilters(), recommendedTeachers: teacher, recommendedExperiments: experiment});
  return {
    begin: (owner: string) => { account = owner; void panel.load(owner); },
    finish: (index: number, teacher: boolean, experiment: boolean) => pending[index].resolve(data(teacher, experiment)),
    applied: () => applied,
    open: () => panel.open(),
    close: () => panel.close(true),
    scan: (index: number, label: string) => listeners[index]({ experiments: [], status: label })
  };
}
