# -*- coding: utf-8 -*-
"""公式与文档生成回归测试（不需要 Microsoft Word）。

阶段 1 · 公式转换覆盖：把全部实验的 $...$ 公式（variants.json 与 generate.py 中硬编码的）
   经 LaTeX → MathML → OMML 转换，断言：
     ① 零失败；
     ② 每条 OMML 都是合法 XML（非法 XML 会让 Word 判定文档损坏而拒绝打开）；
     ③ 公式里的数字一个不少（防"转换成功但内容被吃掉"的静默错误）。

阶段 2 · 文档结构：用 DocxReportWriter 生成一份含行内公式、显示公式、公式表格的报告，
   直接解压 docx 校验 OMML 数量与正文无 LaTeX 残留（python-docx 即可，无需 Word）。

用法：python tests/omml_test.py
"""
import glob
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_HOME = os.path.join(ROOT, "物理实验", "实验脚本")

sys.path.insert(0, DATA_HOME)
from common.docx_omml import latex_to_omml, stats as omml_stats, failures as omml_failures  # noqa: E402
from common.docx_report import DocxReportWriter                                            # noqa: E402

# %%DATA:key:<fmt>%% → 按 printf 格式填入示例数，与 common.variants.render_variant 的行为一致。
# 注意格式段本身可能含 %（%.3f），必须非贪婪匹配到 %% 结束，不能用 [^%]*。
# 含未替换占位符的公式会被转换器判为失败——% 在 LaTeX 里是注释符，会静默吃掉后续内容。
_DATA_FILL = re.compile(r"%%DATA:([^:]+):(.+?)%%")
FORMULA_RE = re.compile(r"\$([^$]+)\$")
M_T_RE = re.compile(r"<m:t[^>]*>(.*?)</m:t>", re.S)


def _fill_placeholder(s):
    def repl(m):
        try:
            return m.group(2) % 1.23456
        except Exception:
            return "1.23"
    return _DATA_FILL.sub(repl, s)


def collect_formulas(exp_dir):
    """收集该实验的公式来源：变体章节 + generate.py 里的公式字面量。"""
    out = []
    vp = os.path.join(exp_dir, "variants.json")
    if os.path.exists(vp):
        try:
            with open(vp, encoding="utf-8") as f:
                variants = json.load(f)
        except Exception:
            variants = None
        if isinstance(variants, dict):
            for sect, items in variants.items():
                if not isinstance(items, list):
                    continue
                for i, text in enumerate(items):
                    if not isinstance(text, str):
                        continue
                    for m in FORMULA_RE.finditer(text):
                        out.append(("%s[%d]" % (sect, i), m.group(1)))
    gp = os.path.join(exp_dir, "generate.py")
    if os.path.exists(gp):
        with open(gp, encoding="utf-8") as f:
            src = f.read()
        for m in FORMULA_RE.finditer(src):
            out.append(("generate.py", m.group(1)))
    return out


def phase1():
    exps = sorted(os.path.dirname(p) for p in glob.glob(os.path.join(DATA_HOME, "*", "variants.json")))
    print("== 阶段 1：公式转换覆盖（%d 个实验）==" % len(exps))
    # 内置依赖自检：应用打包后运行时里不一定装了这两个包，必须走内置副本（common/_vendor）。
    # 内置副本被删/未同步会让用户端生成报告直接失败（曾因资源同步白名单丢失符号表而实际发生）。
    from common import docx_omml
    vendor_dir = docx_omml._VENDOR_DIR
    used_vendor = "_vendor" in os.path.normcase(os.path.abspath(docx_omml._mathml2omml.__file__))
    vendor_files = []
    if os.path.isdir(vendor_dir):
        for root, _dirs, files in os.walk(vendor_dir):
            vendor_files.extend(files)
    print("内置依赖目录：%s（%d 个文件，当前使用的是%s）"
          % (vendor_dir, len(vendor_files), "内置副本" if used_vendor else "运行时已安装版本"))
    vendor_problems = []
    if not used_vendor:
        vendor_problems.append("公式转换未使用内置副本（common/_vendor 缺失或为空）")
    for required in ("latex2mathml", "mathml2omml"):
        if not os.path.isdir(os.path.join(vendor_dir, required)):
            vendor_problems.append("内置副本缺少 %s/" % required)
    if not os.path.exists(os.path.join(vendor_dir, "latex2mathml", "unimathsymbols.txt")):
        vendor_problems.append("内置副本缺少 latex2mathml/unimathsymbols.txt（符号表）")
    for p in vendor_problems:
        print("FAIL:", p)
    total, failed, bad_xml, lost_digits = 0, [], [], []
    for exp_dir in exps:
        exp_name = os.path.basename(exp_dir)
        forms = collect_formulas(exp_dir)
        exp_bad = 0
        for where, raw in forms:
            formula = _fill_placeholder(raw.strip())
            if not formula:
                continue
            total += 1
            omml = latex_to_omml(formula)
            if omml is None:
                exp_bad += 1
                failed.append((exp_name, where, formula))
                continue
            from lxml import etree
            try:
                etree.fromstring(omml.encode("utf-8"))
            except Exception as exc:
                exp_bad += 1
                bad_xml.append((exp_name, where, formula, str(exc)[:80]))
                continue
            text_out = re.sub(r"<[^>]+>", "", "".join(M_T_RE.findall(omml)))
            if len(re.findall(r"\d", text_out)) < len(re.findall(r"\d", formula)):
                exp_bad += 1
                lost_digits.append((exp_name, where, formula, text_out[:50]))
        print("%-22s 公式 %3d  失败 %d" % (exp_name, len(forms), exp_bad))
    st = omml_stats()
    print("-" * 52)
    print("合计公式 %d，转换失败 %d，非法 XML %d，数字丢失 %d（其中修复 %d 处、规范化 %d 处）"
          % (total, len(failed), len(bad_xml), len(lost_digits), st["repaired"], st["normalized"]))
    for item in (failed + bad_xml + lost_digits)[:10]:
        print("FAIL:", item)
    return not (failed or bad_xml or lost_digits or vendor_problems)


def phase2():
    print()
    print("== 阶段 2：文档结构（不依赖 Word）==")
    tmp = tempfile.mkdtemp(prefix="omml_docx_")
    path = os.path.join(tmp, "公式结构测试.docx")
    doc = DocxReportWriter(path)
    doc.add_title("公式结构测试")
    doc.add_student_info()
    doc.add_heading("实验原理", level=1)
    doc.add_paragraph_rich(r"单摆周期 $T = 2\pi\sqrt{l/g}$ 与摆长有关（嵌套根号 $u = \sqrt{\frac{a}{\sqrt{b}}}$ 同样要过），"
                           "独立公式如下："
                           "\n$$g = \\frac{4\\pi^2 L}{T^2}$$")
    doc.add_paragraph_rich(r"重音与划线：$\bar{f}$、$\overline{d}$、$\underline{u}$、$\hat{x}$、$\vec{v}$、$\tilde{y}$、$\dot{z}$，"
                           r"平均值 $\bar{f} = \frac{1}{8}\sum_{i=1}^{8} f_i$。")
    doc.add_table(["量", "表达式", "结果"],
                  [["重力加速度", r"$g = \frac{4\pi^2 L}{T^2}$", "9.79"],
                   ["相对误差", r"$E = \frac{\Delta g}{g} \times 100\%$", r"$0.41\%$"]],
                  col_widths=[3.0, 6.0, 3.0])
    doc.save()
    doc.close()

    import zipfile
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    n_math = xml.count("<m:oMath")
    n_para_math = xml.count("<m:oMathPara")
    body_text = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", xml, re.S))
    residue = re.findall(r"\\[a-zA-Z]{2,}", body_text)
    problems = []
    if n_math < 7:
        problems.append("公式数量不足：%d（期望 ≥7）" % n_math)
    if n_para_math < 1:
        problems.append("缺少独立公式段落 oMathPara")
    # 根号必须带度数占位 <m:deg/>：缺失会让应用内预览（docx-preview）整篇渲染失败
    n_rad, n_deg = xml.count("<m:rad>"), xml.count("<m:deg/>")
    if n_rad == 0:
        problems.append("测试文档未包含根号，无法覆盖 m:deg 回归")
    elif n_deg < n_rad:
        problems.append("根号缺少 <m:deg/> 占位：rad=%d deg=%d（会破坏应用内预览）" % (n_rad, n_deg))
    # 重音/划线必须是 Word 原生的 m:acc / m:bar：
    # limUpp/limLow 会把重音按整字号"上限"排版（\hat 变成压在字母上的大 ^），groupChr 会拉伸字符
    n_acc, n_bar = xml.count("<m:acc>"), xml.count("<m:bar>")
    n_lim = xml.count("<m:limUpp>") + xml.count("<m:limLow>") + xml.count("<m:groupChr>")
    if n_acc == 0 or n_bar == 0:
        problems.append("重音/划线未生成 m:acc / m:bar：acc=%d bar=%d" % (n_acc, n_bar))
    if n_lim:
        problems.append("仍有 %d 处 limUpp/limLow/groupChr（重音排版会不正确）" % n_lim)
    if residue:
        problems.append("正文残留 LaTeX 命令：%s" % residue[:5])
    print("OMML 公式数 %d（独立公式段落 %d），根号 %d（含度数占位 %d），重音 %d，划线 %d，"
          "未规范化的限位/组字符 %d，正文 LaTeX 残留 %d 处"
          % (n_math, n_para_math, n_rad, n_deg, n_acc, n_bar, n_lim, len(residue)))
    print("产物：%s" % path)
    shutil.rmtree(tmp, ignore_errors=True)
    for p in problems:
        print("FAIL:", p)
    return not problems


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    ok = phase1() and phase2()
    print()
    print("PASS" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
