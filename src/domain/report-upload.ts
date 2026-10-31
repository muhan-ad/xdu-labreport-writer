import { nameMatches } from "./reviews.ts";
import type { SchoolReportState, SchoolReportRow } from "./report-status.ts";
export async function uniqueReportRow(
  name: string,
  read: () => Promise<SchoolReportState>,
  page: (n: number) => Promise<SchoolReportState>,
): Promise<SchoolReportRow> {
  let state = await read();
  if (state.phase !== "ready" || state.pages < 1 || state.pages > 100)
    throw Error("请先登录报告系统并完成列表读取");
  const total=state.pages;
  const move=async(direction:number)=>{const target=state.page+direction;const next=await page(direction);if(next.phase!=='ready'||next.page!==target||next.pages!==total)throw Error('官网报告页码已变化，请重新核对');state=next;};
  while (state.page > 1) await move(-1);
  const pages = state.pages,
    matches: { row: SchoolReportRow; page: number }[] = [];
  for (let p = 1; p <= pages; p++) {
    if (state.pages !== pages || state.page !== p || state.phase !== "ready")
      throw Error("官网报告列表已变化，请重新核对");
    for (const row of state.rows)
      if (nameMatches(name, row.name)) matches.push({ row, page: p });
    if (p < pages) await move(1);
  }
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? "官网有多条对应实验记录，请选择具体场次上传"
        : "官网没有找到对应实验，请核对报告账号和实验名称",
    );
  const match = matches[0];
  while (state.page !== match.page)
    await move(state.page < match.page ? 1 : -1);
  const found = state.rows.find(
    (r) => r.fingerprint === match.row.fingerprint && r.name === match.row.name,
  );
  if (!found) throw Error("对应报告记录已变化，请重试");
  if (found.score !== null || (!found.canUpload && found.uploadKnown !== false))
    throw Error(
      found.score !== null
        ? "该实验已有成绩，无法上传"
        : "官网当前不允许上传这份报告",
    );
  return found;
}
