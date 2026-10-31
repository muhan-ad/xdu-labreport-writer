import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  metadataKey,
  metadataQuery,
  parseRooms,
  parseSchedule,
  type CourseDetails,
} from "../domain/course-metadata.ts";
import {
  htmlPage,
  formData,
  controlName,
  weekOptions,
  parseAvailability,
  type Overview,
  type Slot,
} from "../domain/portal.ts";
export interface PreparedCourse {
  ticket: string;
  item: Slot & { date: string };
  action: "add" | "cancel";
  expiresIn: number;
  expectedTeachers: string[];
  academicChecked: boolean;
}
interface NativePortal {
  clear(): Promise<void>;
  sessionStatus(): Promise<{active:boolean}>;
  request(o: {
    operation: string;
    form?: Record<string, string>;
    savedAccountId?:string;
  }): Promise<{ html: string }>;
  snapshot(): Promise<Overview>;
  prepare(o: {
    action: "add" | "cancel";
    item: { name: string; week: number; time: string };
    expectedTeachers: string[];
  }): Promise<PreparedCourse>;
  commit(o: {
    ticket: string;
    confirmed: boolean;
    academicUncheckedConfirmed: boolean;
  }): Promise<{ message: string; overview: Overview; verified: boolean }>;
  discard(o: { ticket: string }): Promise<void>;
}
const native = registerPlugin<NativePortal>("LabPortal");
export class SchoolPortal {
  private generation = 0;
  private cache = new Map<number, { time: number; slots: Slot[] }>();
  private metadataCache = new Map<string, CourseDetails>();
  private roomDirectory: {
    time: number;
    rooms: Record<string, string[]>;
  } | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  overview: Overview | null = null;
  private committing = false;
  private clearCaches() {
    this.cache.clear();
    this.metadataCache.clear();
    this.roomDirectory = null;
  }
  private authError(error: unknown) {
    if (
      ["AUTH", "HTTP_401", "HTTP_403"].includes(
        (error as { code?: string })?.code ?? "",
      )
    ) {
      this.overview = null;
      this.clearCaches();
    }
  }
  private queue<T>(job: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const result = this.serial
      .catch(() => {})
      .then(async () => {
        this.check(generation);
        return job(generation);
      });
    this.serial = result;
    return result;
  }
  private check(generation: number) {
    if (generation !== this.generation)
      throw Error("会话已清除，旧任务结果已丢弃");
  }
  private async page(
    operation: string,
    generation: number,
    form?: Record<string, string>,
    savedAccountId?:string,
  ) {
    if (Capacitor.getPlatform() !== "android")
      throw Error("一站通原生会话目前已接入 Android，iOS 正在迁移");
    this.check(generation);
    let result: { html: string };
    try {
      result = await native.request({ operation, ...(form ? { form } : {}),...(savedAccountId?{savedAccountId}:{}) });
    } catch (e) {
      this.check(generation);
      if (
        ["AUTH", "HTTP_401", "HTTP_403"].includes(
          (e as { code?: string }).code ?? "",
        )
      ) {
        this.overview = null;
        this.cache.clear();
        this.metadataCache.clear();
        this.roomDirectory = null;
        throw Error("学校登录已失效，请重新登录");
      }
      throw e;
    }
    this.check(generation);
    const doc = htmlPage(result.html);
    if (
      !["loginPage", "login"].includes(operation) &&
      doc.querySelector('[name="login1$StuPassword"]')
    ) {
      this.overview = null;
      this.cache.clear();
      this.metadataCache.clear();
      this.roomDirectory = null;
      throw Error("学校登录已失效，请重新登录");
    }
    return doc;
  }
  invalidateReads() {
    if (this.committing)
      throw Error("选退课正在提交并回读，请完成后再清除登录");
    this.generation++;
    this.overview = null;
    this.clearCaches();
  }
  async clear() {
    this.invalidateReads();
    await native.clear();
  }
  async login(account: string, password: string) {
    return this.loginWith(account,password);
  }
  async loginSaved(id:string,account:string){return this.loginWith(account,'',id);}
  /** Reattach to a native session left alive by a WebView reload, without changing its account. */
  restoreActive(){return this.queue(async generation=>{if(Capacitor.getPlatform()!=='android')throw Error('当前平台的一站通会话尚未接入');const state=await native.sessionStatus();this.check(generation);if(!state||typeof state.active!=='boolean')throw Error('学校会话状态未能核实');return state.active?await this.readOverview(generation):null;});}
  private async loginWith(account:string,password:string,savedId?:string){
    if (!/^\d{6,30}$/.test(account) || (savedId?!/^[a-f0-9-]{36}$/.test(savedId):!password) || password.length > 200)
      throw Error("请填写有效的学校账号和密码");
    const expectedGeneration = this.generation + 1;
    await this.clear();
    this.check(expectedGeneration);
    return this.queue(async (generation) => {
      const page = await this.page("loginPage", generation),
        form = formData(page);
      Object.assign(form, {
        login1$StuLoginID: account,
        login1$StuPassword: password,
        login1$UserRole: "Student",
        "login1$btnLogin.x": "8",
        "login1$btnLogin.y": "8",
      });
      const response = await this.page("login", generation, form,savedId);
      if (response.querySelector('[name="login1$StuPassword"]'))
        throw Error("学校未接受登录，请核对账号、密码或官网当前状态");
      return this.readOverview(generation, account);
    });
  }
  private async readOverview(generation: number, expected?: string) {
    if (Capacitor.getPlatform() !== "android")
      throw Error("当前平台的一站通会话尚未接入");
    let result: Overview;
    try {
      result = await native.snapshot();
    } catch (e) {
      this.authError(e);
      throw e;
    }
    if (expected && result.identity.account !== expected)
      throw Error("学校返回的账号身份不一致，请重新登录");
    this.check(generation);
    this.overview = result;
    return result;
  }
  prepare(
    action: "add" | "cancel",
    item: { name: string; week: number; time: string },
    expectedTeachers: string[] = [],
  ) {
    return this.queue(async (generation) => {
      if (!this.overview) throw Error("请先登录学校系统");
      try {
        const result = await native.prepare({
          action,
          item: { name: item.name, week: item.week, time: item.time },
          expectedTeachers,
        });
        this.check(generation);
        return result;
      } catch (e) {
        this.authError(e);
        throw e;
      }
    });
  }
  discard(ticket: string) {
    return this.queue(async () => {
      await native.discard({ ticket });
    });
  }
  commit(ticket: string, academicUncheckedConfirmed: boolean) {
    return this.queue(async (generation) => {
      this.committing = true;
      try {
        const result = await native.commit({
          ticket,
          confirmed: true,
          academicUncheckedConfirmed,
        });
        this.check(generation);
        if (!result.verified)
          throw Error("官网尚未确认提交结果，请刷新课表核对");
        this.overview = result.overview;
        this.clearCaches();
        return result;
      } catch (e) {
        this.authError(e);
        throw e;
      } finally {
        this.committing = false;
      }
    });
  }
  refresh() {
    return this.queue(async (generation) => {
      const result = await this.readOverview(
        generation,
        this.overview?.identity.account,
      );
      this.cache.clear();
      this.metadataCache.clear();
      this.roomDirectory = null;
      return result;
    });
  }
  details(experiment: string, force = false) {
    return this.queue(async (generation) => {
      if (!this.overview) throw Error("请先登录学校系统");
      const key = metadataKey(experiment),
        cached = this.metadataCache.get(key);
      if (
        !force &&
        cached &&
        Date.now() - cached.fetchedAt <
          (cached.warnings.length ? 30000 : 600000)
      )
        return cached;
      const result: CourseDetails = {
        name: experiment,
        rooms: [],
        schedules: [],
        warnings: [],
        fetchedAt: Date.now(),
      };
      for (const kind of ["rooms", "schedule"] as const) {
        try {
          if (
            kind === "rooms" &&
            !force &&
            this.roomDirectory &&
            Date.now() - this.roomDirectory.time < 600000
          ) {
            result.rooms = this.roomDirectory.rooms[key] ?? [];
            if (!result.rooms.length)
              result.warnings.push("官网实验项目查询未匹配到教室");
            continue;
          }
          const base = await this.page(kind + "Form", generation),
            query = metadataQuery(base, experiment, kind);
          const page = query
            ? await this.page(kind + "Query", generation, query.form)
            : base;
          if (kind === "rooms") {
            const rooms = parseRooms(page);
            result.rooms = rooms[key] ?? [];
            if (!query) this.roomDirectory = { time: Date.now(), rooms };
            if (!result.rooms.length)
              result.warnings.push("官网实验项目查询未匹配到教室");
          } else {
            result.schedules = parseSchedule(page, experiment, !!query?.scoped);
            if (!result.schedules.length)
              result.warnings.push("官网课程安排未匹配到教师记录");
          }
        } catch (e) {
          this.check(generation);
          if (!this.overview) throw e;
          result.warnings.push(
            `${kind === "rooms" ? "教室" : "教师"}信息未完整获取：${(e as Error).message}`,
          );
        }
      }
      this.check(generation);
      this.metadataCache.set(key, result);
      return result;
    });
  }
  week(week: number, force = false) {
    return this.queue(async (generation) => {
      if (!this.overview?.allowedWeeks.includes(week))
        throw Error("官网未提供这个周次");
      const cached = this.cache.get(week);
      if (!force && cached && Date.now() - cached.time < 60000)
        return cached.slots;
      const page = await this.page("weekForm", generation);
      if (!weekOptions(page, "Header2_ExpeWeekList").includes(week))
        throw Error("该周已不在官网允许查询范围");
      const form = formData(page),
        weekName = controlName(page, "Header2_ExpeWeekList"),
        button = controlName(page, "Header2_btnSubmit");
      Object.assign(form, {
        [weekName]: String(week),
        __EVENTTARGET: "",
        __EVENTARGUMENT: "",
        [button + ".x"]: "8",
        [button + ".y"]: "8",
      });
      const rows = parseAvailability(
        await this.page("weekQuery", generation, form),
        week,
      );
      this.check(generation);
      this.cache.set(week, { time: Date.now(), slots: rows });
      return rows;
    });
  }
}
