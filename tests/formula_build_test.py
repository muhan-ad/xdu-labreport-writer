# -*- coding: utf-8 -*-
"""公式构建回归测试：把全部实验 variants.json 里的 $...$ 公式经
_preprocess_latex + OMaths.BuildUp 构建一遍，断言无线性文本残留
（BuildUp 失败的特征是公式退化为含反斜杠的线性文本）。

需要本机安装 Microsoft Word（win32com）；无 Word 环境自动跳过。

用法：python tests/formula_build_test.py
"""
import glob, importlib.util, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_HOME = os.path.join(ROOT, "物理实验", "实验脚本")

try:
    import win32com.client
except ImportError:
    print("SKIP: win32com 不可用（无 Word 环境），公式构建回归未执行")
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    "docx_report", os.path.join(DATA_HOME, "common", "docx_report.py"))
docx_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(docx_report)
DocxReportWriter = docx_report.DocxReportWriter
preprocess = DocxReportWriter._preprocess_latex
assert_buildup = DocxReportWriter._assert_buildup_ok

# %%DATA:key:%.2f%% → 示例数（防 % 干扰判定，并贴近真实生成时的形态）
_DATA_FILL = re.compile(r"%%DATA:[^:]+:[^%]*%%")
def _fill_placeholder(s):
    return _DATA_FILL.sub("1.23", s)

FORMULA_RE = re.compile(r"\$([^$]+)\$")

def collect_variants_formulas(exp_dir):
    """收集（章节名, 变体序号, 公式）列表。"""
    out = []
    path = os.path.join(exp_dir, "variants.json")
    try:
        with open(path, encoding="utf-8") as f:
            variants = json.load(f)
    except Exception:
        return out
    if not isinstance(variants, dict):
        return out
    for sect, items in variants.items():
        if not isinstance(items, list):
            continue
        for i, text in enumerate(items):
            if not isinstance(text, str):
                continue
            for j, m in enumerate(FORMULA_RE.finditer(text)):
                out.append((sect, i, j, m.group(1)))
    return out

def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    doc = word.Documents.Add()

    exps = sorted(glob.glob(os.path.join(DATA_HOME, "*", "variants.json")))
    total, failures = 0, []
    print("== 公式构建回归（%d 个实验）==" % len(exps))
    try:
        for vp in exps:
            exp_name = os.path.basename(os.path.dirname(vp))
            forms = collect_variants_formulas(os.path.dirname(vp))
            bad = []
            for sect, vi, fi, raw in forms:
                formula = preprocess(_fill_placeholder(raw.strip()))
                if not formula:
                    continue
                total += 1
                doc.Content.Select()
                word.Selection.Collapse(0)  # wdCollapseStart
                doc.OMaths.Add(word.Selection.Range)
                om = doc.OMaths(doc.OMaths.Count)
                om.Range.Text = formula
                try:
                    om.BuildUp()
                    assert_buildup(om, formula)
                except Exception as e:
                    bad.append("%s[%d]#%d %r -> %s" % (sect, vi, fi, raw.strip(), e))
                    failures.append((exp_name, sect, vi, fi, str(e)))
            print("%-20s 公式 %3d  失败 %d" % (exp_name, len(forms), len(bad)))
    finally:
        doc.Close(False)
        word.Quit()

    print("-" * 46)
    print("合计公式 %d，失败 %d" % (total, len(failures)))
    if failures:
        for f in failures[:10]:
            print("FAIL:", f)
        sys.exit(1)
    print("PASS")

if __name__ == "__main__":
    main()