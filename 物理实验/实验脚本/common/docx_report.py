"""实验报告生成器 — 基于 python-docx + OMML，**不依赖 Microsoft Word**。

与旧实现（win32com 遥控 Word）的差异：
- 公式改为 LaTeX → MathML → OMML 直接写入文档，仍是 Word 原生可编辑公式，
  但不再需要安装 Word、不存在 OMaths.BuildUp() 解析失败的问题，
  单份报告耗时从数十秒（Word 启动 + 逐条 BuildUp）降到 1 秒级；
- 不再有 Word 进程/临时锁文件/可见性抢焦点等系统级副作用；
- 排版参数与原实现对齐：A4、页边距 72/72/90/90 pt、黑体标题、宋体正文、
  首行缩进 21pt（约 2 字符）、表格宋体 10pt 居中、单倍行距、段间距按项设置。

公开接口与原实现保持一致（26 个实验的 generate.py 无需改动）：
    add_title / add_student_info / add_heading / add_paragraph / add_paragraph_rich
    add_math / add_run / add_inline_math / add_table / add_image / add_data_photo
    add_page_break / save / close
"""

import os
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

try:                                     # 作为包导入（generate.py 的标准用法）
    from .docx_omml import (latex_to_omml, latex_to_omathpara, latex_to_plain,
                            stats as _omml_stats, failures as _omml_failures)
except ImportError as _exc:
    # 区分两种情况：模块本身找不到（脚本方式运行）vs 模块内部缺少第三方依赖（要原样抛出）
    if 'docx_omml' in str(_exc):
        from docx_omml import (latex_to_omml, latex_to_omathpara, latex_to_plain,
                               stats as _omml_stats, failures as _omml_failures)
    else:
        raise


# ── 版式常量 ──
BODY_FONT = '宋体'
HEADING_FONT = '黑体'
BODY_SIZE = 12          # 小四
TABLE_SIZE = 10
TITLE_SIZE = 16
H1_SIZE = 14
H2_SIZE = 12
FIRST_LINE_INDENT = 21.0    # pt，与原实现一致
# 行距：与原实现一致（旧管线生成的报告实测 13.9pt，等于 278/240 倍行距）。
# 用倍数而非固定磅值，避免"固定值"行距在公式/图片行裁剪内容。
LINE_SPACING = 278 / 240.0

_ENGINE_BANNER_PRINTED = False   # 每个进程只打印一次引擎标识，便于排查"跑的是哪条管线"

# ── 宋体缺失的 Unicode 上下标字符 → Word 原生上下标 ──
# 宋体（SimSun）不含 U+2070-207F（²³除外）/U+2080-209F 等字符，直接输出会
# 渲染为 □（豆腐块）。写入时把这些字符转为普通字符 + 原生上下标样式。
_SUBSCRIPT_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k',
    'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't',
    'ᵢ': 'i', 'ⱼ': 'j',
}
_SUPERSCRIPT_MAP = {
    '⁻': '-', '⁺': '+', '⁰': '0', '¹': '1', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', 'ⁱ': 'i',
}
# 宋体缺失且无上下标语义的字符 → 宋体已有的等效写法（防 □ 兜底）
_CHAR_REPLACE = [
    ('≪', '<<'), ('≫', '>>'),      # 远小于/远大于 → ASCII
    ('\u2212', '-'),                 # 数学减号 U+2212 → ASCII 连字符
    ('\u2207', '\u25bd'),            # ∇ → ▽（GB2312 符号区，宋体具备）
    ('\u0304', '\u00af'),            # 组合上横线 → 间距宏符 ¯（兜底；源头应使用 $\bar{x}$）
]

# LaTeX 间距命令字面（Word 不识别，纯文本中若出现会原样显示）
_LATEX_SPACE_CMD_RE = re.compile(
    r"\\(?:emsp|ensp|qquad|quad|hspace\*?\{[^}]*\}|,|;|:| )")


def _normalize_text_chars(text: str) -> str:
    for a, b in _CHAR_REPLACE:
        if a in text:
            text = text.replace(a, b)
    return text


def _normalize_text(text: str) -> str:
    r"""文本归一化：字符映射 + 清除 LaTeX 间距命令字面（防 \emsp 等原文残留）。"""
    text = _normalize_text_chars(text)
    text = text.replace(r"\!", "")
    return _LATEX_SPACE_CMD_RE.sub("\u3000", text)


def _split_sub_super(text: str):
    """把文本按「普通/下标/上标」切段：[(mode, text)]，mode 0=普通 1=下标 2=上标。"""
    segments = []
    for ch in text:
        if ch in _SUBSCRIPT_MAP:
            mode, c = 1, _SUBSCRIPT_MAP[ch]
        elif ch in _SUPERSCRIPT_MAP:
            mode, c = 2, _SUPERSCRIPT_MAP[ch]
        else:
            mode, c = 0, ch
        if segments and segments[-1][0] == mode:
            segments[-1][1] += c
        else:
            segments.append([mode, c])
    return [(m, s) for m, s in segments]


def split_rich_blocks(text: str) -> list:
    """把富文本（可能含 Markdown 换行）拆为写入操作序列 [(kind, content)]。

    kind='math'：独立公式块（$$...$$），kind='para'：普通段落（可含 $..$ 内联式）。
    段落以换行分隔；段内残留的行中 $$..$$ 降级为 $..$ 内联公式，避免破坏版式。
    """
    ops = []
    for block in re.split(r"\n+", (text or "").strip()):
        b = block.strip()
        if not b:
            continue
        if (b.startswith("$$") and b.endswith("$$") and len(b) > 4
                and "$$" not in b[2:-2]):
            expr = b[2:-2].strip()
            if expr:
                ops.append(("math", expr))
            continue
        b = re.sub(r"\$\$([^$]*)\$\$", r"$\1$", b)
        if b.strip():
            ops.append(("para", b))
    return ops


class DocxReportWriter:
    """生成物理实验报告（python-docx + OMML）。

    用法与旧版一致：先 add_* 逐步写入内容，最后 save() + close()；
    close() 会把临时文件原子替换到目标路径（目标被 Word 占用时报错但保留临时文件）。
    """

    def __init__(self, output_path: str, visible: bool = False):
        # visible 参数仅为兼容旧调用签名保留：新实现不启动任何外部程序
        global _ENGINE_BANNER_PRINTED
        if not _ENGINE_BANNER_PRINTED:
            _ENGINE_BANNER_PRINTED = True
            # 这一行用于区分生成管线：旧版是"遥控 Word（BuildUp）"，会把不支持的公式
            # 原样留成带反斜杠的文本；新版为纯 Python 转换，不需要 Word。
            print('[引擎] 报告生成：python-docx + OMML（无需 Microsoft Word）')
        self.output_path = os.path.abspath(output_path)
        self._tmp_path = self.output_path + ".~saving" + str(os.getpid()) + ".docx"
        self._closed = False
        self._body_font_size = BODY_SIZE
        self._cursor = None          # add_run / add_inline_math 的写入目标段落

        self._doc = Document()
        self._setup_page()
        self._setup_styles()

    # ── 初始化 ──────────────────────────────────────────

    def _setup_page(self):
        """A4 + 与原实现一致的页边距（Word COM 里是 72/72/90/90 pt）。"""
        for section in self._doc.sections:
            section.page_width = Cm(21.0)
            section.page_height = Cm(29.7)
            section.top_margin = Pt(72)
            section.bottom_margin = Pt(72)
            section.left_margin = Pt(90)
            section.right_margin = Pt(90)

    def _setup_styles(self):
        """正文默认样式：宋体小四、多倍行距 1.08、段后 8pt（与原实现的 Word 默认一致）。"""
        normal = self._doc.styles['Normal']
        normal.font.size = Pt(BODY_SIZE)
        normal.font.name = BODY_FONT
        rpr = normal.element.get_or_add_rPr()
        rfonts = rpr.find(qn('w:rFonts'))
        if rfonts is None:
            rfonts = OxmlElement('w:rFonts')
            rpr.insert(0, rfonts)
        for attr in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
            rfonts.set(qn(attr), BODY_FONT)
        pf = normal.paragraph_format
        pf.line_spacing = LINE_SPACING
        pf.space_after = Pt(8)
        pf.space_before = Pt(0)

    # ── 内部工具 ──────────────────────────────────────────

    @staticmethod
    def _apply_font(run, font_name: str, font_size: float, bold: bool):
        """设置 run 字体，并显式指定东亚字体（否则中文会回退到默认字体）。"""
        run.font.size = Pt(font_size)
        run.font.bold = bold
        run.font.name = font_name
        rpr = run._element.get_or_add_rPr()
        rfonts = rpr.find(qn('w:rFonts'))
        if rfonts is None:
            rfonts = OxmlElement('w:rFonts')
            rpr.insert(0, rfonts)
        for attr in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
            rfonts.set(qn(attr), font_name)

    @staticmethod
    def _format_paragraph(p, align=None, space_before=0.0, space_after=0.0,
                          first_line_indent=0.0, line_spacing=None):
        pf = p.paragraph_format
        if align is not None:
            pf.alignment = align
        pf.space_before = Pt(space_before)
        pf.space_after = Pt(space_after)
        pf.first_line_indent = Pt(first_line_indent)
        pf.line_spacing = LINE_SPACING if line_spacing is None else line_spacing

    def _add_text_runs(self, paragraph, text: str, font_name: str = BODY_FONT,
                       font_size: float = BODY_SIZE, bold: bool = False):
        """写入文本（自动把宋体缺失的上下标字符转成原生上下标 run）。"""
        if not text:
            return
        text = _normalize_text(text)
        for mode, seg in _split_sub_super(text):
            run = paragraph.add_run(seg)
            self._apply_font(run, font_name, font_size, bold)
            if mode == 1:
                run.font.subscript = True
            elif mode == 2:
                run.font.superscript = True

    def _add_paragraph(self, text: str = "", font_name: str = BODY_FONT,
                       font_size: float = BODY_SIZE, bold: bool = False, align=None,
                       space_after: float = 0.0, space_before: float = 0.0,
                       first_line_indent: float = 0.0):
        p = self._doc.add_paragraph()
        self._format_paragraph(p, align=align, space_before=space_before,
                               space_after=space_after,
                               first_line_indent=first_line_indent)
        if text:
            self._add_text_runs(p, text, font_name, font_size, bold)
        return p

    def _append_math(self, paragraph, latex: str, display: bool = False) -> bool:
        """把 LaTeX 公式作为 OMML 追加到段落；失败时回退为纯文本，返回是否成功。"""
        xml = latex_to_omathpara(latex) if display else latex_to_omml(latex)
        if xml is None:
            plain = latex_to_plain(latex)
            print("[警告] 公式转换失败，已按文本写入：%r" % (latex[:80],))
            if plain:
                self._add_text_runs(paragraph, plain, BODY_FONT, self._body_font_size)
            return False
        try:
            paragraph._p.append(parse_xml(xml))
        except Exception as exc:
            print("[警告] 公式 XML 写入失败（%s），已按文本写入：%r" % (exc, latex[:80]))
            plain = latex_to_plain(latex)
            if plain:
                self._add_text_runs(paragraph, plain, BODY_FONT, self._body_font_size)
            return False
        return True

    # ── 公开方法 ──────────────────────────────────────────

    def add_title(self, text: str):
        """居中加粗大标题。"""
        return self._add_paragraph(text, font_name=HEADING_FONT, font_size=TITLE_SIZE,
                                   bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
                                   space_after=12)

    def add_student_info(self):
        """插入学生信息行。从环境变量读取真实值，未设置时用（未填写）占位。"""
        name = os.environ.get("LAB_STUDENT_NAME", "").strip() or "（未填写）"
        sid = os.environ.get("LAB_STUDENT_ID", "").strip() or "（未填写）"
        sclass = os.environ.get("LAB_STUDENT_CLASS", "").strip() or "（未填写）"
        date = os.environ.get("LAB_STUDENT_DATE", "").strip() or "（未填写）"
        fields = "姓名：%s    学号：%s    班级：%s    实验日期：%s" % (name, sid, sclass, date)
        return self._add_paragraph(fields, font_size=self._body_font_size, space_after=6)

    def add_heading(self, text: str, level: int = 1):
        """章节标题。level 1=一级，level 2=二级。"""
        if level == 1:
            return self._add_paragraph(text, font_name=HEADING_FONT, font_size=H1_SIZE,
                                       bold=True, space_before=12, space_after=6)
        return self._add_paragraph(text, font_name=HEADING_FONT, font_size=H2_SIZE,
                                   bold=True, space_before=6, space_after=3)

    def add_paragraph(self, text: str):
        """正文段落（首行缩进）。"""
        return self._add_paragraph(text, font_size=self._body_font_size,
                                   first_line_indent=FIRST_LINE_INDENT)

    def add_paragraph_rich(self, text: str):
        """富文本正文（Markdown 兼容）：自动分段并解析 $...$ 内联公式。

        变体/AI 润色章节整段文字的统一入口：按换行拆段，$$...$$ 独立公式块
        转为居中显示公式（add_math），$...$ 内联公式随文字流动（add_inline_math），
        普通文字宋体正文（首行缩进）。单行纯文本时与 add_paragraph 等价。
        """
        for kind, content in split_rich_blocks(text):
            if kind == "math":
                self.add_math(content)
                continue
            p = self._add_paragraph(space_after=6, first_line_indent=FIRST_LINE_INDENT)
            for part in re.split(r"(\$[^$]*\$)", content):
                if not part:
                    continue
                if part.startswith("$") and part.endswith("$") and len(part) > 2:
                    self.add_inline_math(part)
                else:
                    self._add_text_runs(p, part, BODY_FONT, self._body_font_size)

    def add_math(self, latex: str):
        """插入独立显示公式；latex 可带 $...$ 定界符。

        版式与旧版 Word COM 产物对齐：段落首行缩进、公式左对齐（旧产物实测
        公式段为 首行缩进 21pt + 左对齐），不做居中，避免版式回归。
        """
        formula = (latex or "").strip()
        if not formula:
            return
        p = self._add_paragraph(first_line_indent=FIRST_LINE_INDENT)
        self._append_math(p, formula, display=True)
        self._cursor = None

    def add_run(self, text: str):
        """在当前段落末尾追加文字（不另起段落），与 add_inline_math() 配合使用。"""
        if not text:
            return
        if self._cursor is None:
            self._cursor = self._add_paragraph(space_after=6,
                                               first_line_indent=FIRST_LINE_INDENT)
        self._add_text_runs(self._cursor, text, BODY_FONT, self._body_font_size)

    def add_inline_math(self, latex: str):
        """在当前段落内插入内联公式（不换行，随文字流动）。"""
        formula = (latex or "").strip()
        if not formula:
            return
        if self._cursor is None:
            self._cursor = self._add_paragraph(space_after=6,
                                               first_line_indent=FIRST_LINE_INDENT)
        self._append_math(self._cursor, formula, display=False)

    def add_table(self, headers: list, rows: list, col_widths: list = None):
        """插入带边框的数据表格。表头与单元格均支持 $...$ 公式标记。"""
        ncols = len(headers)
        nrows = 1 + len(rows)
        table = self._doc.add_table(rows=nrows, cols=ncols)
        self._style_table(table, ncols, col_widths)

        for j, h in enumerate(headers):
            self._set_cell_content(table.cell(0, j), h, bold=True)
        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                if j < ncols:
                    self._set_cell_content(table.cell(i + 1, j), val, bold=False)

        # 表格后补一个空段落，避免后续内容与表格粘连（与原实现一致）
        self._add_paragraph()
        self._cursor = None

    def _style_table(self, table, ncols: int, col_widths):
        """边框 / 居中 / 宽度 / 单元格默认字体。"""
        tbl_pr = table._tbl.tblPr
        # 宽度：整表撑满正文宽度（对应旧实现的 AutoFitWindow）
        tbl_w = OxmlElement('w:tblW')
        tbl_w.set(qn('w:type'), 'pct')
        tbl_w.set(qn('w:w'), '5000')
        tbl_pr.append(tbl_w)
        layout = OxmlElement('w:tblLayout')
        layout.set(qn('w:type'), 'autofit')
        tbl_pr.append(layout)
        borders = OxmlElement('w:tblBorders')
        for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
            el = OxmlElement('w:' + edge)
            el.set(qn('w:val'), 'single')
            el.set(qn('w:sz'), '4')
            el.set(qn('w:space'), '0')
            el.set(qn('w:color'), 'auto')
            borders.append(el)
        tbl_pr.append(borders)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER

        if col_widths:
            for j, w in enumerate(col_widths[:ncols]):
                width = Pt(float(w) * 28.35)      # cm → pt（与旧实现换算一致）
                for r in table.rows:
                    r.cells[j].width = width

    def _set_cell_content(self, cell, text, bold=False):
        """设置单元格内容：支持 $...$ 公式与宋体缺失字符的兜底样式。"""
        text = str(text) if text is not None else ""
        p = cell.paragraphs[0]
        self._format_paragraph(p, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing=1.0)
        parts = re.split(r"(\$[^$]+\$)", text) if "$" in text else [text]
        for part in parts:
            if not part:
                continue
            if part.startswith("$") and part.endswith("$") and len(part) > 2:
                self._append_math(p, part[1:-1], display=False)
            else:
                self._add_text_runs(p, part, BODY_FONT, TABLE_SIZE, bold)

    def add_image(self, image_path: str, width_cm: float = None):
        """插入图片并居中。width_cm 为可选宽度（cm），不指定则原尺寸。"""
        abs_path = os.path.abspath(image_path)
        if not os.path.exists(abs_path):
            print("  [WARNING] Image not found: %s" % abs_path)
            return
        p = self._add_paragraph(align=WD_ALIGN_PARAGRAPH.CENTER)
        run = p.add_run()
        if width_cm is not None:
            run.add_picture(abs_path, width=Cm(width_cm))
        else:
            run.add_picture(abs_path)
        self._cursor = None

    def add_data_photo(self, fallback_text: str = "（请在此处粘贴原始数据记录照片。）",
                       width_cm: float = 14.0):
        """插入识图时保存的原始数据照片；缺失或无法读取时保留原占位文字。"""
        photo = os.environ.get("LAB_DATA_PHOTO")
        if photo and os.path.isfile(photo):
            try:
                self.add_image(photo, width_cm=width_cm)
                return
            except Exception as exc:
                print("[警告] 原始数据照片插入失败（%s），改用占位文字：%s" % (exc, photo))
        self.add_paragraph(fallback_text)

    def add_page_break(self):
        """插入分页符。"""
        p = self._add_paragraph()
        run = p.add_run()
        self._apply_font(run, BODY_FONT, self._body_font_size, False)
        break_el = OxmlElement('w:br')
        break_el.set(qn('w:type'), 'page')
        run._element.append(break_el)
        self._cursor = None

    # ── 保存 ──────────────────────────────────────────

    def _save_tmp(self):
        """保存到临时文件（close() 时原子替换到目标路径）。"""
        self._doc.save(self._tmp_path)

    def save(self):
        """保存文档（写入临时文件，close() 时原子替换到目标路径）。"""
        if self._closed:
            return
        self._save_tmp()

    def close(self):
        """保存并把临时文件替换为目标报告；目标被占用时保留临时文件并给出提示。"""
        if self._closed:
            return
        try:
            self._save_tmp()
        except Exception as exc:
            print("[错误] 报告保存失败：%s" % exc)
        self._closed = True

        stat = _omml_stats()
        if stat['failed']:
            print("[警告] 公式转换失败 %d 条（已按文本写入）：" % stat['failed'])
            for formula, err in _omml_failures()[:5]:
                print("    - %s  <- %s" % (err, formula[:60]))

        try:
            os.replace(self._tmp_path, self.output_path)
            print("Report saved: %s" % self.output_path)
        except PermissionError:
            print("[错误] 目标报告文件正被占用（可能已在 Word 中打开）：%s" % self.output_path)
            print("[提示] 本次生成结果已保留为：%s" % self._tmp_path)
            print("[提示] 请关闭 Word 中的旧报告后重新生成，或将上述文件重命名使用")
        except FileNotFoundError:
            pass  # 保存阶段失败时无临时文件可替换
