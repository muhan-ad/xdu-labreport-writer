"""LaTeX → OMML（Office Math Markup Language）转换。

用途：在不依赖 Microsoft Word 的前提下生成 **Word 原生可编辑公式**。
    LaTeX --latex2mathml--> MathML --mathml2omml--> OMML
生成的 OMML 片段直接插入 python-docx 的段落 XML 中。

设计要点：
- 两个依赖都是纯 Python、MIT 许可，可随内置运行时一起打包（无需 Word、无编译扩展）；
- 转换失败不抛异常中断生成，而是返回 None 让调用方回退为文本，保证报告始终能产出；
  正常语料下失败数为 0（由 tests/omml_test.py 对全部 26 个实验的公式做全量校验）；
- **生成的 OMML 强制做 XML 合法性校验**：非法片段会让 Word 判定文档损坏而拒绝打开，
  这类错误必须在写入前拦住（实测 mathml2omml 0.0.2 的 groupChr 模板有闭合标签 bug，
  由 _repair_groupchr 精确修复）；
- 传入的公式里 **不能** 含未替换的 %%DATA:xxx%% 占位符——`%` 在 LaTeX 中是注释符，
  会把后续内容整段吃掉（静默错误）。占位符由 common.variants.render_variant 在生成前
  替换为数值。
"""

import os
import re
import sys

# 公式转换依赖（纯 Python、MIT）：内置副本优先（版本固定、各机器行为一致），
# 随资源分发 common/_vendor/ —— **不必重建随包运行时**，也能被数据包热更新覆盖。
# 内置副本缺失时才退回运行时里 pip 安装的版本（升级方式见 scripts/vendor-math-deps.py）。
_VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_vendor')


def _import_math_deps():
    if os.path.isdir(_VENDOR_DIR) and _VENDOR_DIR not in sys.path:
        sys.path.insert(0, _VENDOR_DIR)
    try:
        import mathml2omml as _m2o
        from latex2mathml.converter import convert as _l2m
        return _m2o, _l2m
    except ImportError as exc:            # 两处都没有时给出可执行的修复指引
        raise ImportError(
            '缺少公式转换依赖（latex2mathml / mathml2omml）：%s\n'
            '正常情况下会使用内置副本 %s；若该目录缺失，请执行：\n'
            '    python scripts/vendor-math-deps.py\n'
            '或在当前 Python 环境安装：pip install -r requirements-runtime.txt'
            % (exc, _VENDOR_DIR)) from exc


_mathml2omml, _latex_to_mathml = _import_math_deps()

from lxml import etree as _etree

M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

_OMML_OPEN = '<m:oMath>'
_OMML_CLOSE = '</m:oMath>'

_stats = {'ok': 0, 'failed': 0, 'repaired': 0, 'normalized': 0}
_failures = []          # [(公式, 错误信息)]

# 只起分组作用的 LaTeX 环境：AI 改写/手写变体里常见，转换器不认（\begin{aligned} 会直接
# 抛 SAXParseException 并退化成乱码文本）。剥掉环境标记、去掉对齐符 &、行分隔 \\ 当作逗号，
# 结果是一行内联公式——比整条退化成文本好得多。
_WRAPPER_ENVS = ('aligned', 'alignedat', 'gathered', 'split', 'array',
                 'eqnarray', 'multline', 'align', 'gather')


def _normalize_environments(formula: str):
    """剥离只起分组作用的 LaTeX 环境，返回 (公式, 处理处数)。"""
    handled = False
    for env in _WRAPPER_ENVS:
        begin = re.compile(r'\\begin\{' + env + r'\}(?:\{[^{}]*\})*')
        end = re.compile(r'\\end\{' + env + r'\}')
        if begin.search(formula) or end.search(formula):
            formula = begin.sub('', formula)
            formula = end.sub('', formula)
            handled = True
    if handled:
        formula = formula.replace('&', '')                 # 对齐符
        formula = re.sub(r'\\\\', r',\\ ', formula)        # 行分隔 → 逗号
    return formula, (1 if handled else 0)


def stats() -> dict:
    """转换统计：{'ok': n, 'failed': n, 'repaired': n, 'normalized': n}。"""
    return dict(_stats)


def failures() -> list:
    """转换失败明细 [(公式, 错误)]，供生成结束后汇总打印。"""
    return list(_failures)


def reset_stats():
    _stats['ok'] = 0
    _stats['failed'] = 0
    _stats['repaired'] = 0
    _stats['normalized'] = 0
    del _failures[:]


# 同类上下标连写（T_{0}_i、x^{2}^{3}）：LaTeX 里非法，多见于手写与 AI 改写。
# 按作者本意合并为一个下标/上标组（T_{0}_i → T_{0i}）。
_DOUBLE_SCRIPT_BRACED = re.compile(r'([_^])\{([^{}]*)\}\1\{([^{}]*)\}')
_DOUBLE_SCRIPT_PLAIN = re.compile(r'([_^])\{([^{}]*)\}\1([A-Za-z0-9])')


def _merge_double_scripts(formula: str):
    """合并连写的同类上下标，返回 (公式, 修复处数)。"""
    n = 0
    while True:
        new, k = _DOUBLE_SCRIPT_BRACED.subn(r'\1{\2\3}', formula)
        n += k
        formula = new
        if not k:
            break
    formula, k = _DOUBLE_SCRIPT_PLAIN.subn(r'\1{\2\3}', formula)
    return formula, n + k


def _preprocess(latex: str) -> str:
    """送入转换器前的轻量清洗（转换器吃标准 LaTeX，不做 UnicodeMath 改写）。"""
    s = (latex or '').replace('\r', ' ').replace('\n', ' ')
    s = s.strip()
    if s.startswith('$$') and s.endswith('$$') and len(s) > 4:
        s = s[2:-2]
    elif s.startswith('$') and s.endswith('$') and len(s) > 2:
        s = s[1:-1]
    # 全角空格与零宽字符会干扰解析
    s = s.replace('\u3000', ' ').replace('\u200b', '')
    return s.strip()


def _wrap(omml: str) -> str:
    inner = omml
    if inner.startswith(_OMML_OPEN) and inner.endswith(_OMML_CLOSE):
        inner = inner[len(_OMML_OPEN):-len(_OMML_CLOSE)]
    return '<m:oMath xmlns:m="%s" xmlns:w="%s">%s</m:oMath>' % (M_NS, W_NS, inner)


def _repair_groupchr(omml: str):
    r"""修 mathml2omml 0.0.2 的 groupChr 闭合标签 bug，返回 (修复后的串, 修复处数)。

    该库在 \bar / \underline 等「可伸缩重音」公式里生成：
        <m:groupChr><m:groupChrPr><m:chr .../><m:pos .../></m:groupChr><m:e>…
    即把 <m:groupChrPr> 用 </m:groupChr> 闭合，产出的是**非法 XML**——
    Word 会判定文档损坏而拒绝打开（不是渲染问题，是文件级错误）。
    修复方式：若某个 <m:groupChrPr> 之后先遇到 </m:groupChr> 而没遇到 </m:groupChrPr>，
    就把那个闭合标签补成 </m:groupChrPr>。
    """
    out = []
    pos = 0
    fixed = 0
    while True:
        start = omml.find('<m:groupChrPr>', pos)
        if start < 0:
            out.append(omml[pos:])
            break
        close_pr = omml.find('</m:groupChrPr>', start)
        close_gc = omml.find('</m:groupChr>', start)
        if close_gc != -1 and (close_pr == -1 or close_gc < close_pr):
            out.append(omml[pos:close_gc])
            out.append('</m:groupChrPr>')
            pos = close_gc + len('</m:groupChr>')      # 跳过被替换掉的原闭合标签
            fixed += 1
        else:
            pos = start + len('<m:groupChrPr>')
            out.append(omml[start:pos])
    return ''.join(out), fixed


def _find_close(omml: str, open_idx: int, open_tag: str, close_tag: str) -> int:
    """返回与 open_idx 处开标签匹配的闭标签下标（考虑同名嵌套）；找不到返回 -1。"""
    depth = 0
    i = open_idx
    while True:
        o = omml.find(open_tag, i)
        c = omml.find(close_tag, i)
        if c < 0:
            return -1
        if 0 <= o < c:
            depth += 1
            i = o + len(open_tag)
        else:
            depth -= 1
            if depth == 0:
                return c
            i = c + len(close_tag)


def _fix_rad_levels(text: str):
    """递归修复 text 内所有根号（含嵌套），返回 (修复后的串, 修复处数)。"""
    out = []
    pos = 0
    fixed = 0
    while True:
        start = text.find('<m:rad>', pos)
        if start < 0:
            out.append(text[pos:])
            break
        end = _find_close(text, start, '<m:rad>', '</m:rad>')
        if end < 0:                     # 结构异常：原样保留，不猜
            out.append(text[pos:])
            break
        head_end = start + len('<m:rad>')
        inner = text[head_end:end]
        inner, inner_fixed = _fix_rad_levels(inner)      # 先修内层根号
        fixed += inner_fixed
        # 只看本层的直接子节点：跳过 radPr 后应当是 deg（缺失则补）
        probe = inner
        if probe.startswith('<m:radPr>'):
            pe = probe.find('</m:radPr>')
            if pe >= 0:
                probe = probe[pe + len('</m:radPr>'):]
        if not (probe.startswith('<m:deg>') or probe.startswith('<m:deg/>')
                or probe.startswith('<m:deg ')):
            pr_end = inner.find('</m:radPr>')
            if pr_end >= 0:
                cut = pr_end + len('</m:radPr>')
                inner = inner[:cut] + '<m:deg/>' + inner[cut:]
            else:
                inner = '<m:deg/>' + inner
            fixed += 1
        out.append(text[pos:head_end])
        out.append(inner)
        out.append('</m:rad>')
        pos = end + len('</m:rad>')
    return ''.join(out), fixed


def _ensure_rad_degree(omml: str):
    r"""给缺少 <m:deg/> 的根号补上空度数占位，返回 (修复后的串, 修复处数)。

    Word 生成根号时总会写出 <m:deg/>（即使度数被隐藏），mathml2omml 则直接省略。
    省略后，应用内预览所用的 docx-preview 会在取度数子节点时抛
    "Cannot read properties of undefined"，导致**整个预览回退为纯文本**；
    其它渲染器（Word 本体）则不受影响，属于典型的"Word 能开、预览崩"。
    按 OMML 元素顺序（radPr? → deg? → e?）插入，与 Word 输出保持一致。
    """
    return _fix_rad_levels(omml)


def _xml_ok(xml: str) -> bool:
    """OMML 片段必须是合法 XML：非法片段写进 docx 会让 Word 判定文件损坏。"""
    try:
        _etree.fromstring(xml.encode('utf-8'))
        return True
    except Exception:
        return False


# ── 重音/上下划线规范化 ──
# mathml2omml 把 \hat、\tilde、\dot、\overline、\underline 一律映射成 m:limUpp / m:limLow
# （上下限对象），把 \bar、\vec 映射成 m:groupChr（可伸缩组字符）。Word 对 limUpp/limLow 的
# 排版是**整字号的限位字符**（像 lim 那样另起一行的大号字符），groupChr 则按可伸缩字符拉伸，
# 观感都与 Word 自己的公式编辑器不一致（\hat 变成一个大 ^ 压在字母上）。
# 这里改写成 Word 的原生形式：
#   \bar / \hat / \tilde / \dot / \vec … → m:acc（重音对象，字符以组合符形式居中压在基上）
#   \overline / \underline              → m:bar（划线对象，画真正的横线）
_ACCENT_CHARS = {
    '^': '\u0302',            # 组合抑扬符
    '~': '\u0303',            # 组合波浪
    '\u02dc': '\u0303',       # 小波浪
    '\u02d9': '\u0307',       # 组合上点
    '\u00a8': '\u0308',       # 组合分音符
    '\u00af': '\u0304',       # 组合长音符（\bar）
    '\u02c7': '\u030c',       # 组合抑扬符（caron）
    '`': '\u0300',            # 组合抑音符
    '\u2192': '\u20d7',       # 组合右箭头（\vec）
    '\u2190': '\u20d6',       # 组合左箭头
}
_BAR_CHARS = {'\u2015', '\u2014', '\u2013', '\u2500', '\u005f', '\u203e', '\u2212'}


def _visible_text(fragment: str) -> str:
    """取 OMML 片段里 <m:t> 的可见文本。"""
    return ''.join(re.findall(r'<m:t[^>]*>(.*?)</m:t>', fragment, re.S)).strip()


def _wrap_e(base: str) -> str:
    """把基座内容包成 <m:e>；已经是 <m:e>…</m:e> 时原样返回（避免嵌套两层 m:e）。"""
    b = base.strip()
    if b.startswith('<m:e>') and b.endswith('</m:e>'):
        return b
    return '<m:e>%s</m:e>' % b


def _rewrite_one_accent(omml: str):
    """改写第一处可规范化的重音/划线，返回 (新串, 是否改动)。"""
    # ① m:limUpp / m:limLow：仅当限位槽只是一个重音或划线字符时才改写
    for tag, pos in (('<m:limUpp>', 'top'), ('<m:limLow>', 'bot')):
        close_tag = '</%s>' % tag[1:-1]        # '<m:limUpp>' → '</m:limUpp>'
        start = omml.find(tag)
        if start < 0:
            continue
        end = _find_close(omml, start, tag, close_tag)
        if end < 0:
            continue
        inner = omml[start + len(tag):end]
        lim_start = inner.rfind('<m:lim>')
        lim_end = inner.rfind('</m:lim>')
        if lim_start < 0 or lim_end < lim_start:
            continue
        base = inner[:lim_start]
        char = _visible_text(inner[lim_start + len('<m:lim>'):lim_end])
        if len(char) != 1:
            continue
        if char in _BAR_CHARS:
            new = ('<m:bar><m:barPr><m:pos m:val="%s"/></m:barPr>%s</m:bar>'
                   % (pos, _wrap_e(base)))
        elif char in _ACCENT_CHARS and pos == 'top':
            new = ('<m:acc><m:accPr><m:chr m:val="%s"/></m:accPr>%s</m:acc>'
                   % (_ACCENT_CHARS[char], _wrap_e(base)))
        else:
            continue
        return omml[:start] + new + omml[end + len(close_tag):], True

    # ② m:groupChr：chr+pos 在 groupChrPr 里（\bar → ¯，\vec → →）
    start = omml.find('<m:groupChr>')
    if start >= 0:
        end = _find_close(omml, start, '<m:groupChr>', '</m:groupChr>')
        if end >= 0:
            inner = omml[start + len('<m:groupChr>'):end]
            pr_end = inner.find('</m:groupChrPr>')
            if pr_end >= 0:
                pr = inner[:pr_end]
                base = inner[pr_end + len('</m:groupChrPr>'):]
                m_chr = re.search(r'<m:chr m:val="([^"]*)"/>', pr)
                m_pos = re.search(r'<m:pos m:val="([^"]*)"/>', pr)
                char = m_chr.group(1) if m_chr else ''
                pos = m_pos.group(1) if m_pos else 'top'
                if len(char) == 1 and char in _BAR_CHARS:
                    new = ('<m:bar><m:barPr><m:pos m:val="%s"/></m:barPr>%s</m:bar>'
                           % ('top' if pos == 'top' else 'bot', _wrap_e(base)))
                    return omml[:start] + new + omml[end + len('</m:groupChr>'):], True
                if len(char) == 1 and char in _ACCENT_CHARS and pos == 'top':
                    new = ('<m:acc><m:accPr><m:chr m:val="%s"/></m:accPr>%s</m:acc>'
                           % (_ACCENT_CHARS[char], _wrap_e(base)))
                    return omml[:start] + new + omml[end + len('</m:groupChr>'):], True
    return omml, False


def _normalize_accents(omml: str):
    """把上/下划线、重音改成 Word 原生元素，返回 (新串, 改写处数)。"""
    fixed = 0
    for _ in range(200):            # 上限兜底，防意外死循环
        omml, changed = _rewrite_one_accent(omml)
        if not changed:
            break
        fixed += 1
    return omml, fixed


def latex_to_omml(latex: str):
    """LaTeX → 行内 OMML 片段（含命名空间声明）；失败返回 None。"""
    formula = _preprocess(latex)
    if not formula:
        return None
    if '%%DATA:' in formula:
        _stats['failed'] += 1
        _failures.append((formula, '公式含未替换的 %%DATA:%% 占位符（会静默丢内容）'))
        return None
    formula, n_env = _normalize_environments(formula)
    if n_env:
        _stats['normalized'] += n_env
    formula, n_norm = _merge_double_scripts(formula)
    if n_norm:
        _stats['normalized'] += n_norm
    try:
        mathml = _latex_to_mathml(formula)
        omml = _mathml2omml.convert(mathml)
    except Exception as exc:                     # 转换器对个别语法可能不兼容
        _stats['failed'] += 1
        _failures.append((formula, '%s: %s' % (type(exc).__name__, exc)))
        return None
    omml, n_fixed = _repair_groupchr(omml)
    if n_fixed:
        _stats['repaired'] += n_fixed
    omml, n_rad = _ensure_rad_degree(omml)
    if n_rad:
        _stats['repaired'] += n_rad
    omml, n_acc = _normalize_accents(omml)
    if n_acc:
        _stats['repaired'] += n_acc
    out = _wrap(omml)
    if not out or len(out) <= len('<m:oMath xmlns:m="" xmlns:w=""></m:oMath>'):
        _stats['failed'] += 1
        _failures.append((formula, '转换结果为空'))
        return None
    if not _xml_ok(out):
        _stats['failed'] += 1
        _failures.append((formula, 'OMML 不是合法 XML（转换器输出异常）'))
        return None
    _stats['ok'] += 1
    return out


def latex_to_omathpara(latex: str, jc: str = 'left'):
    """LaTeX → 独立公式段落 OMML（<m:oMathPara>）；失败返回 None。

    jc 为段落级公式的对齐方式：'' 表示不写 m:jc（Word 默认居中），
    'left' 会写出 <m:jc m:val="left"/>——旧版 Word COM 产物里的独立公式是
    「首行缩进 + 左对齐」，这里保持一致以免版式回归。
    """
    one = latex_to_omml(latex)
    if one is None:
        return None
    pr = '' if not jc else '<m:oMathParaPr><m:jc m:val="%s"/></m:oMathParaPr>' % jc
    return '<m:oMathPara xmlns:m="%s" xmlns:w="%s">%s%s</m:oMathPara>' % (M_NS, W_NS, pr, one)


# ── 供文档正文使用的公式纯文本化兜底 ──
_TEXT_FALLBACK_RE = re.compile(r'\\(?:mathrm|text|mathbf|mathit)\{([^}]*)\}')


def latex_to_plain(latex: str) -> str:
    """转换失败时的兜底显示文本：尽量去掉 LaTeX 命令外壳，不残留反斜杠命令。"""
    s = _preprocess(latex)
    s, _ = _normalize_environments(s)
    s = _TEXT_FALLBACK_RE.sub(r'\1', s)
    for cmd, uni in ((r'\times', '×'), (r'\cdot', '·'), (r'\pm', '±'),
                     (r'\approx', '≈'), (r'\Delta', 'Δ'), (r'\delta', 'δ'),
                     (r'\pi', 'π'), (r'\lambda', 'λ'), (r'\omega', 'ω'),
                     (r'\Omega', 'Ω'), (r'\rho', 'ρ'), (r'\theta', 'θ'),
                     (r'\alpha', 'α'), (r'\beta', 'β'), (r'\gamma', 'γ'),
                     (r'\mu', 'μ'), (r'\sigma', 'σ'), (r'\Sigma', 'Σ'),
                     (r'\varphi', 'φ'), (r'\phi', 'φ'), (r'\eta', 'η'),
                     (r'\sqrt', '√'), (r'\bar', ''), (r'\overline', '')):
        s = s.replace(cmd, uni)
    s = s.replace('{', '').replace('}', '')
    s = re.sub(r'\\([A-Za-z]+)', r'\1', s)
    return s.strip()
