export interface Enrolled {
  name: string;
  week: number;
  time: string;
  date: string;
  room: string;
  hours: number;
  officialCancellable: boolean;
}
export interface Slot {
  name: string;
  week: number;
  time: string;
  day: number;
  period: string;
  start: string;
  end: string;
  remaining: number;
  hours: number;
}
export interface Overview {
  identity: { name: string; account: string };
  currentWeek: number | null;
  rules: {
    requiredHours: number;
    weeklyHourLimit: number;
    selectedHours: number;
  };
  enrolled: Enrolled[];
  allowedWeeks: number[];
  fetchedAt: string;
  calendarAnchor?: { date: string; week: number; day: number } | null;
}
export const cleanCourseName = (name: string) =>
  name.replace(/[（(]\d+学时[）)].*$/, "").trim();
const text = (node: Element | null) =>
  node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const cells = (row: Element) =>
  [...row.children].filter((e) => e.tagName === "TD" || e.tagName === "TH");
export function htmlPage(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((e) => e.remove());
  return doc;
}
export function formData(page: Document): Record<string, string> {
  const form = page.querySelector("form");
  if (!form) throw Error("官网表单缺失，请刷新或重新登录");
  const result: Record<string, string> = Object.create(null);
  for (const field of form.querySelectorAll<HTMLInputElement>("input[name]")) {
    if (
      field.disabled ||
      ["image", "submit", "button", "reset", "file"].includes(field.type) ||
      (["radio", "checkbox"].includes(field.type) && !field.checked)
    )
      continue;
    result[field.name] = field.value;
  }
  for (const field of form.querySelectorAll<HTMLSelectElement>(
    "select[name]",
  )) {
    if (field.disabled) continue;
    const selected =
      [...field.options].find((o) => o.hasAttribute("selected")) ??
      (!field.hasAttribute("size") ? field.options[0] : null);
    if (selected) result[field.name] = selected.value;
  }
  return result;
}
export function controlName(page: Document, id: string): string {
  const field = page.getElementById(id) ?? page.querySelector(`[name="${id}"]`);
  const name = field?.getAttribute("name");
  if (!name) throw Error("官网控件已变化，请重新登录并核对");
  return name;
}
export function weekOptions(page: Document, id: string): number[] {
  const select =
    page.getElementById(id) ?? page.querySelector(`[name="${id}"]`);
  if (!select) throw Error("官网周次控件缺失，未将空结果当作成功");
  return [
    ...new Set(
      [...select.querySelectorAll("option")]
        .map((e) => e.getAttribute("value") ?? text(e))
        .filter((v) => /^\d+$/.test(v))
        .map(Number),
    ),
  ];
}
export function normalizeCourseDate(value: string) {
  const raw = value.trim();
  let m: string[] | null = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw);
  if (!m) {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (us) m = [us[0], us[3], us[1], us[2]];
  }
  if (!m) return "";
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(date + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
    ? date
    : "";
}
export function courseStart(
  item: Pick<Enrolled, "date" | "time">,
): number | null {
  const date = normalizeCourseDate(item.date),
    time = /(\d{1,2}):(\d{2})\s*[-—–~至]/.exec(item.time);
  if (!date || !time || +time[1] > 23 || +time[2] > 59) return null;
  const value = Date.parse(
    `${date}T${time[1].padStart(2, "0")}:${time[2]}:00+08:00`,
  );
  return Number.isFinite(value) ? value : null;
}
export function cancelReason(item: Enrolled, now = Date.now()): string {
  const start = courseStart(item);
  if (start === null) return "实验时间待核实";
  if (start <= now) return "已开始";
  if (start - now <= 72 * 3600000) return "距开始不足72小时（含72小时）";
  return item.officialCancellable ? "" : "官网当前不允许取消";
}
export function nearestFuture(items: Enrolled[], now = Date.now()) {
  let index = -1,
    nearest = Infinity;
  items.forEach((item, i) => {
    const start = courseStart(item);
    if (start !== null && start > now && start < nearest) {
      index = i;
      nearest = start;
    }
  });
  return index;
}
export function parseEnrolled(page: Document): Enrolled[] {
  const results: Enrolled[] = [];
  for (const row of page.querySelectorAll("tr")) {
    const c = cells(row);
    if (c.length !== 10 || !/^\d+$/.test(text(c[0]))) continue;
    const week = Number(text(c[2]));
    if (!Number.isInteger(week) || week < 1)
      throw Error("官网实验周次无法识别");
    results.push({
      name: cleanCourseName(text(c[1])),
      week,
      time: text(c[3]),
      date: normalizeCourseDate(text(c[4])),
      room: text(c[5]),
      hours: Number(/(\d+)学时/.exec(text(c[1]))?.[1] ?? 3),
      officialCancellable: false,
    });
  }
  if (!results.length && !text(page.body).includes("实验项目"))
    throw Error("官网已选课表格式变化，未将空结果当作成功");
  return results;
}
export function applyOfficialCancellable(items: Enrolled[], page: Document) {
  if (!text(page.body).includes("取消")) throw Error("官网退课页面无法识别");
  const allowed = [...page.querySelectorAll("tr")].flatMap((row) => {
    const c = cells(row);
    return c.length === 6 &&
      row.querySelector('input[type="radio"]') &&
      /^\d+$/.test(text(c[0]))
      ? [
          {
            name: cleanCourseName(text(c[1])),
            week: Number(text(c[2])),
            time: text(c[3]),
          },
        ]
      : [];
  });
  return items.map((item) => ({
    ...item,
    officialCancellable: allowed.some(
      (a) =>
        a.name === item.name && a.week === item.week && a.time === item.time,
    ),
  }));
}
export function parseOverview(
  page: Document,
  enrolled: Enrolled[],
  allowedWeeks: number[],
): Overview {
  const body = text(page.body),
    number = (re: RegExp) => {
      const match = re.exec(body);
      if (!match) throw Error("官网学时信息无法识别，未使用旧数据");
      return Number(match[1]);
    };
  const identity = /([^\s（）()]+)\s*[（(](\d+)[）)]\s*同学/.exec(body);
  if (!identity) throw Error("官网账号身份无法核实，请重新登录");
  const currentWeek = Number(/第\s*(\d+)\s*周/.exec(body)?.[1]) || null;
  const calendar =
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日.*?星期([一二三四五六日天])/.exec(
      body,
    );
  const calendarDate = calendar
    ? normalizeCourseDate(`${calendar[1]}/${calendar[2]}/${calendar[3]}`)
    : "";
  return {
    identity: { name: identity[1], account: identity[2] },
    currentWeek,
    calendarAnchor:
      calendarDate && currentWeek && calendar
        ? {
            date: calendarDate,
            week: currentWeek,
            day: "一二三四五六日".indexOf(calendar[4].replace("天", "日")) + 1,
          }
        : null,
    rules: {
      requiredHours: number(/必须完成的实验项目总学时数为\s*(\d+)/),
      weeklyHourLimit: number(/每周可选的实验项目总学时数为\s*(\d+)/),
      selectedHours: number(/已选实验项目的总学时数为\s*(\d+)/),
    },
    enrolled,
    allowedWeeks,
    fetchedAt: new Date().toISOString(),
  };
}
export function parseAvailability(page: Document, week: number): Slot[] {
  if (!new RegExp("第\\s*" + week + "\\s*周可选").test(text(page.body)))
    throw Error("官网返回周次不匹配，请重新查询");
  const slots: Slot[] = [];
  let projects = 0;
  for (const row of page.querySelectorAll("tr")) {
    const c = cells(row);
    if (
      c.length !== 2 ||
      c[0].querySelector("table") ||
      !/(\d+)学时/.test(text(c[0]))
    )
      continue;
    projects++;
    const name = cleanCourseName(text(c[0])),
      hours = Number(/(\d+)学时/.exec(text(c[0]))![1]);
    for (const m of text(c[1]).matchAll(
      /(星期([一二三四五])(下午|晚上)\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}))\s*\((\d+)\)/g,
    ))
      slots.push({
        name,
        hours,
        week,
        time: m[1].replace(/\s/g, ""),
        day: "一二三四五".indexOf(m[2]) + 1,
        period: m[3] === "下午" ? "B" : "C",
        start: m[4],
        end: m[5],
        remaining: Number(m[6]),
      });
  }
  if (!projects) throw Error("官网场次表结构变化，无法可靠读取");
  return slots;
}
