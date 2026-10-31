import { formData } from "./portal.ts";
export interface Schedule {
  time: string;
  teacher: string;
  firstWeek: number;
  lastWeek: number;
  parity: string;
}
export interface CourseDetails {
  name: string;
  rooms: string[];
  schedules: Schedule[];
  warnings: string[];
  fetchedAt: number;
}
export const metadataKey = (value: string) =>
  String(value ?? "")
    .replace(/\s/g, "")
    .replace(/(?:[（(]\d+学时[）)]|\d+学时).*$/, "")
    .trim();
const text = (node: Element) =>
  node.textContent?.replace(/\s+/g, " ").trim() ?? "";
interface Block {
  table: Element;
  rows: string[][];
}
export function gridBlocks(page: Document): Block[] {
  const blocks: Block[] = [];
  for (const table of page.querySelectorAll("table")) {
    const occupied = new Map<number, Map<number, string>>(),
      rows: string[][] = [];
    const elements = [...table.querySelectorAll("tr")].filter(
      (row) => row.closest("table") === table,
    );
    if (elements.length > 3000) throw Error("官网查询表格过大，无法可靠读取");
    for (const [r, row] of elements.entries()) {
      const values = new Map(occupied.get(r) ?? []);
      let col = 0;
      for (const cell of [...row.children].filter(
        (c) => c.tagName === "TD" || c.tagName === "TH",
      )) {
        if (cell.querySelector("table")) continue;
        while (values.has(col)) col++;
        const width = Math.min(
            Math.max(1, Number(cell.getAttribute("colspan")) || 1),
            30,
          ),
          height = Math.min(
            Math.max(1, Number(cell.getAttribute("rowspan")) || 1),
            200,
          );
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          col + width > 256
        )
          throw Error("官网查询表格跨度异常");
        const value = text(cell);
        for (let c = col; c < col + width; c++) {
          values.set(c, value);
          for (let next = r + 1; next < r + height; next++) {
            const map = occupied.get(next) ?? new Map();
            map.set(c, value);
            occupied.set(next, map);
          }
        }
        col += width;
      }
      if (values.size)
        rows.push(
          Array.from(
            { length: Math.max(...values.keys()) + 1 },
            (_, i) => values.get(i) ?? "",
          ),
        );
      occupied.delete(r);
    }
    if (rows.length) blocks.push({ table, rows });
  }
  return blocks;
}
const header = (row: string[], labels: string[]) =>
  row.findIndex((v) => labels.some((label) => metadataKey(v).includes(label)));
const owner = (table: Element) =>
  table.parentElement?.closest("table") ?? table.parentElement;
export function parseRooms(page: Document): Record<string, string[]> {
  const result: Record<string, Set<string>> = Object.create(null),
    blocks = gridBlocks(page);
  const accept = (rows: string[][], name: number, room: number) => {
    for (const cells of rows) {
      if (Math.max(name, room) >= cells.length) continue;
      const n = metadataKey(cells[name]),
        r = cells[room].trim();
      if (
        n &&
        r &&
        !["实验项目", "实验名称", "项目名称"].some((s) => n.includes(s))
      )
        (result[n] ??= new Set()).add(r);
    }
  };
  for (const [index, block] of blocks.entries()) {
    for (const [position, row] of block.rows.entries()) {
      const name = header(row, ["实验项目", "实验名称", "项目名称"]),
        room = header(row, [
          "实验地点",
          "实验室",
          "教室",
          "上课地点",
          "地点",
          "实验用房",
        ]);
      if (name < 0 || room < 0 || name === room) continue;
      accept(block.rows.slice(position + 1), name, room);
      if (position === block.rows.length - 1) {
        const parent = owner(block.table);
        if (parent?.tagName === "TABLE") {
          const headerRow = block.table.closest("tr");
          let started = false;
          for (const tr of parent.querySelectorAll("tr")) {
            if (tr.closest("table") !== parent) continue;
            if (tr === headerRow) {
              started = true;
              continue;
            }
            if (!started) continue;
            const cells = [...tr.children].filter(
              (c) => c.tagName === "TD" || c.tagName === "TH",
            );
            if (cells.some((c) => c.querySelector("table"))) break;
            if (cells.length === row.length)
              accept([cells.map(text)], name, room);
          }
        }
        for (const next of blocks.slice(index + 1)) {
          if (
            owner(next.table) !== parent ||
            next.rows.some(
              (cells) =>
                header(cells, ["实验项目", "实验名称", "项目名称"]) >= 0,
            ) ||
            !next.rows.every((cells) => cells.length === row.length)
          )
            break;
          accept(next.rows, name, room);
        }
      }
      break;
    }
  }
  return Object.fromEntries(
    Object.entries(result).map(([name, rooms]) => [name, [...rooms].sort()]),
  );
}
export const normalizeSlotTime = (v: string) =>
  v
    .replace(/\s/g, "")
    .replace(/天/g, "日")
    .replace(/[—–～~]/g, "-");
export function parseSchedule(
  page: Document,
  experiment: string,
  scoped = false,
): Schedule[] {
  const result: Schedule[] = [];
  for (const { rows } of gridBlocks(page)) {
    for (const [position, row] of rows.entries()) {
      const teacher = header(row, ["任课教师", "指导教师", "教师", "主讲教师"]),
        slot = header(row, [
          "上课时间",
          "实验时间",
          "时间安排",
          "上课时段",
          "实验时段",
        ]),
        first = header(row, ["开始周", "起始周", "起止周"]),
        last = header(row, ["结束周", "终止周"]),
        name = header(row, ["实验项目", "实验名称", "项目名称"]);
      if (teacher < 0 || slot < 0 || first < 0 || (name < 0 && !scoped))
        continue;
      const active = header(row, ["是否开课", "开课状态"]),
        parity = header(row, ["单双周"]);
      for (const cells of rows.slice(position + 1)) {
        if (
          Math.max(teacher, slot, first, last, name, active, parity) >=
          cells.length
        )
          continue;
        if (name >= 0 && metadataKey(cells[name]) !== metadataKey(experiment))
          continue;
        if (active >= 0 && ["否", "不开课", "停课"].includes(cells[active]))
          continue;
        const match =
          /星期([一二三四五六日天])(下午|晚上|上午)\s*(\d{1,2}:\d{2})\s*[-–—～~]\s*(\d{1,2}:\d{2})/.exec(
            cells[slot],
          );
        const begin = cells[first].match(/\d+/g) ?? [],
          end = last >= 0 ? (cells[last].match(/\d+/g) ?? []) : begin.slice(1),
          cycle = parity >= 0 ? cells[parity].trim() : "";
        if (
          !match ||
          !begin.length ||
          !end.length ||
          !cells[teacher].trim() ||
          !["", "每周", "全部", "单周", "双周", "单", "双"].includes(cycle)
        )
          continue;
        const firstWeek = Number(begin[0]),
          lastWeek = Number(end.at(-1));
        if (firstWeek < 1 || firstWeek > lastWeek || lastWeek > 60) continue;
        const valid = (v: string) => {
          const [h, m] = v.split(":").map(Number);
          return h >= 0 && h < 24 && m >= 0 && m < 60;
        };
        if (!valid(match[3]) || !valid(match[4])) continue;
        result.push({
          time: `星期${match[1].replace("天", "日")}${match[2]}${match[3].padStart(5, "0")}-${match[4].padStart(5, "0")}`,
          teacher: cells[teacher].trim(),
          firstWeek,
          lastWeek,
          parity: cycle,
        });
      }
      break;
    }
  }
  return result;
}
const teacherIndexes = new WeakMap<CourseDetails, Map<string, string[]>>();
export function matchTeachers(
  details: CourseDetails | undefined,
  item: { week: number; time: string },
): string[] {
  if (!details) return [];
  let index = teacherIndexes.get(details);
  if (!index) {
    index = new Map();
    teacherIndexes.set(details, index);
  }
  const indexKey = `${item.week}|${normalizeSlotTime(item.time)}`;
  if (index.has(indexKey)) return [...index.get(indexKey)!];
  const matches = (details?.schedules ?? []).filter(
    (row) =>
      normalizeSlotTime(row.time) === normalizeSlotTime(item.time) &&
      row.firstWeek <= item.week &&
      item.week <= row.lastWeek &&
      (!["单周", "单"].includes(row.parity) || item.week % 2 === 1) &&
      (!["双周", "双"].includes(row.parity) || item.week % 2 === 0),
  );
  if (!matches.length) {
    index.set(indexKey, []);
    return [];
  }
  // Distinct overlapping schedule rows are ambiguous; one explicit multi-teacher
  // row (or exact duplicates) is authoritative, unlike a guessed union.
  const groups = matches.map((row) =>
    [
      ...new Set(
        row.teacher
          .split(/[／/、,，]/)
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ].sort(),
  );
  const result = groups.every(
    (group) => JSON.stringify(group) === JSON.stringify(groups[0]),
  )
    ? groups[0]
    : [];
  index.set(indexKey, result);
  return [...result];
}
export function metadataQuery(
  page: Document,
  experiment: string,
  kind: "rooms" | "schedule",
): { form: Record<string, string>; scoped: boolean } | null {
  const choices = [
    ...page.querySelectorAll<HTMLSelectElement>("select[name]"),
  ].flatMap((select) =>
    [...select.querySelectorAll("option")]
      .filter((option) => metadataKey(text(option)) === metadataKey(experiment))
      .map((option) => ({ select, option })),
  );
  if (choices.length > 1) throw Error("官网实验查询选项不唯一");
  if (!choices.length) return null;
  const { select, option } = choices[0],
    form = formData(page);
  form[select.name] = option.getAttribute("value") ?? text(option);
  form.__EVENTTARGET = "";
  form.__EVENTARGUMENT = "";
  const buttons = [
    ...page.querySelectorAll<HTMLInputElement>("input[name]"),
  ].filter(
    (input) =>
      ["submit", "image"].includes(input.type.toLowerCase()) &&
      (/查询|检索/.test(input.value + (input.getAttribute("alt") ?? "")) ||
        /btn(?:Submit|Query|Search)$/i.test(input.name)),
  );
  if (buttons.length === 1) {
    const button = buttons[0];
    if (button.type.toLowerCase() === "image") {
      form[button.name + ".x"] = "8";
      form[button.name + ".y"] = "8";
    } else form[button.name] = button.value || "查询";
  } else if (
    (kind === "schedule" && select.name === "plan1$ExpeList") ||
    (select.getAttribute("onchange") ?? "").includes("__doPostBack")
  )
    form.__EVENTTARGET = select.name;
  else throw Error("官网查询提交控件无法可靠识别");
  return { form, scoped: true };
}
