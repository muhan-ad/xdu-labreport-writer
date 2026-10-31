import type { Store } from "./repository.ts";
import {
  defaultCourseFilters,
  validCourseFilters,
  type CourseFilters,
} from "./course-filters.ts";
const digest = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
export class FilterPreferences {
  private tail: Promise<unknown> = Promise.resolve();
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  private async key(account: string) {
    if (!/^\d{6,30}$/.test(account)) throw Error("学校账号无效");
    return "filters-" + (await digest(account));
  }
  async load(account: string): Promise<CourseFilters> {
    await this.tail.catch(() => {});
    return (await this.read(await this.key(account))).value;
  }
  private async read(key: string) {
    const copies = await Promise.all(
      ["a", "b"].map((s) => this.store.read(key + "-" + s)),
    );
    const valid = [];
    for (const text of copies) {
      if (!text) continue;
      try {
        const r = JSON.parse(text);
        if (
          Number.isSafeInteger(r.revision) &&
          r.revision > 0 &&
          validCourseFilters(r.value) &&
          (await digest(JSON.stringify(r.value))) === r.digest
        )
          valid.push(r);
      } catch {}
    }
    valid.sort((a, b) => b.revision - a.revision);
    if (valid.length)
      return valid[0] as { revision: number; value: CourseFilters };
    if (copies.some((x) => x !== null))
      throw Error("筛选偏好损坏，请明确恢复默认后保存");
    return { revision: 0, value: defaultCourseFilters() };
  }
  save(account: string, value: CourseFilters, reset = false) {
    if (!validCourseFilters(value))
      return Promise.reject(Error("筛选配置无效"));
    const snapshot = structuredClone(value);
    const result = this.tail
      .catch(() => {})
      .then(async () => {
        const key = await this.key(account);
        const old = await this.read(key).catch((e) => {
          if (reset) return { revision: 0 };
          throw e;
        });
        const encoded = JSON.stringify({
          revision: old.revision + 1,
          value: snapshot,
          digest: await digest(JSON.stringify(snapshot)),
        });
        await this.store.write(key + "-a", encoded);
        await this.store.write(key + "-b", encoded);
      });
    this.tail = result;
    return result;
  }
}
