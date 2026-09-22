"""薄透镜焦距的测量（凹透镜） — 数据处理脚本。

本实验只测凹透镜焦距，含两项内容：
    1. 自准法测凹透镜焦距（8 组 X₆、X₇，f = -\\left|X_7 - X_6\\right|）
    2. 物像法测凹透镜焦距（3 组 X₇、X₆、X₈，u = X_7 - X_6、v = X_8 - X_6、f = uv/(u - v)）

数据处理（按本课程讲义）：
    - 自准法数据按等精度测量做标准化处理（3σ 剔坏值 + A/B 类合成不确定度）；
    - 物像法数据只计算焦距平均值。

凸透镜版本（自准法 / 物距像距法 / 共轭法）见同级目录 实验脚本/薄透镜焦距的测量（凸透镜）/。

章节编号遵循本仓库约定：主体章节带中文序号，措辞变体章节
（实验原理 / 实验方法 / 误差分析 / 结论）不编号——变体章节可由用户按实验关闭，
写死序号会在关闭时断号。原始数据记录处用 add_data_photo()：识图录入保存的原图
（环境变量 LAB_DATA_PHOTO）存在时自动插图，否则退回占位文字。
"""

import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.data_io import load_data
from common.variants import compose, render_custom_quiz
from common.custom_plot import render_custom_plot

# ── 物理常数与仪器参数（按教材与讲义） ──
DELTA_INSTRUMENT = 0.05          # cm, Δ_仪 = 0.5 × 0.1 cm（钢尺/光具座最小分度 0.1 cm）


# 逐项展开的上限：超过这个项数就改代入「求和值」。
# 根号/分式在 Word 里不能跨行拆分，8 项展开会让公式远超版心而顶出页面；
# 教材在求和处也是直接代入求和结果。
MAX_TERMS_INLINE = 5


def _fmt_seq(values) -> str:
    """把数值序列写成公式里可读的代入串（保留两位小数）。

    项数超过 MAX_TERMS_INLINE 时给出求和值，避免公式过长越界。
    """
    values = list(values)
    if len(values) > MAX_TERMS_INLINE:
        return f"{sum(values):.2f}"
    return " + ".join(f"{v:.2f}" for v in values)


def _fmt_sq_dev(values, bar) -> str:
    """把 (x_i - x̄)² 的数值序列写成代入串（保留五位小数）。

    项数超过 MAX_TERMS_INLINE 时给出求和值（等价于教材里 √(Σ(x−x̄)²/(n−1)) 的写法）。
    """
    terms = [((v - bar) ** 2) for v in values]
    if len(terms) > MAX_TERMS_INLINE:
        return f"{sum(terms):.5f}"
    return " + ".join(f"{t:.5f}" for t in terms)


def _equal_precision(values: list[float]) -> dict:
    """等精度直接测量序列的标准化处理：3σ 剔坏值 → A、B 类 → 合成不确定度。

    坏值检验用公共的 `outlier_test()`（教材口径：σ = s×t，剔除后**迭代复检**直到无坏值），
    此前这里是单遍剔除、且 t 因子硬编码为 1，与教材/知识库口径不一致。
    """
    vals = [float(v) for v in values]
    ot = outlier_test(vals)
    clean = ot["kept"]
    n = len(clean)
    bar = mean(clean) if clean else 0.0
    s = std_dev(clean) if n > 1 else 0.0
    sigma = ot["sigma"]
    u_a = type_a(clean)
    u_b = type_b(DELTA_INSTRUMENT)
    u = combine(u_a, u_b)
    return {"bar": bar, "s": s, "sigma": sigma, "bad": [i for i, _ in ot["bad"]],
            "n": n, "clean": clean, "ot": ot,
            "uA": u_a, "uB": u_b, "u": u, "e": (u / bar * 100) if bar else 0.0}


def _compute(data: dict) -> dict:
    """数据处理：两种测量的结果与不确定度，返回数值字典（正文与变体章节共用）。"""

    # ── 取出原始数据 ──
    x6 = [float(v) for v in data["x6"]]                # 自准法：凹透镜位置（距凸透镜）
    x7 = [float(v) for v in data["x7"]]                # 自准法：像屏位置（距凸透镜）
    u1 = float(data["u1"])                             # 物像法：凸透镜物距
    concave = data["concave"]                          # 物像法：3 行 × [X₇, X₆, X₈]
    r_x7 = [float(concave[i][0]) for i in range(3)]
    r_x6 = [float(concave[i][1]) for i in range(3)]
    r_x8 = [float(concave[i][2]) for i in range(3)]

    # ── 1. 自准法测凹透镜焦距：f = -\left|X₇ - X₆\right| ──
    ca_gap = [abs(x7[i] - x6[i]) for i in range(len(x6))]   # = |X₇ - X₆| = -f
    ca = _equal_precision(ca_gap)

    # ── 2. 物像法测凹透镜焦距（只取平均） ──
    u_vals = [r_x7[i] - r_x6[i] for i in range(3)]
    v_vals = [r_x8[i] - r_x6[i] for i in range(3)]
    f_im_vals = [u_vals[i] * v_vals[i] / (u_vals[i] - v_vals[i]) for i in range(3)]
    f_im_bar = mean(f_im_vals)
    s_im = std_dev(f_im_vals)

    return {
        # 原始数据
        "x6": x6, "x7": x7, "u1": u1,
        "r_x7": r_x7, "r_x6": r_x6, "r_x8": r_x8,
        # 1 自准法
        "ca_gap": ca_gap, "f_ca_abs_bar": ca["bar"], "s_ca": ca["s"], "sigma_ca": ca["sigma"],
        "ca_bad": ca["bad"], "n_ca_clean": ca["n"], "ca_clean": ca["clean"],
        "ca_ot": ca["ot"],
        "uA_ca": ca["uA"], "uB_ca": ca["uB"], "u_ca": ca["u"], "e_ca": ca["e"],
        # 2 物像法
        "u_vals": u_vals, "v_vals": v_vals, "f_im_vals": f_im_vals,
        "f_im_bar": f_im_bar, "s_im": s_im,
        # 两法比较
        "diff_ca_im": abs(ca["bar"] - abs(f_im_bar)),
    }


def _generate_docx(data: dict, output_path: str):
    """从 data.json 读取数据，计算并生成 Word 实验报告。"""

    # ═══════════════════════════════════════════
    # 1. 读取数据（含必填空值校验）
    # ═══════════════════════════════════════════
    def _flat(v):
        if isinstance(v, list) and v and isinstance(v[0], list):
            return [x for row in v for x in row]
        return v if isinstance(v, list) else [v]

    missing = []
    for k in ("x6", "x7", "u1", "concave"):
        v = data.get(k)
        if v is None:
            missing.append(k)
        elif isinstance(v, list) and any(x is None for x in _flat(v)):
            missing.append(k)
    if missing:
        print("以下必填数据未填写，请补齐后重新运行：")
        for m in missing:
            print(f"  - {m}")
        return

    # ═══════════════════════════════════════════
    # 2. 计算（抽出为 _compute，变体章节共用同一份结果）
    # ═══════════════════════════════════════════
    r = _compute(data)
    (x6, x7, u1, r_x7, r_x6, r_x8,
     ca_gap, f_ca_abs_bar, s_ca, sigma_ca, ca_bad, n_ca_clean, ca_clean,
     ca_ot,
     uA_ca, uB_ca, u_ca, e_ca,
     u_vals, v_vals, f_im_vals, f_im_bar, s_im,
     diff_ca_im) = (
        r["x6"], r["x7"], r["u1"], r["r_x7"], r["r_x6"], r["r_x8"],
        r["ca_gap"], r["f_ca_abs_bar"], r["s_ca"], r["sigma_ca"], r["ca_bad"],
        r["n_ca_clean"], r["ca_clean"], r["ca_ot"],
        r["uA_ca"], r["uB_ca"], r["u_ca"], r["e_ca"],
        r["u_vals"], r["v_vals"], r["f_im_vals"], r["f_im_bar"], r["s_im"],
        r["diff_ca_im"],
    )

    variants = compose(SCRIPT_DIR, r)

    # ═══════════════════════════════════════════
    # 3. 生成 Word 报告
    # ═══════════════════════════════════════════
    doc = DocxReportWriter(output_path)

    # ── 标题 ──
    doc.add_title("薄透镜焦距的测量（凹透镜）")
    doc.add_student_info()

    # ── 变体章节：实验原理 / 实验方法 ──
    if "实验原理" in variants:
        doc.add_heading("实验原理", level=1)
        doc.add_paragraph_rich(variants["实验原理"])
    if "实验方法" in variants:
        doc.add_heading("实验方法", level=1)
        doc.add_paragraph_rich(variants["实验方法"])

    # ═══════════════════════════════════════════
    # 一、原始记录数据
    # ═══════════════════════════════════════════
    doc.add_heading("一、原始记录数据", level=1)
    doc.add_data_photo("（请在此处粘贴原始数据记录照片。）")

    # 1. 自准法测凹透镜焦距
    doc.add_heading("1. 自准法测量凹透镜焦距", level=2)
    doc.add_paragraph("")
    doc.add_run("凸透镜距物屏 ")
    doc.add_inline_math(f"u_1 = {u1:.2f} \\text{{ cm}}")
    doc.add_run(" 左右（超过两倍焦距），测得：")
    ca_headers = ["次数$n$"] + [str(i) for i in range(1, 9)]
    ca_rows = [
        ["凹透镜 $X_6$ / cm"] + [f"{v:.2f}" for v in x6],
        ["像屏 $X_7$ / cm"] + [f"{v:.2f}" for v in x7],
        [r"$f = -\left|X_7 - X_6\right|$ / cm"] + [f"-{v:.2f}" for v in ca_gap],
    ]
    doc.add_table(ca_headers, ca_rows, col_widths=[4.0] + [1.2] * 8)

    # 2. 物像法测凹透镜焦距
    doc.add_heading("2. 物像法测量凹透镜焦距", level=2)
    doc.add_paragraph("")
    doc.add_run("凸透镜物距 ")
    doc.add_inline_math(f"u_1 = {u1:.2f} \\text{{ cm}}")
    im_headers = ["次数$n$", "像屏1 $X_7$/cm", "凹透镜 $X_6$/cm", "像屏2 $X_8$/cm",
                  "物距 $u$/cm", "像距 $v$/cm", "$f$ / cm"]
    im_rows = []
    for i in range(3):
        im_rows.append([
            str(i + 1),
            f"{r_x7[i]:.2f}", f"{r_x6[i]:.2f}", f"{r_x8[i]:.2f}",
            f"{u_vals[i]:.2f}", f"{v_vals[i]:.2f}", f"{f_im_vals[i]:.2f}",
        ])
    doc.add_table(im_headers, im_rows, col_widths=[1.2, 1.9, 1.9, 1.9, 1.7, 1.7, 1.8])

    # ═══════════════════════════════════════════
    # 二、数据处理和误差分析
    # ═══════════════════════════════════════════
    doc.add_heading("二、数据处理和误差分析", level=1)

    # ── 2.1 自准法测凹透镜焦距（标准化处理） ──
    doc.add_heading("1. 自准法测量凹透镜焦距", level=2)

    doc.add_paragraph("由表得各次焦距 ")
    doc.add_inline_math(r"f_i = -\left|X_{7i} - X_{6i}\right|")
    doc.add_run("，其绝对值序列按等精度测量处理。")

    doc.add_paragraph("(1) 判断是否有坏值")
    doc.add_paragraph("计算各次焦距绝对值平均值：")
    doc.add_math(
        rf"\overline{{\left|f\right|}} = \frac{{1}}{{{n_ca_clean}}}"
        rf"\sum_{{i=1}}^{{{n_ca_clean}}} \left|f_i\right|"
        rf" = \frac{{{_fmt_seq(ca_clean)}}}{{{n_ca_clean}}}"
        rf" = {f_ca_abs_bar:.5f} \approx {f_ca_abs_bar:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("计算标准差：")
    doc.add_math(
        rf"s = \sqrt{{\frac{{\sum_{{i=1}}^{{{n_ca_clean}}}"
        rf"(\left|f_i\right| - \overline{{\left|f\right|}})^2}}{{{n_ca_clean} - 1}}}}"
        rf" = \sqrt{{\frac{{{_fmt_sq_dev(ca_clean, f_ca_abs_bar)}}}"
        rf"{{{n_ca_clean} - 1}}}} = {s_ca:.5f} \approx {s_ca:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("")
    doc.add_run("n = ")
    doc.add_inline_math(f"{n_ca_clean}")
    doc.add_run(" > 6，t 分布因子取 1，")
    doc.add_inline_math(rf"\sigma = s \times t = {s_ca:.2f} \times 1 = {sigma_ca:.2f} \mathrm{{cm}}")
    if ca_ot is not None:
        doc.add_paragraph(outlier_note(ca_ot, unit=" cm", digits=2))
    elif ca_bad:
        doc.add_paragraph(f"经检查，第{[i + 1 for i in ca_bad]}次测量超出 3σ 范围，已剔除。")
        doc.add_paragraph(f"剔除后重新计算：n = {n_ca_clean}，σ = {sigma_ca:.2f} cm。")
    else:
        doc.add_paragraph("经 3σ 检验，各偏差均小于 3σ，无坏值。")

    doc.add_paragraph("(2) 不确定度的计算")
    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        rf"\Delta \left|f\right|_A = \frac{{\sigma}}{{\sqrt{{n}}}}"
        rf" = \frac{{{sigma_ca:.2f}}}{{\sqrt{{{n_ca_clean}}}}}"
        rf" = {uA_ca:.5f} \approx {uA_ca:.3f} \mathrm{{cm}}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(r"\Delta_{\text{仪}} = 0.5 \times 0.1 = 0.05 \mathrm{cm}")
    doc.add_math(
        rf"\Delta \left|f\right|_B = \frac{{\Delta_{{\text{{仪}}}}}}{{\sqrt{{3}}}}"
        rf" = \frac{{0.05}}{{\sqrt{{3}}}} = {uB_ca:.5f} \approx {uB_ca:.3f} \mathrm{{cm}}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        rf"\Delta \left|f\right| = \sqrt{{(\Delta \left|f\right|_A)^2"
        rf" + (\Delta \left|f\right|_B)^2}}"
        rf" = \sqrt{{{uA_ca:.3f}^2 + {uB_ca:.3f}^2}}"
        rf" = {u_ca:.5f} \approx {u_ca:.3f} \mathrm{{cm}}"
    )

    doc.add_paragraph("(3) 结果表示")
    doc.add_paragraph("凹透镜焦距为负值，故")
    doc.add_math(
        rf"f = -\left(\overline{{\left|f\right|}} \pm \Delta \left|f\right|\right)"
        rf" = -({format_number(f_ca_abs_bar, u_ca)}"
        rf" \pm {format_number(u_ca, u_ca)})\ \mathrm{{cm}}"
    )
    doc.add_math(
        rf"E = \frac{{\Delta \left|f\right|}}{{\overline{{\left|f\right|}}}} \times 100\%"
        rf" = \frac{{{format_number(u_ca, u_ca)}}}{{{format_number(f_ca_abs_bar, u_ca)}}}"
        rf" \times 100\% = {format_percent(e_ca)}\%"
    )

    # ── 2.2 物像法测凹透镜焦距（只取平均） ──
    doc.add_heading("2. 物像法测量凹透镜焦距", level=2)

    doc.add_paragraph("由 ")
    doc.add_inline_math(r"u = X_7 - X_6")
    doc.add_run("、")
    doc.add_inline_math(r"v = X_8 - X_6")
    doc.add_run(" 及 ")
    doc.add_inline_math(r"f = \frac{uv}{u - v}")
    doc.add_run(" 逐次计算焦距，按讲义要求只计算平均值：")

    for i in range(3):
        doc.add_math(
            rf"u_{i + 1} = X_7 - X_6 = {r_x7[i]:.2f} - {r_x6[i]:.2f}"
            rf" = {u_vals[i]:.2f} \mathrm{{cm}},\quad "
            rf"v_{i + 1} = X_8 - X_6 = {r_x8[i]:.2f} - {r_x6[i]:.2f}"
            rf" = {v_vals[i]:.2f} \mathrm{{cm}}"
        )
        doc.add_math(
            rf"f_{i + 1} = \frac{{u_{i + 1} v_{i + 1}}}{{u_{i + 1} - v_{i + 1}}}"
            rf" = \frac{{{u_vals[i]:.2f} \times {v_vals[i]:.2f}}}"
            rf"{{{u_vals[i]:.2f} - {v_vals[i]:.2f}}}"
            rf" = {f_im_vals[i]:.2f} \mathrm{{cm}}"
        )

    doc.add_paragraph("焦距平均值：")
    doc.add_math(
        rf"\bar{{f}} = \frac{{1}}{{3}}\sum_{{i=1}}^{{3}} f_i"
        rf" = \frac{{{_fmt_seq(f_im_vals)}}}{{3}}"
        rf" = {f_im_bar:.5f} \approx {f_im_bar:.2f} \mathrm{{cm}}"
    )
    doc.add_math(
        rf"s = \sqrt{{\frac{{\sum_{{i=1}}^{{3}}(f_i - \bar{{f}})^2}}{{3 - 1}}}}"
        rf" = \sqrt{{\frac{{{_fmt_sq_dev(f_im_vals, f_im_bar)}}}{{2}}}}"
        rf" = {s_im:.5f} \approx {s_im:.2f} \mathrm{{cm}}"
    )

    doc.add_paragraph("物像法数据按讲义要求不计算不确定度，仅以平均值作为结果：")
    doc.add_math(rf"f = {f_im_bar:.2f} \mathrm{{cm}}")
    # 自定义画图：本实验无内置图，AI 生成的图按顺序追加在「数据处理」末尾
    render_custom_plot(doc, 1, width_cm=14)
    render_custom_plot(doc, 2, width_cm=14)
    render_custom_plot(doc, 3, width_cm=14)


    # ── 变体章节：误差分析 ──
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=1)
        doc.add_paragraph_rich(variants["误差分析"])

    # ═══════════════════════════════════════════
    # 三、思考题和结果分析
    # ═══════════════════════════════════════════
    doc.add_heading("三、思考题和结果分析", level=1)
    if not render_custom_quiz(doc, r):

        # Q1
        doc.add_heading("1. 为什么凹透镜的焦距不能直接测量？本实验用哪两种方法解决？", level=2)
        doc.add_paragraph("凹透镜是发散透镜，对实物只能成虚像，且虚像位置在物与凹透镜之间，"
                          "无法用像屏接收，因而不能像凸透镜那样直接由物距、像距求出焦距。")
        doc.add_paragraph("本实验用两种方法解决：")
        doc.add_paragraph("(1) 自准法：凸透镜先把物成像，凹透镜与平面镜配合使光束返回物屏，"
                          "得到与物等大的倒立实像，此时凹透镜的焦距等于两次成像位置之差，")
        doc.add_math(r"f = -\left|O_1F - O_1O_2\right| = -\left|X_7 - X_6\right|")
        doc.add_paragraph_rich("(2) 物像法：先用凸透镜成一个倒立实像 $A'B'$，把它作为凹透镜的虚物，"
                               "凹透镜对此虚物成一个可被像屏接收的实像 $A''B''$，由")
        doc.add_math(r"-\frac{1}{u} + \frac{1}{v} = \frac{1}{f} \;\Rightarrow\; f = \frac{uv}{u - v}")
        doc.add_paragraph("")
        doc.add_run("其中 ")
        doc.add_inline_math(r"u = X_7 - X_6")
        doc.add_run("、")
        doc.add_inline_math(r"v = X_8 - X_6")
        doc.add_run("，由于 ")
        doc.add_inline_math(r"u < v")
        doc.add_run("，所得 ")
        doc.add_inline_math(r"f")
        doc.add_run(" 为负值，与凹透镜的发散性质一致。")

        # Q2
        doc.add_heading("2. 自准法测凹透镜焦距时，为什么要撤去凹透镜和反射镜后再测 X₇？", level=2)
        doc.add_paragraph("凹透镜的焦距无法从“有凹透镜”的光路中单独提取：加上凹透镜与反射镜后，"
                          "光路中同时含有凸透镜、凹透镜和反射镜三个元件，物屏上的等大倒立实像是三者共同作用的结果。")
        doc.add_paragraph_rich("撤去凹透镜和反射镜后，保持物和凸透镜不动，物经凸透镜单独成像于某点，"
                               "该点位置 $X_7 = O_1F$ 正是凹透镜的虚物（即凸透镜所成实像）所在位置，"
                               "而 $X_6 = O_1O_2$ 是凹透镜所在位置，两者之差即凹透镜的焦距。")
        doc.add_paragraph_rich("若不撤去凹透镜，就无法确定凸透镜单独成像的位置，也就得不到 $O_1F$，"
                               "这正是“凸透镜与物不得移动”这一操作要求的原因。")

        # Q3
        doc.add_heading("3. 实验中如何确定清晰成像的位置？放大像与缩小像的位置如何判断？", level=2)
        doc.add_paragraph("确定成像位置时，以像的某一条边的清晰度作为判断依据：前后微动像屏（或透镜），"
                          "观察选定边缘的锐利程度，取其最清晰处为该次成像位置。"
                          "这样比笼统地看“像是否清晰”更容易复现，可减小判读的偶然误差。")
        doc.add_paragraph("放大像与缩小像的位置判断：")
        doc.add_paragraph("(1) 缩小像：物距大于二倍焦距（本实验凸透镜距物屏 40.00 cm 左右），"
                          "像成在透镜另一侧一倍焦距与二倍焦距之间，像的尺寸小于物，边缘较锐利，易于判读；")
        doc.add_paragraph("(2) 放大像：插入凹透镜后移动凹透镜与像屏，使光束进一步会聚，"
                          "像的尺寸变大、亮度降低、边缘变软，需要更仔细地前后逼近才能确定位置。")
        doc.add_paragraph("整个测量过程中物屏与凸透镜的位置一旦固定就不再移动，"
                          "读数一律使用置于仪器顶端的钢尺，并估读到最小分度的下一位。")

        # Q4
        doc.add_heading("4. 自准法与物像法测凹透镜焦距的结果为何有差异？哪种方法重复性更好？", level=2)
        doc.add_paragraph("本次测量结果：")
        doc.add_math(
            rf"f_{{\text{{自准}}}} = -({format_number(f_ca_abs_bar, u_ca)}"
            rf" \pm {format_number(u_ca, u_ca)})\ \mathrm{{cm}},\qquad "
            rf"f_{{\text{{物像}}}} = {f_im_bar:.2f}\ \mathrm{{cm}}"
        )
        doc.add_math(
            rf"\Delta = \left|f_{{\text{{自准}}}} - f_{{\text{{物像}}}}\right|"
            rf" = \left|{abs(f_ca_abs_bar):.2f} - {abs(f_im_bar):.2f}\right|"
            rf" = {diff_ca_im:.2f}\ \mathrm{{cm}}"
        )
        doc.add_paragraph("差异来源：")
        doc.add_paragraph_rich("(1) 自准法只用到两次成像位置之差 $X_7 - X_6$，"
                               "凹透镜与反射镜同步移动的联动误差是其主要来源；")
        doc.add_paragraph_rich("(2) 物像法的 $u = X_7 - X_6$、$v = X_8 - X_6$ 都是两次读数之差，"
                               "同一次位置读数的偏差会同时进入 $u$ 与 $v$，"
                               "且 $f = uv/(u - v)$ 的分母是两个接近的小量之差，误差被进一步放大，"
                               "因此物像法对位置判读的精度要求更高。")
        doc.add_paragraph("结论：自准法步骤少、参与运算的读数少，重复性更好；"
                          "物像法虽然计算直接，但误差传递路径更长。"
                          f"两者结果相差 {diff_ca_im:.2f} cm，处于本实验的不确定度水平之内，说明测量自洽。")

    # ── 变体章节：结论（置于思考题和结果分析后） ──
    if "结论" in variants:
        doc.add_heading("结论", level=1)
        doc.add_paragraph_rich(variants["结论"])

    # ── 保存 ──
    doc.save()
    doc.close()


def main():
    DATA_FILE = os.path.join(SCRIPT_DIR, "data.json")
    DOCX_FILE = os.path.join(SCRIPT_DIR, "实验报告.docx")
    data = load_data(DATA_FILE)
    if not data:
        print("未找到 data.json 或数据为空，请先在应用中填写数据。")
        return
    _generate_docx(data, DOCX_FILE)
    if os.path.exists(DOCX_FILE):
        print(f"报告已生成: {DOCX_FILE}")
    else:
        print("[错误] 生成中止，未输出报告，请按上方提示检查数据。")


if __name__ == "__main__":
    main()
