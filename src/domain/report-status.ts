export function numericReportScore(value: unknown): number | null {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/[·•]/g, ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?(?:分)?$/.test(text)) return null;
  const n = Number(text.replace(/分$/, ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
export interface SchoolReportRow {
  fingerprint: string;
  name: string;
  week: string;
  time: string;
  gradeText: string;
  gradeImage: string;
  imageState: string;
  score: number | null;
  status: string;
  canPreview: boolean;
  canUpload: boolean;
  uploadKnown?: boolean;
}
export interface SchoolReportState {
  phase: string;
  message: string;
  rows: SchoolReportRow[];
  page: number;
  pages: number;
}
export function parseSchoolReports(raw: unknown): SchoolReportState {
  const r = raw as Record<string, unknown>;
  if (
    !r ||
    typeof r !== "object" ||
    ![
      "loading",
      "needs_login",
      "logging_in",
      "login_failed",
      "expired",
      "reading",
      "ready",
      "error",
    ].includes(String(r.phase))
  )
    throw Error("报告状态无法核实");
  const text = (v: unknown, max = 1500) =>
    typeof v === "string" ? v.slice(0, max) : "";
  if (r.rows !== undefined && (!Array.isArray(r.rows) || r.rows.length > 2000))
    throw Error("报告列表格式无法核实");
  const rows = (Array.isArray(r.rows) ? r.rows : []).map(
    (value): SchoolReportRow => {
      const v = value as Record<string, unknown>;
      if (!v || typeof v !== "object" || !text(v.name) || !text(v.fingerprint))
        throw Error("报告条目标识缺失");
      const gradeText = text(v.gradeText),
        score = numericReportScore(gradeText);
      const image = text(v.gradeImage, 140000);
      return {
        fingerprint: text(v.fingerprint),
        name: text(v.name),
        week: text(v.week),
        time: text(v.time),
        gradeText,
        gradeImage: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)
          ? image
          : "",
        imageState: text(v.imageState, 30),
        score,
        status: score === null ? gradeText : "",
        canPreview: v.canPreview === true,
        canUpload: score === null && v.canUpload === true,
        uploadKnown: score !== null || typeof v.canUpload === "boolean",
      };
    },
  );
  const pages = Number(r.pages ?? 1),
    page = Number(r.page ?? 1);
  if (
    !Number.isInteger(page) ||
    !Number.isInteger(pages) ||
    page < 1 ||
    pages < page ||
    pages > 10000
  )
    throw Error("报告页码无法核实");
  return {
    phase: String(r.phase),
    message: text(r.message),
    rows,
    page,
    pages,
  };
}
export function applyReportRecognition(
  row: SchoolReportRow,
  raw: unknown,
): SchoolReportRow {
  const r = raw as Record<string, unknown>,
    score =
      typeof r?.score === "number" ? numericReportScore(String(r.score)) : null,
    status = ["已上传", "未上传", "已批改", "未批改"].includes(
      String(r?.status),
    )
      ? String(r.status)
      : "";
  if (row.gradeText) return row;
  return {
    ...row,
    score: status ? null : score,
    status,
    imageState: status || score !== null ? "recognized" : "unreadable",
    canUpload: score !== null ? false : row.canUpload,
  };
}
