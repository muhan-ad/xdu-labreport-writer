"""电容与高电阻的测量实验 — 数据处理脚本。"""

import json
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
sys.path.insert(0, SCRIPT_DIR)
from common import *
from common.docx_report import DocxReportWriter
from common.data_io import load_data
from common.variants import (compose, render_custom_quiz, load_variants,
    get_polish_overrides, get_custom_quiz, render_variant, DATA_PATTERN,
    get_variant_choices, get_disabled_sections, normalize_polish_md, SECTIONS_MARKER)
from report_integrity import validate_text
from common.custom_plot import render_custom_plot

# ============================================================
# 实验参数（教材实验23）
# ============================================================

# 表 1 冲击法测电容的电压序列（教材表 3-23-1）
U_VALUES = [2.00, 4.00, 6.00, 8.00, 10.00, 12.00, 14.00, 16.00]

# 表 2 冲击法测高阻的数据组数（教材表 3-23-2）


# ============================================================
# Excel 模板生成
# ============================================================

# （方式三：_create_template 已移除，数据真相为 data.json）


# ============================================================
# 图表绘制
# ============================================================

def _plot_lnq_t(t_values: list[float], lnq_values: list[float],
                slope: float, intercept: float, output_path: str):
    """绘制 lnQ ~ t 关系图（数据点连线 + 直线拟合，复刻范例 Matlab 图）。"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    # 中文字体
    plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    x = np.array(t_values)
    y = np.array(lnq_values)

    fig, ax = plt.subplots(figsize=(8, 5.5))

    # 数据点连线（蓝色实线 + 圆点，对应范例 plot(x, y, '-o')）
    ax.plot(x, y, "-o", color="steelblue", markersize=5, linewidth=1.2,
            zorder=5, label="数据点连线")

    # 最小二乘拟合直线（红色虚线；图例不标数值，正文斜率用两点法）
    x_fit = np.linspace(x[0], x[-1], 100)
    y_fit = slope * x_fit + intercept
    ax.plot(x_fit, y_fit, "--", color="red", linewidth=1.5, label="拟合直线")

    # 坐标轴
    ax.set_xlabel("t(s)", fontsize=13)
    ax.set_ylabel("lnQ", fontsize=13)
    ax.set_title("数据点与直线拟合", fontsize=13)

    ax.grid(True, alpha=0.3, linestyle="--")
    ax.legend(fontsize=10, loc="upper right")

    fig.tight_layout()
    fig.savefig(output_path, dpi=150)
    plt.close(fig)


# ============================================================
# 数据处理（计算）
# ============================================================

def _compute(data: dict) -> dict:
    """由原始数据计算各物理量，返回数值键字典（供正文与变体 %%DATA 注入）。"""

    from common.data_validation import validate
    with open(os.path.join(SCRIPT_DIR, "schema.json"), encoding="utf-8") as f:
        check = validate(json.load(f), data)
    if not check["ok"]:
        errors = check["missing"] + check["invalid"]
        raise ValueError("实验数据无效：" + "；".join(e["label"] + "：" + e.get("reason", "未填写") for e in errors))
    c_n, r_0 = float(data["c_n"]), float(data["r_0"])
    q_n, q_x = list(data["q_n"]), list(data["q_x"])
    t_values, q_values = list(data["t_values"]), list(data["q_values"])
    if any(b <= a for a, b in zip(t_values, t_values[1:])):
        raise ValueError("放电时间必须严格递增，请检查重复或倒序的时刻。")
    c_x = [qx / qn * c_n for qx, qn in zip(q_x, q_n)]
    c_x_bar = mean(c_x)
    # 展示时才舍入；两点法、拟合和绘图均使用原始对数。
    lnq = [math.log(v) for v in q_values]
    k_slope = (lnq[-1] - lnq[0]) / (t_values[-1] - t_values[0])
    reg = linear_regression(t_values, lnq)
    if not math.isfinite(k_slope) or k_slope >= 0 or not math.isfinite(reg.slope) or reg.slope >= 0:
        raise ValueError("放电数据无法得到有效负斜率，请核对时间与电荷读数。")
    k_abs = abs(k_slope)
    r_mohm = 1.0 / (k_abs * c_n)
    r_fit_mohm = -1.0 / (reg.slope * c_n)
    delta_e = abs(r_mohm / r_0 - 1.0) * 100.0
    fit_delta_e = abs(r_fit_mohm / r_0 - 1.0) * 100.0
    result = {
        "c_n": c_n, "r_0": r_0, "q_n": q_n, "q_x": q_x,
        "t_values": t_values, "q_values": q_values, "c_x": c_x, "c_x_bar": c_x_bar,
        "lnq": lnq, "k_slope": k_slope, "k_abs": k_abs,
        "r_mohm": r_mohm, "delta_e": delta_e, "reg": reg,
        "fit_slope": reg.slope, "fit_intercept": reg.intercept,
        "r_fit_mohm": r_fit_mohm, "fit_delta_e": fit_delta_e,
        "r_squared": reg.r_squared, "t_first": t_values[0], "t_last": t_values[-1],
        "q_first": q_values[0], "q_last": q_values[-1],
        "lnq_first": lnq[0], "lnq_last": lnq[-1],
    }
    if any(not math.isfinite(v) for v in result.values() if isinstance(v, (int, float))):
        raise ValueError("计算结果超出有限数值范围，请检查输入量级。")
    return result


def _validate_text_inputs(r):
    """先验证模板，不能让旧润色或自建答案带入固定实验数值。"""
    def walk(value):
        if isinstance(value, str):
            validate_text(value, r)
        elif isinstance(value, dict):
            for v in value.values(): walk(v)
        elif isinstance(value, list):
            for v in value: walk(v)
    walk(load_variants(SCRIPT_DIR) or {})
    walk(get_polish_overrides() or {})
    quiz = get_custom_quiz()
    if quiz: walk(quiz.get("answers", {}))


def calculation_context(data):
    r = _compute(data)
    return {k: v for k, v in r.items() if k != "reg"}


# ============================================================
# docx 报告生成
# ============================================================

def _generate_docx(data: dict, output_path: str):
    """从 data.json 读取数据 → 计算 → 输出 docx 报告。"""

    # 计算与输入文本验证均须先于任何输出写入。
    r = _compute(data)
    _validate_text_inputs(r)
    c_n = r["c_n"]
    r_0 = r["r_0"]
    q_n = r["q_n"]
    q_x = r["q_x"]
    t_values = r["t_values"]
    q_values = r["q_values"]
    c_x = r["c_x"]
    c_x_bar = r["c_x_bar"]
    lnq = r["lnq"]
    k_slope = r["k_slope"]
    k_abs = r["k_abs"]
    r_mohm = r["r_mohm"]
    delta_e = r["delta_e"]
    reg = r["reg"]

    # 打印到控制台
    print(f"\n{'=' * 50}")
    print("Table 1: capacitance by ballistic galvanometer")
    print(f"  C_x per point (uF): {[f'{v:.4f}' for v in c_x]}")
    print(f"  C_x mean = {c_x_bar:.4f} uF")
    print("\nTable 2: high resistance by RC discharge")
    print(f"  two-point slope K = {k_slope:.7g} (per s)")
    print(f"  least-squares slope = {reg.slope:.4f}, R^2 = {reg.r_squared:.4f}")
    print(f"  R = {r_mohm:.2f} MOhm  (nominal R_0 = {r_0:g} MOhm)")
    print(f"  relative error = {delta_e:.2f} %")
    print(f"{'=' * 50}\n")

    # ---------- 3. 绘制图表 ----------
    plot_path = os.path.join(SCRIPT_DIR, "lnQ-t图.png")
    _plot_lnq_t(t_values, lnq, reg.slope, reg.intercept, plot_path)
    print(f"Chart saved: {plot_path}")

    # ---------- 4. 生成 docx ----------
    doc = DocxReportWriter(output_path)

    # ---- 变体组合（存在 variants.json 且应用传入选择时生效）----
    variants = compose(SCRIPT_DIR, r)
    # 章节润色缓存保存可重新绑定的模板，避免把此次结果冻结为下一次的输入。
    raw_variants = load_variants(SCRIPT_DIR) or {}
    template_sections = {}
    for section, texts in raw_variants.items():
        idx = (get_variant_choices() or {}).get(section, -1)
        if section not in get_disabled_sections() and isinstance(texts, list) and isinstance(idx, int) and 0 <= idx < len(texts):
            template_sections[section] = texts[idx]
    for section, text in (get_polish_overrides() or {}).items():
        if section not in get_disabled_sections() and isinstance(text, str) and text.strip():
            template_sections[section] = normalize_polish_md(text)
    if template_sections:
        print(SECTIONS_MARKER + json.dumps(template_sections, ensure_ascii=False), flush=True)

    # ---- 零、实验标题 ----
    doc.add_title("电容与高电阻的测量实验")
    doc.add_student_info()

    if "实验原理" in variants:
        doc.add_heading("实验原理", level=1)
        doc.add_paragraph_rich(variants["实验原理"])
    if "实验方法" in variants:
        doc.add_heading("实验方法", level=1)
        doc.add_paragraph_rich(variants["实验方法"])

    # ---- 一、原始数据记录 ----
    doc.add_heading("一、原始数据记录", level=1)
    doc.add_data_photo("（请在此处粘贴原始数据记录照片。）")

    # ---- 二、数据处理 ----
    doc.add_heading("二、数据处理", level=1)

    # -- 1. 冲击法测电容 --
    doc.add_heading("1. 数字式冲击法测量电容值", level=2)

    doc.add_paragraph("")
    doc.add_run("由给定标准电容 ")
    doc.add_inline_math(rf"C_{{N}} = {c_n:g}\ \mathrm{{μF}}")
    doc.add_run("，按下式逐点计算被测电容：")
    doc.add_math(r"C_{x} = \frac{Q_{x}}{Q_{N}} \cdot C_{N}")

    doc.add_table(
        headers=["$U$ / V"] + [f"{u:.2f}" for u in U_VALUES],
        rows=[
            ["$Q_N$ / μC"] + [f"{v:.4g}" for v in q_n],
            ["$Q_x$ / μC"] + [f"{v:.3g}" for v in q_x],
            ["$C_x$ / μF"] + [f"{v:.4f}" for v in c_x],
        ],
        col_widths=[2.0] + [1.4] * 8,
    )

    doc.add_paragraph("取平均值：")
    doc.add_math(
        rf"\overline{{C_{{x}}}} = \frac{{1}}{{8}} \sum_{{i=1}}^{{8}} C_{{xi}}"
        rf" = {c_x_bar:.4f}\ \mathrm{{μF}}"
    )

    # -- 2. 冲击法测高阻 --
    doc.add_heading("2. 数字式冲击电流计测高阻", level=2)

    doc.add_paragraph("电容放电规律取对数后为")
    doc.add_math(r"\ln Q = -\frac{t}{RC} + \ln Q_{0}")

    doc.add_paragraph("")
    doc.add_run("以 t 为横坐标、")
    doc.add_inline_math(r"\ln Q")
    doc.add_run(" 为纵坐标作图，直线斜率即为 ")
    doc.add_inline_math(r"-\frac{1}{RC}")
    doc.add_run("。各点 ")
    doc.add_inline_math(r"\ln Q")
    doc.add_run(" 计算如下：")

    for start in (0, 8):
        seg = slice(start, start + 8)
        doc.add_table(
            headers=["序号"] + [str(i + 1) for i in range(start, start + 8)],
            rows=[
                ["t/s"] + [f"{v:.2f}" for v in t_values[seg]],
                ["Q/μC"] + [f"{v:.2f}" for v in q_values[seg]],
                ["lnQ"] + [f"{v:.3f}" for v in lnq[seg]],
            ],
            col_widths=[1.8] + [1.4] * 8,
        )

    doc.add_paragraph("根据上表数据作 lnQ-t 图：")
    if not render_custom_plot(doc, 1, width_cm=14):
        doc.add_image(plot_path, width_cm=14, caption='图1 放电电荷对数与时间的关系曲线')

    doc.add_paragraph("取首末两点计算直线斜率：")
    doc.add_math(
        rf"K = \frac{{\ln Q_{{16}} - \ln Q_{{1}}}}{{t_{{16}} - t_{{1}}}}"
        rf" = \frac{{\ln({q_values[-1]:g}/{q_values[0]:g})}}{{{t_values[-1]:g} - {t_values[0]:g}}}"
        rf" \approx {k_slope:.7g}\ \mathrm{{s^{{-1}}}}"
    )

    doc.add_paragraph("由斜率求得高电阻：")
    doc.add_math(
        rf"R = \frac{{1}}{{|K|C}} = \frac{{1}}{{{k_abs:.7g} \cdot {c_n:g} \cdot 10^{{-6}}}}"
        rf" \approx {r_mohm:.2f}\ \mathrm{{MΩ}}"
    )

    doc.add_paragraph("相对误差：")
    doc.add_math(
        rf"\Delta E = \left| \frac{{R}}{{R_{{0}}}} - 1 \right| \times 100%"
        rf" = {delta_e:.2f}%"
    )

    doc.add_paragraph("以全部原始对数数据作最小二乘拟合，作为两点法的对照：")
    doc.add_math(rf"\ln(Q/\mathrm{{μC}})={reg.intercept:.7g}{reg.slope:+.7g}t")
    doc.add_paragraph(f"最小二乘法电阻为{r['r_fit_mohm']:.2f} MΩ，与电阻标称值{r_0:g} MΩ相比，相对误差为{r['fit_delta_e']:.2f}%，R²={reg.r_squared:.6f}。两点法作为主要测量结果。")

    # ---- 变体组合：误差分析 / 结论 ----
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=1)
        doc.add_paragraph_rich(variants["误差分析"])
    if "结论" in variants:
        doc.add_heading("结论", level=1)
        doc.add_paragraph_rich(variants["结论"])

    # ---- 三、思考题 ----
    doc.add_heading("三、思考题", level=1)

    # ── 思考题变体：题目写死；回答按问随机（dict）/ 整段润色覆盖（str）/ 硬编码兜底 ──
    import random
    if not render_custom_quiz(doc, r):
        _quiz = variants.get("思考题")
        if isinstance(_quiz, str) and _quiz.strip():
            doc.add_paragraph_rich(_quiz)
            _quiz = None
        elif not isinstance(_quiz, dict):
            _quiz = None

        doc.add_heading(
            "1. 在冲击法测高阻实验中，冲击电流计测量的电量单位为 μC，"
            "这个数量级是否会影响最终的测量结果？", level=2)
        _o = _quiz.get("1") if _quiz else None
        if _o:
            doc.add_paragraph_rich(render_variant(random.choice(_o), r))
        else:

            doc.add_paragraph("")
            doc.add_run("不会。由公式 ")
            doc.add_inline_math(r"|k| = \left| \frac{\ln Q_{0} - \ln Q_{t}}{t_{0} - t_{t}} \right|")
            doc.add_run(" 化简变形可得 ")
            doc.add_inline_math(r"|k| = \left| \frac{\ln \frac{Q_{0}}{Q_{t}}}{t_{0} - t_{t}} \right|")
            doc.add_run("，")
            doc.add_inline_math(r"Q_{0}")
            doc.add_run(" 和 ")
            doc.add_inline_math(r"Q_{t}")
            doc.add_run(" 中相同的电荷单位因子相消，因此电荷单位换算不改变斜率。计算电阻时仍须把标准电容正确换算为法拉。")

        doc.add_heading("2. 放电法测量高阻阻值，最长放电时间的选择依据是什么？", level=2)
        _o = _quiz.get("2") if _quiz else None
        if _o:
            doc.add_paragraph_rich(render_variant(random.choice(_o), r))
        else:

            doc.add_paragraph("最长放电时间应保证剩余电荷仍在仪器可可靠测量的范围内。设有效测量下限为 Q_min，由 Q(t)≥Q_min 得：")
            doc.add_math(r"t_{\max}\le RC_N\ln\left(\frac{Q_0}{Q_{\min}}\right)")
            doc.add_paragraph(f"时间上限取决于标准电容、待测电阻、初始电荷、仪器分辨力与噪声以及允许误差，不能以 lnQ=0 确定通用上限。本次最大记录时间为{t_values[-1]:g} s，对应电荷{q_values[-1]:g} μC；本次未记录仪器有效测量下限，因而尚不能确定数值形式的最长测量时间。")

    doc.save()
    doc.close()


# ============================================================
# 入口
# ============================================================

def main():
    DATA_FILE = os.path.join(SCRIPT_DIR, "data.json")
    DOCX_FILE = os.path.join(SCRIPT_DIR, "电容与高电阻的测量实验报告.docx")

    data = load_data(DATA_FILE)
    if "--context" in sys.argv:
        print(json.dumps(calculation_context(data), ensure_ascii=False, allow_nan=False))
        return
    if not data:
        print("未找到 data.json 或数据为空，请先在应用中填写数据。")
        raise ValueError("未填写实验数据")

    _generate_docx(data, DOCX_FILE)
    if os.path.exists(DOCX_FILE):
        print(f"报告已生成: {DOCX_FILE}")
    else:
        print("[错误] 生成中止，未输出报告，请按上方提示检查数据。")


if __name__ == "__main__":
    main()
