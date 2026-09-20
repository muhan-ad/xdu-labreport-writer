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
M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
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

# ── 正文区宽度与公式自适应 ──
# A4 宽 595.28pt，左右页边距各 90pt；独立公式段还有 21pt 首行缩进。
TEXT_WIDTH_PT = 595.28 - 90 - 90
# Word **不会**在公式内部换行（整条公式是一个不可断单元，实测内联/显示两种写法都一样），
# 所以"公式优先只占一行"必须靠写入器自己判断：放得下单行居中输出，放不下才拆行。
# 判断依据是 _omml_width_pt() 的结构感知估算（见下），这里留一点安全余量。
MATH_FIT_MARGIN_PT = 4.0
# 估算校准系数：结构估算对分式/根号类式子会**系统性偏小**（实测 174 条真实公式，
# 由 Word 渲染后量取：估算 >250pt 的样本 实测/估算 中位 1.13、最大 1.19）。取 1.22
# 让估算整体略微高估——宁可把贴边的公式拆成两行，也不能让它顶出版心。
MATH_WIDTH_CALIB = 1.22
# 单元格左右内边距（pt，0.19cm 即 Word 默认值）与表格宽度折算：Word 的百分比表宽是
# 指"单元格内容宽度"，左右内边距加在表宽之外，不折算会让表格边框越过页边距。
TABLE_CELL_MAR_PT = 5.4
_TBL_PCT_FIX = (TEXT_WIDTH_PT - 2 * TABLE_CELL_MAR_PT) / TEXT_WIDTH_PT
# 已废弃的"整条缩小字号"兜底（fit_math_width）用的每字符估算宽，保留以便回滚：
MATH_CHAR_EM = 0.70
MATH_MIN_PT = 7.0
# 独立公式段的段前/段后间距（pt）＝一行正文的高度：公式与上下文之间"空出一行"。
# 同一个公式的多行只在**整块的首尾**留这个间距，行与行之间不留。
MATH_SPACE_PT = round(BODY_SIZE * LINE_SPACING, 1)      # 12 × 278/240 ≈ 13.9pt

_ENGINE_BANNER_PRINTED = False   # 每个进程只打印一次引擎标识，便于排查"跑的是哪条管线"

# ── 宋体缺失的 Unicode 上下标字符 → Word 原生上下标 ──
# 宋体（SimSun）不含 U+2070-207F（²³除外）/U+2080-209F 等字符，直接输出会
# 渲染为 □（豆腐块）。写入时把这些字符转为普通字符 + 原生上下标样式。
# 注意 ² ³ 也一并纳入：宋体虽有字形，但若同一串指数里 ²³ 走字形、⁻⁴ 走原生上标，
# 会出现"上标减号 + 全尺寸 3"这种基线不齐的混排（如 ×10⁻³）。统一走原生上标。
_SUBSCRIPT_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k',
    'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't',
    'ᵢ': 'i', 'ⱼ': 'j',
}
_SUPERSCRIPT_MAP = {
    '⁻': '-', '⁺': '+', '⁰': '0', '¹': '1', '²': '2', '³': '3',
    '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    'ⁿ': 'n', 'ⁱ': 'i',
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


def _top_level_cuts(latex: str, chars: str) -> list:
    r"""返回 latex 里**最外层**的指定字符下标。

    花括号、圆括号、方括号内部，以及被反斜杠转义的字符都不算（`\left(` 的括号
    仍按普通括号计深度，因此 `\left(...\right)` 内部同样不算最外层）。
    """
    idxs, depth, i, n = [], 0, 0, len(latex)
    while i < n:
        c = latex[i]
        if c == '\\':
            i += 2                      # 跳过命令名首字母或转义字符
            continue
        if c in '{[(':
            depth += 1
        elif c in '}])':
            depth = max(0, depth - 1)
        elif c in chars and depth == 0:
            idxs.append(i)
        i += 1
    return idxs


def _split_top(latex: str, chars: str) -> list:
    """按最外层的指定字符切分（分隔符本身丢弃），用于拆并列式子。"""
    s = (latex or "").strip()
    if not s:
        return []
    cuts = _top_level_cuts(s, chars)
    if not cuts:
        return [s]
    out, start = [], 0
    for c in cuts:
        piece = s[start:c].strip()
        if piece:
            out.append(piece)
        start = c + 1
    tail = s[start:].strip()
    if tail:
        out.append(tail)
    return out or [s]


def split_at_equals(latex: str) -> list:
    r"""按顶层等号把公式拆成多行：首行保留「符号 =」，其后每行以 = 开头。

    'A = B = C' → ['A = B', '= C']；只有一个等号（或没有）时原样返回单元素列表。
    """
    s = (latex or "").strip()
    if not s:
        return []
    idxs = _top_level_cuts(s, '=')
    if len(idxs) <= 1:
        return [s]
    lines = [s[:idxs[1]].strip()]
    for k in range(1, len(idxs)):
        end = idxs[k + 1] if k + 1 < len(idxs) else len(s)
        lines.append(s[idxs[k]:end].strip())
    return [x for x in lines if x] or [s]


# 顶层关系符：= 与"约等于"类命令。计算链「原公式 = 带入数据 ≈ 结果」里，\approx 就是
# "带入数据"与"结果"的分界，公式放不下时它和 = 一样是天然的断点。
_REL_CMD_RE = re.compile(
    r'\\(?:approx|leq|geq|le|ge|neq|ne|equiv|propto|sim|simeq|rightarrow|to)\b')


def _top_level_relations(latex: str) -> list:
    """返回顶层关系符的 (起, 止) 下标，按出现顺序。"""
    out, depth, i, n = [], 0, 0, len(latex)
    while i < n:
        c = latex[i]
        if c == '\\':
            m = _REL_CMD_RE.match(latex, i)
            if m and depth == 0:
                out.append((m.start(), m.end()))
                i = m.end()
                continue
            i += 2                          # 跳过命令名首字母或转义字符
            continue
        if c in '{[(':
            depth += 1
        elif c in '}])':
            depth = max(0, depth - 1)
        elif c == '=' and depth == 0:
            out.append((i, i + 1))
        i += 1
    return out


def split_at_relations(latex: str) -> list:
    r"""按顶层关系符（= / \approx / \leq …）拆行：首行保留「符号 =」，其后每行以关系符开头。

    'A = B \approx C' → ['A = B', '\approx C']；只有一个关系符（或没有）时原样返回。
    """
    s = (latex or "").strip()
    if not s:
        return []
    rels = _top_level_relations(s)
    if len(rels) <= 1:
        return [s]
    lines = [s[:rels[1][0]].strip()]
    for k in range(1, len(rels)):
        end = rels[k + 1][0] if k + 1 < len(rels) else len(s)
        lines.append(s[rels[k][0]:end].strip())
    return [x for x in lines if x] or [s]


# 超宽时可在其前折行的顶层二元运算符（长命令在前，避免被短模式截断）
_WRAP_OP_RE = re.compile(r'\\times|\\cdot|\\approx|\\pm')


def _wrap_math_line(latex: str, width_fn, max_pt: float) -> list:
    r"""单行公式仍超宽时，在最外层的二元运算符前折行（续行以该运算符开头）。

    找不到可断点（或断不动）时原样返回，交给上层按超宽处理。
    """
    lines, cur, guard = [], latex, 0
    while width_fn(cur) > max_pt and guard < 8:
        guard += 1
        cuts, depth, i, n = [], 0, 0, len(cur)
        while i < n:
            c = cur[i]
            if c == '\\':
                m = _WRAP_OP_RE.match(cur, i)
                if m and depth == 0 and m.start() > 0:
                    cuts.append(m.start())
                    i = m.end()
                    continue
                i += 2
                continue
            if c in '{[(':
                depth += 1
            elif c in '}])':
                depth = max(0, depth - 1)
            elif c in '+-' and depth == 0 and i > 0:
                cuts.append(i)
            i += 1
        if not cuts:
            break
        pick = None
        for st in cuts:                     # 取靠右、且左半段仍放得下的断点
            if width_fn(cur[:st].strip()) <= max_pt:
                pick = st
        if pick is None:
            pick = cuts[0]
        lines.append(cur[:pick].strip())
        cur = cur[pick:].strip()            # 续行保留运算符
    lines.append(cur)
    return [x for x in lines if x] or [latex]


# ── 分点句拆段 ──
# 标记：数字型（1）/(1)、中文数字型（一）、圈号 ①-⑩、序词型（首先/其次/…）、
#       其N（其一/其二…）、N是（一是/二是…）、第N（第一步/第一类/第一，…）
_ENUM_RE = re.compile(
    r'[（(]\s*[1-9]\s*[）)]'                        # （1）(1)
    r'|[（(]\s*[一二三四五六七八九十]\s*[）)]'        # （一）（二）
    r'|[\u2460-\u2469]'                             # ①-⑩
    r'|首先|其次|再次|最后'                          # 序词型
    r'|其[一二三四五六七八九十]'                      # 其一/其二/其三…
    r'|[一二三四五六七八九十]是'                      # 一是/二是/三是…
    r'|第[一二三四五六七八九十]'                      # 第一步/第一类/第一，…（尾字与边界共同裁决）
    r'|[1-9]、'                                     # 1、2、
)
# 只有紧跟在段首或这些句读点之后，标记才算"新的一点"
_ENUM_LEAD_OK = '。；：）)】」”'
# 序数词（不是分点）：第一位置读数。其余尾字（步/部分/类/组/项/条/位/是/，…）都按分点处理——
# 语料实测：「第二位是空程差」是分点、「第二项为零」是数学项引用，后者靠"标记前必须是句读点"
# 这条边界规则自动排除（它的前一字是「使/时/，」），不会误拆。
_ENUM_ORDINAL_TAIL = ('位置',)


def split_enumerated(text: str) -> list:
    r"""把「（1）…（2）…」「①…②…」「首先…其次…」「其二…其三…」这类分点句拆成独立段落。

    识别：`（1）`/`(1)`、`（一）`、`①-⑩`、`首先/其次/再次/最后`、`其N`、`N是`、`第N`、`1、`。
    仅当标记位于段首、或紧跟在句读点（。；：）之后时才拆；排除已确认的误报：
    公式编号引用（式（1）代入式（2））、区间列表（第 1、12、…、20 级）、
    序数词（第一位置读数）、数学项引用（第二项为零——前一字不是句读点，自动排除）。
    每点末尾的分号改为句号（独立成段后分号不再成立）。
    """
    s = text or ""
    if not s.strip():
        return [s]
    cuts = []
    for m in _ENUM_RE.finditer(s):
        i, tok = m.start(), m.group(0)
        prev = ''
        for j in range(i - 1, -1, -1):
            if not s[j].isspace():
                prev = s[j]
                break
        if i > 0 and prev not in _ENUM_LEAD_OK:
            continue
        if tok.startswith(('（', '(')):
            # 式（1）/（1）式：公式编号引用
            if prev == '式' or s[m.end():m.end() + 1] == '式':
                continue
        if tok.endswith('是') and prev == '其':
            continue                    # 「其N是」由 其N 那支处理，避免同一点切两次
        if tok in ('首先', '其次', '再次', '最后') and prev == '其':
            continue                    # 「其首先」不成立，保守跳过
        if tok.endswith('、'):
            nxt = s[m.end():m.end() + 1]
            if nxt.isdigit() or nxt == '…':
                continue                # 区间列表：第 1、12、…、20 级
        if tok.startswith('第'):
            tail = s[m.end():m.end() + 2]
            if any(tail.startswith(t) for t in _ENUM_ORDINAL_TAIL):
                continue                # 序数词而非分点：第一位置读数
        cuts.append(i)
    if not cuts:
        return [s]
    parts, start = [], 0
    for c in cuts:
        if c > start:
            parts.append(s[start:c])
        start = c
    parts.append(s[start:])
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if p.endswith('；'):
            p = p[:-1] + '。'
        out.append(p)
    return out or [s]


def _math_char_count(xml: str) -> int:
    """OMML 片段里的可见字符数（fit_math_width 的粗略估算，已不参与排版决策）。"""
    return sum(len(t) for t in re.findall(r'<m:t[^>]*>(.*?)</m:t>', xml, re.S))


# ── 公式渲染宽度估算（结构感知） ──
# 按"可见字符数 × 0.70em"估算对含分式/根号的式子会**严重高估**：分式的分子分母是
# 上下堆叠的，宽度应取两者较大者而非相加；根号只比被开方数宽出一个根号符。
# 高估的直接后果是"本该单行的公式被误判超宽而拆行"，与「公式优先只占一行」冲突，
# 所以这里改为按 OMML 结构逐元素估算。
_MATH_CHAR_W = {
    '=': 0.86, '+': 0.86, '\u2212': 0.62, '-': 0.62, '\u00b1': 0.86,
    '\u00d7': 0.86, '\u00f7': 0.86, '\u2248': 0.86, '\u2260': 0.86,
    '\u2264': 0.86, '\u2265': 0.86, '<': 0.86, '>': 0.86,
    '(': 0.33, ')': 0.33, '[': 0.33, ']': 0.33, '{': 0.33, '}': 0.33,
    '|': 0.30, ',': 0.28, '.': 0.26, ';': 0.28, ':': 0.28, '!': 0.28,
    ' ': 0.26, '\u00a0': 0.26, '\u2009': 0.20, '\u2002': 0.50, '\u2003': 0.50,
    '\u2211': 1.10, '\u220f': 1.10, '\u222b': 0.80, '\u221a': 0.75,
    '\u00b7': 0.30, '\u2026': 0.90, '\u00b0': 0.40, '\u2032': 0.30,
}
_MATH_STRUCT_PAD = 0.22         # 分式线/括号等的水平留白（em）
_MATH_RADICAL_W = 0.78          # 根号符本身的宽度（em）
_MATH_SCRIPT_RATIO = 0.62       # 上下标相对正文字号的比例
_MATH_NARY_W = 1.15             # 求和号/连乘号本身
_MATH_NS = M_NS


def _omml_local_name(tag):
    """取元素标签的本地名；非 m: 命名空间（如 w:rPr）与注释返回空串。"""
    if not isinstance(tag, str):
        return ''
    if tag.startswith('{%s}' % _MATH_NS):
        return tag[len(_MATH_NS) + 2:]
    if tag.startswith('{'):
        return ''
    return tag


def _char_width_em(ch: str) -> float:
    """单个可见字符的估算宽度（em）。"""
    w = _MATH_CHAR_W.get(ch)
    if w is not None:
        return w
    if ch.isdigit():
        return 0.50
    if 'a' <= ch <= 'z':
        return 0.55
    if 'A' <= ch <= 'Z':
        return 0.68
    if 0x0370 <= ord(ch) <= 0x03FF:         # 希腊字母（含 Δ Σ Ω π σ μ）
        return 0.62
    if ord(ch) > 0x2E80:                    # 中日韩字符（\text{仪} 等）
        return 1.00
    return 0.60


def _omml_width_em(el) -> float:
    """递归估算一个 OMML 元素的渲染宽度（em）。

    只对结构做"取较大者/加固定开销"的近似，不做真正的字体度量——精度靠实测标定
    （见 tests 里的标定表），目标是宁可略微高估也不低估（低估会导致公式越界）。
    """
    name = _omml_local_name(getattr(el, 'tag', None))
    if not name:
        return 0.0
    if name == 't':
        return sum(_char_width_em(c) for c in (el.text or ''))
    if name.endswith('Pr'):
        return 0.0                          # 属性元素（rPr/dPr/radPr…）不占宽

    def kids(*names):
        out = []
        for n in names:
            out.extend(el.findall('{%s}%s' % (_MATH_NS, n)))
        return out

    def w_of(els):
        return sum(_omml_width_em(e) for e in els)

    if name == 'f':                         # 分式：分子分母上下堆叠
        return max(w_of(kids('num')), w_of(kids('den'))) + _MATH_STRUCT_PAD
    if name == 'rad':                       # 根号：被开方数 + 根号符（度数槽为空）
        return w_of(kids('deg')) + w_of(kids('e')) + _MATH_RADICAL_W
    if name in ('sSub', 'sSup', 'sSubSup', 'sPre'):
        scripts = [w_of(kids('sub')), w_of(kids('sup'))]
        return w_of(kids('e')) + _MATH_SCRIPT_RATIO * max(scripts + [0.0])
    if name == 'd':                         # 定界符（\left( … \right)）
        pr = el.find('{%s}dPr' % _MATH_NS)
        pairs = 2.0
        if pr is not None:
            for nm in ('begChr', 'endChr'):
                c = pr.find('{%s}%s' % (_MATH_NS, nm))
                if c is not None and not (c.get('{%s}val' % _MATH_NS) or c.get('val')):
                    pairs -= 1.0            # 该侧定界符被置空（m:val=""）
        return w_of(kids('e')) + 0.33 * max(0.0, pairs)
    if name == 'nary':                      # 求和 / 连乘 / 积分
        return (_MATH_NARY_W + w_of(kids('sub')) + w_of(kids('sup'))
                + w_of(kids('e')))
    if name in ('acc', 'bar', 'groupChr', 'box', 'borderBox', 'phant'):
        return w_of(kids('e')) + 0.10
    if name == 'func':
        return w_of(kids('fName')) + w_of(kids('e'))
    if name in ('limLow', 'limUpp'):
        return max(w_of(kids('e')), w_of(kids('lim'))) + 0.15
    if name == 'eqArr':                     # 多行公式：取最宽的一行
        return max([w_of([e]) for e in kids('e')] + [0.0])
    if name == 'm':                         # 矩阵：按列取最大后求和
        rows = kids('mr')
        cols = []
        for r in rows:
            for i, c in enumerate(r.findall('{%s}e' % _MATH_NS)):
                while len(cols) <= i:
                    cols.append(0.0)
                cols[i] = max(cols[i], w_of([c]))
        return sum(cols) + 0.30 * max(0, len(cols) - 1)
    return sum(_omml_width_em(c) for c in el)


def _omml_width_pt(xml: str, size_pt: float) -> float:
    """估算 OMML 片段的渲染宽度（pt）；XML 不合法时返回 0（调用方退回字符估算）。"""
    if not xml:
        return 0.0
    try:
        root = parse_xml(xml)
    except Exception:
        return 0.0
    return _omml_width_em(root) * size_pt * MATH_WIDTH_CALIB


def _apply_math_size(xml: str, size_pt: float) -> str:
    """给 OMML 里每个数学 run 加上字号（<w:rPr><w:sz>），用于把超宽公式整体缩小。"""
    sz = str(int(round(size_pt * 2)))
    rpr = '<w:rPr><w:sz w:val="%s"/><w:szCs w:val="%s"/></w:rPr>' % (sz, sz)

    def repl(m):
        body = m.group(1)
        head = re.match(r'(<m:rPr>.*?</m:rPr>)?', body, re.S).group(1) or ''
        return '<m:r>' + head + rpr + body[len(head):] + '</m:r>'

    return re.sub(r'<m:r>(.*?)</m:r>', repl, xml, flags=re.S)


# 公式统一使用的数学字体（Word 的默认数学字体，随 Office 安装；显式写出来是为了
# 保证同一份报告里公式字体不受文档默认值影响）。
MATH_FONT = 'Cambria Math'


def _style_math_runs(xml: str, size_pt: float = None, bold: bool = False) -> str:
    r"""给 OMML 里每个数学 run 显式写字体/字号/加粗。

    为什么必须显式写：数学 run 默认不带 <w:rPr>，字号靠段落默认值继承——正文段落
    是 12pt、表格单元格是 10pt（表内文字 10pt），于是**表格里的公式会比同格文字大一号**。
    这里按调用方给的字号写死，表格内传 TABLE_SIZE 即可与格内文字齐平。
    <w:rPr> 必须插在 <m:rPr> 之后（CT_R 的元素顺序：rPr → w:rPr → m:t…）。
    """
    if not xml or (size_pt is None and not bold):
        return xml
    rpr = '<w:rPr>'
    if bold:
        rpr += '<w:b/><w:bCs/>'
    rpr += ('<w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>'
            % (MATH_FONT, MATH_FONT, MATH_FONT))
    if size_pt is not None:
        sz = str(int(round(size_pt * 2)))
        rpr += '<w:sz w:val="%s"/><w:szCs w:val="%s"/>' % (sz, sz)
    rpr += '</w:rPr>'

    def repl(m):
        body = m.group(1)
        head = re.match(r'(<m:rPr>.*?</m:rPr>)?', body, re.S).group(1) or ''
        return '<m:r>' + head + rpr + body[len(head):] + '</m:r>'

    return re.sub(r'<m:r>(.*?)</m:r>', repl, xml, flags=re.S)


def fit_math_width(xml: str, available_pt: float, base_pt: float) -> str:
    """把超宽公式整体缩小到可用宽度内（Word 不会在公式内部折行）。

    available_pt：该公式可占用的宽度（pt）；base_pt：原本的字号（pt）。
    估算公式渲染宽度 ≈字符数 × MATH_CHAR_EM × 字号；超出才缩小，缩放下限 MATH_MIN_PT。
    """
    n = _math_char_count(xml)
    if n <= 0 or available_pt <= 0:
        return xml
    if MATH_CHAR_EM * base_pt * n <= available_pt:
        return xml
    size = max(MATH_MIN_PT, available_pt / (MATH_CHAR_EM * n))
    if size >= base_pt - 0.05:
        return xml
    return _apply_math_size(xml, size)


def _set_tbl_width_pct(table, pct: int):
    """设置表格宽度为版心宽度的百分比（按"渲染后正好撑满版心"折算）。

    注意两点（都是实测踩出来的）：
    1. python-docx 默认已带一个 <w:tblW w:type="auto" w:w="0"/>，直接 append 会出现
       两个 tblW，Word 只认第一个 → 宽度设置静默失效（曾踩）。这里先删掉已有的，再按
       OOXML 的元素顺序插到 tblBorders 之前。
    2. Word 的百分比表宽指的是**单元格内容宽度**，左右单元格内边距会加在表宽之外：
       pct=100% 的表格实测渲染成 427.2pt，比 415.3pt 的版心每侧凸出约 6pt（表格边框
       越过页边距）。所以按 (版心 − 2×内边距)/版心 折算，并显式写死内边距，避免依赖
       各版本 Word 的默认值。实测折算后为 415.7pt（仅剩边框线宽的 0.25pt）。
    """
    tbl_pr = table._tbl.tblPr
    for old in tbl_pr.findall(qn('w:tblW')):
        tbl_pr.remove(old)
    el = OxmlElement('w:tblW')
    el.set(qn('w:type'), 'pct')
    el.set(qn('w:w'), str(int(round(pct * _TBL_PCT_FIX))))
    ref = tbl_pr.find(qn('w:tblBorders'))
    if ref is not None:
        ref.addprevious(el)
    else:
        tbl_pr.append(el)
    # 显式单元格左右内边距（CT_TblPrBase 顺序：… tblLayout → tblCellMar → tblLook）
    for old in tbl_pr.findall(qn('w:tblCellMar')):
        tbl_pr.remove(old)
    mar = OxmlElement('w:tblCellMar')
    for side in ('left', 'right'):
        e = OxmlElement('w:' + side)
        e.set(qn('w:w'), str(int(TABLE_CELL_MAR_PT * 20)))
        e.set(qn('w:type'), 'dxa')
        mar.append(e)
    look = tbl_pr.find(qn('w:tblLook'))
    if look is not None:
        look.addprevious(mar)
    else:
        tbl_pr.append(mar)


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
        # 公式排版要反复探测宽度/试拆行，缓存转换结果避免同一条公式被反复转换
        self._omml_cache = {}        # (latex, display, jc) -> OMML 字符串
        self._width_cache = {}       # latex -> 估算宽度 pt

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
        # 空段去重：add_table 末尾已补过分隔空段，源端再 add_paragraph("") 会叠加出
        # 近两行空白（实测表格与后文间距 38.7pt）。只对"文档末尾那个空段"去重——
        # 否则会把光标指回表格之前的空段，后续内容被写到表格前面去。
        if not text and self._is_empty_paragraph(self._cursor):
            el = getattr(self._cursor, '_p', None)
            if el is not None:
                parent = el.getparent()
                sibs = [c for c in parent if not str(c.tag).endswith('}sectPr')]
                if sibs and sibs[-1] is el:
                    # 复用这个空段（避免多空一行），但**必须把本次请求的段落格式应用上去**：
                    # 公式段走的就是这条路（add_table 补的空段 → 源端 add_paragraph("")
                    # → add_math），早期直接 return 会让公式被写进"无对齐、无段间距"的
                    # 空段里——表现为多行公式的首行不居中、且紧贴上一段。
                    self._format_paragraph(self._cursor, align=align,
                                           space_before=space_before,
                                           space_after=space_after,
                                           first_line_indent=first_line_indent)
                    return self._cursor
        p = self._doc.add_paragraph()
        self._format_paragraph(p, align=align, space_before=space_before,
                               space_after=space_after,
                               first_line_indent=first_line_indent)
        if text:
            self._add_text_runs(p, text, font_name, font_size, bold)
        # 光标语义与旧实现（Word Selection 停在文档末尾）一致：新建的段落就是后续
        # add_run / add_inline_math 的写入目标。少了这一步，富文本里的 $...$ 公式会被
        # 写到另一段去（文字与公式分离、多条公式连成一行顶出页面）——曾导致排版错乱。
        self._cursor = p
        return p

    @staticmethod
    def _is_empty_paragraph(p) -> bool:
        """段落是否为空（既无文字 run 也无公式）。p 为 python-docx 的 Paragraph。"""
        if p is None:
            return True
        el = getattr(p, '_p', p)                # 兼容传入 Paragraph 或 lxml 元素
        if el is None:
            return True
        if el.findall('.//' + qn('w:t')):
            return False
        return el.find('.//{%s}oMath' % M_NS) is None

    def _append_math(self, paragraph, latex: str, display: bool = False,
                     available_pt: float = None, base_pt: float = None,
                     jc: str = '', size_pt: float = None, bold: bool = False) -> bool:
        """把 LaTeX 公式作为 OMML 追加到段落；失败时回退为纯文本，返回是否成功。

        display=True 时写 <m:oMathPara>，jc 控制其在段落内的对齐（'' 为 Word 默认居中）。
        size_pt/bold：给数学 run 显式写字号/加粗——不传 size_pt 时用正文字号；
        表格单元格传 TABLE_SIZE，使公式与同格文字同号。
        available_pt/base_pt 已不再使用（公式字号统一，不按宽度缩小），保留以便回滚。
        """
        xml = self._math_omml(latex, display=display, jc=jc)
        if xml is None:
            plain = latex_to_plain(latex)
            print("[警告] 公式转换失败，已按文本写入：%r" % (latex[:80],))
            if plain:
                self._add_text_runs(paragraph, plain, BODY_FONT, self._body_font_size)
            return False
        xml = _style_math_runs(xml, size_pt if size_pt else self._body_font_size, bold)
        if available_pt:
            xml = fit_math_width(xml, available_pt, base_pt or self._body_font_size)
        try:
            paragraph._p.append(parse_xml(xml))
        except Exception as exc:
            print("[警告] 公式 XML 写入失败（%s），已按文本写入：%r" % (exc, latex[:80]))
            plain = latex_to_plain(latex)
            if plain:
                self._add_text_runs(paragraph, plain, BODY_FONT, self._body_font_size)
            return False
        return True

    # ── 公式宽度估算 ──────────────────────────────────────

    def _math_omml(self, latex: str, display: bool = False, jc: str = ''):
        """LaTeX → OMML（带缓存）：排版决策会反复探测同一条公式，避免重复转换。"""
        key = (latex, display, jc)
        if key not in self._omml_cache:
            self._omml_cache[key] = (latex_to_omathpara(latex, jc) if display
                                     else latex_to_omml(latex))
        return self._omml_cache[key]

    def _math_width_pt(self, latex: str) -> float:
        """估算一条公式渲染后的宽度（pt），带缓存。

        按 OMML 结构估算（分式取分子/分母较大者，根号只加根号符），而不是按可见
        字符数——后者对分式类公式会高估一倍以上，把本该单行的公式误判成超宽。
        """
        w = self._width_cache.get(latex)
        if w is None:
            xml = self._math_omml(latex, display=False)
            if xml:
                w = _omml_width_pt(xml, self._body_font_size)
            if not w:                       # 转换失败（将回退为纯文本）时按字符估
                w = sum(_char_width_em(c) for c in latex) * self._body_font_size
            self._width_cache[latex] = w
        return w

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

    def add_paragraph(self, text: str, bold: bool = False):
        """正文段落（首行缩进）；含分点标记（（1）/①/首先…）时每点单独成段。

        bold=True 用于「课后思考题」的题目这类需要突出的正文行——只加粗字重，
        不改成标题样式（题目是正文里的问句，不是章节标题）。
        """
        pieces = split_enumerated(text)
        p = None
        for piece in pieces:
            p = self._add_paragraph(piece, font_size=self._body_font_size, bold=bold,
                                    first_line_indent=FIRST_LINE_INDENT)
        return p

    def add_paragraph_rich(self, text: str):
        """富文本正文（Markdown 兼容）：自动分段并解析 $...$ 内联公式。

        变体/AI 润色章节整段文字的统一入口：按换行拆段，$$...$$ 独立公式块
        转为居中显示公式（add_math），$...$ 内联公式随文字流动（add_inline_math），
        普通文字宋体正文（首行缩进）。含分点标记时每点单独成段。
        """
        for kind, content in split_rich_blocks(text):
            if kind == "math":
                self.add_math(content)
                continue
            for piece in split_enumerated(content):
                p = self._add_paragraph(space_after=6, first_line_indent=FIRST_LINE_INDENT)
                for part in re.split(r"(\$[^$]*\$)", piece):
                    if not part:
                        continue
                    if part.startswith("$") and part.endswith("$") and len(part) > 2:
                        self.add_inline_math(part)
                    else:
                        self._add_text_runs(p, part, BODY_FONT, self._body_font_size)

    def add_math(self, latex: str):
        r"""插入独立显示公式。版式规则（「优先只占一行」，放不下才逐级退让）：

        ① 整条公式放得下 → **单行居中**输出；
        ② 放不下 → 顶层逗号 / \quad 分隔的并列式子各自成块，每块重走 ①③④；
        ③ 单块仍放不下 → 按顶层关系符（= / \approx）拆行，拆出来正好是
           「原公式 / 带入数据 / 结果」；
        ④ 拆完仍放不下 → 在顶层二元运算符前折行，字号不变。

        多行的每一行**各自居中**；段前/段后空一行只加在整块的首尾（行间不留空行）。
        字号始终与正文一致（不再按宽度自动缩小）。
        """
        formula = (latex or "").strip()
        if formula:
            self._emit_math(formula, first=True, last=True)

    def _emit_math(self, formula: str, first: bool, last: bool):
        """公式排版决策阶梯：单行 → 分块 → 关系符拆行 → 运算符折行。"""
        if self._math_width_pt(formula) <= TEXT_WIDTH_PT - MATH_FIT_MARGIN_PT:
            p = self._add_paragraph(
                align=WD_ALIGN_PARAGRAPH.CENTER,
                space_before=MATH_SPACE_PT if first else 0.0,
                space_after=MATH_SPACE_PT if last else 0.0)
            self._append_math(p, formula, display=True)
            return
        # ② 并列式子（顶层逗号 / \quad）各自成块——只有整条放不下时才拆开
        blocks = [b for b in
                  _split_top(re.sub(r'\\qquad|\\quad', ' , ', formula), ',') if b]
        if len(blocks) > 1:
            for i, b in enumerate(blocks):
                self._emit_math(b, first and i == 0, last and i == len(blocks) - 1)
            return
        # ③ 按顶层关系符（= / \approx）拆行：原公式 / 带入数据 / 结果
        lines = split_at_relations(formula)
        if len(lines) > 1:
            self._emit_math_lines(lines, first, last)
            return
        # ④ 没有可拆的关系符：整条按顶层二元运算符折行（字号不变）
        self._emit_math_lines([formula], first, last)

    def _emit_math_lines(self, lines, first: bool, last: bool):
        """多行公式块：**每一行各自居中**；段前/段后空一行只加在整块首尾。

        不再做"续行缩进到等号之后"的对齐——那样短行会贴向左侧，看着不像居中。
        """
        _w = self._math_width_pt
        plan = []
        for ln in lines:
            plan.extend(_wrap_math_line(ln, _w, TEXT_WIDTH_PT - MATH_FIT_MARGIN_PT))
        for k, sub in enumerate(plan):
            p = self._add_paragraph(
                align=WD_ALIGN_PARAGRAPH.CENTER,
                space_before=MATH_SPACE_PT if (first and k == 0) else 0.0,
                space_after=MATH_SPACE_PT if (last and k == len(plan) - 1) else 0.0)
            # 公式块内不跨页断开
            p.paragraph_format.keep_with_next = (k < len(plan) - 1)
            self._append_math(p, sub, display=True)

    def add_run(self, text: str, bold: bool = False):
        """在当前段落末尾追加文字（不另起段落），与 add_inline_math() 配合使用。"""
        if not text:
            return
        if self._cursor is None:
            self._cursor = self._add_paragraph(space_after=6,
                                               first_line_indent=FIRST_LINE_INDENT)
        self._add_text_runs(self._cursor, text, BODY_FONT, self._body_font_size, bold)

    def add_inline_math(self, latex: str, bold: bool = False):
        """在当前段落内插入内联公式（不换行，随文字流动）。"""
        formula = (latex or "").strip()
        if not formula:
            return
        if self._cursor is None:
            self._cursor = self._add_paragraph(space_after=6,
                                               first_line_indent=FIRST_LINE_INDENT)
        self._append_math(self._cursor, formula, display=False, bold=bold)

    def add_table(self, headers: list, rows: list, col_widths: list = None):
        """插入带边框的数据表格。表头与单元格均支持 $...$ 公式标记。"""
        ncols = len(headers)
        nrows = 1 + len(rows)
        table = self._doc.add_table(rows=nrows, cols=ncols)
        col_pt = self._style_table(table, ncols, col_widths)

        for j, h in enumerate(headers):
            self._set_cell_content(table.cell(0, j), h, bold=True)
        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                if j < ncols:
                    self._set_cell_content(table.cell(i + 1, j), val, bold=False)

        # 表格后补一个空段落，避免后续内容与表格粘连（与原实现一致）
        self._add_paragraph()

    def _style_table(self, table, ncols: int, col_widths):
        """边框 / 居中 / 宽度 / 列宽；返回各列可用宽度（pt），供单元格公式缩放用。"""
        tbl_pr = table._tbl.tblPr
        # 宽度：整表撑满版心（对应旧实现的 AutoFitWindow）。
        # 注意：python-docx 模板已带一个 tblW，必须替换而不是追加，否则 Word 只认第一个。
        _set_tbl_width_pct(table, 5000)
        # 列宽用 fixed 而不是 autofit：autofit 下 Word 会按内容自行加宽列，
        # 列数多时（如理想气体的 11 列，每列仅 37.8pt）表头「测量次数」放不下，
        # 整表被撑到 426.7pt、两侧各越出页边距约 6pt。fixed 会按给定列宽排版、
        # 内容超宽时在格内换行，表格边框始终落在版心内。
        layout = OxmlElement('w:tblLayout')
        layout.set(qn('w:type'), 'fixed')
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

        # 各列可用宽度：给了 col_widths（cm）就按比例换算到版心宽，否则等分
        if col_widths:
            given = [float(w) * 28.35 for w in col_widths[:ncols]]     # cm → pt（与旧实现一致）
            total = sum(given) or 1.0
            scale = TEXT_WIDTH_PT / total
            col_pt = [g * scale for g in given]
            if len(col_pt) < ncols:                                    # 列数不足时补等分
                col_pt += [TEXT_WIDTH_PT / ncols] * (ncols - len(col_pt))
            for j, pt in enumerate(given):
                width = Pt(pt)
                for r in table.rows:
                    r.cells[j].width = width
        else:
            col_pt = [TEXT_WIDTH_PT / ncols] * ncols
        return [max(20.0, w - 12.0) for w in col_pt]     # 扣掉单元格左右内边距

    def _set_cell_content(self, cell, text, bold=False, available_pt=None):
        """设置单元格内容：支持 $...$ 公式与宋体缺失字符的兜底样式。"""
        text = str(text) if text is not None else ""
        p = cell.paragraphs[0]
        self._format_paragraph(p, align=WD_ALIGN_PARAGRAPH.CENTER, line_spacing=1.0)
        parts = re.split(r"(\$[^$]+\$)", text) if "$" in text else [text]
        for part in parts:
            if not part:
                continue
            if part.startswith("$") and part.endswith("$") and len(part) > 2:
                # 单元格内公式按表格字号写死：格内文字是 TABLE_SIZE，公式若不显式给字号
                # 会继承段落默认的 12pt，比同格文字大一号（曾如此）。
                self._append_math(p, part[1:-1], display=False,
                                  size_pt=TABLE_SIZE, bold=bold)
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
