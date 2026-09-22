# -*- coding: utf-8 -*-
"""实验1 长度与体积的测量 — 数据处理脚本。

教材来源：《大学物理实验》吴兴林等（ISBN 978-7-5606-6654-9）实验1。
仪器：米尺、游标卡尺（50 分度，分度值 0.02 mm）、螺旋测微计（一级，量程 25 mm，
  分度值 0.01 mm，0~100 mm 示值误差 ±0.004 mm）、15J 测量显微镜（X/Y 测微器分度 0.01 mm）。

数据处理要求（教材）：
  (1) 计算板长、板宽及其测量不确定度
  (2) 计算孔径及其测量不确定度
  (3) 计算金属板厚度及其测量不确定度
  (4) 计算缝长、缝宽及其测量不确定度
  (5) 计算板体积、圆孔体积、缝体积及其测量不确定度
  (6) 计算金属体体积及其不确定度
体积模型：金属体 = 板 − 圆孔 − 缝（三者均贯穿板厚 d）。
"""

import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.variants import compose, render_custom_quiz
from common.custom_plot import render_custom_plot
from common.data_io import load_data

# t 因子（置信概率 0.683，与全项目口径一致）：下标 = 测量次数 n
T_FACTOR = [0, 0, 1.84, 1.32, 1.2, 1.14, 1.11, 1.09, 1.08]
SQRT3 = math.sqrt(3)

# ── 示例数据（计算器 default，量级参照教材表 3-1-6）──
L_DEFAULT = 60.0        # 板长，mm（直尺，1 次）
W_DEFAULT = 40.0        # 板宽，mm（直尺，1 次）
D_DEFAULT = [8.02, 8.00, 8.03, 8.01, 8.02]   # 孔径，mm（游标卡尺，5 次）
D_SHI_DEFAULT = [2.006, 2.004, 2.005, 2.007, 2.006]  # 板厚，mm（千分尺，5 次）
X0_DEFAULT = [10.000, 10.000, 10.001, 10.000, 10.000]  # 缝长起点读数，mm
X1_DEFAULT = [30.014, 30.010, 30.012, 30.013, 30.011]  # 缝长终点读数，mm
Y0_DEFAULT = [12.000, 12.001, 12.000, 12.000, 12.001]  # 缝宽起点读数，mm
Y1_DEFAULT = [13.002, 13.000, 13.001, 13.003, 13.001]  # 缝宽终点读数，mm
D0_DEFAULT = -0.005     # 螺旋测微计零点读数，mm
D0_CARD_DEFAULT = 0.000  # 游标卡尺零点读数，mm

# 仪器误差（教材表 3-1-1/3-1-3/3-1-4 及分度值）
DL_INST = 0.2    # 米尺允许误差，mm（500~1000 mm 档 ±0.20）
DD_INST = 0.02   # 游标卡尺分度值（50 分度），mm
DD_SHI_INST = 0.004  # 一级千分尺 0~100 mm 示值误差，mm
DX_INST = 0.01   # 测量显微镜测微器分度值，mm


def smartlab_ua(data):
    """A 类不确定度：t 因子 × 均值标准误。"""
    n = len(data)
    if n < 2:
        return 0.0
    t = T_FACTOR[n] if n < len(T_FACTOR) else 1.0
    mean_val = sum(data) / n
    variance = sum((x - mean_val) ** 2 for x in data) / ((n - 1) * n)
    return t * math.sqrt(variance)


def smartlab_u(data, inst_err):
    """合成不确定度：A 类（t 因子）+ B 类（均匀分布 /√3）。"""
    ua = smartlab_ua(data)
    return math.sqrt(ua ** 2 + (inst_err / SQRT3) ** 2)


# （方式三：_create_template 已移除，数据真相为 data.json）


def _compute(data: dict) -> dict:
    # 仪器误差
    dl_inst = float(data["dl_inst"])
    dd_inst = float(data["dd_inst"])
    dd_shi_inst = float(data["dd_shi_inst"])
    dx_inst = float(data["dx_inst"])

    # 零点读数（未填按 0 处理）
    d0 = float(data.get("d0") or 0.0)
    d0_card = float(data.get("d0_card") or 0.0)

    # 测量值（数组过滤未填）
    L = float(data["L"])
    W = float(data["W"])
    D = [float(v) for v in (data.get("D") or []) if v is not None]
    d_shi = [float(v) for v in (data.get("d_shi") or []) if v is not None]
    X0 = [float(v) for v in (data.get("X0") or []) if v is not None]
    X1 = [float(v) for v in (data.get("X1") or []) if v is not None]
    Y0 = [float(v) for v in (data.get("Y0") or []) if v is not None]
    Y1 = [float(v) for v in (data.get("Y1") or []) if v is not None]

    if L <= 0 or W <= 0 or any(x < 0 for x in (dl_inst, dd_inst, dd_shi_inst, dx_inst)):
        raise ValueError("板长、板宽必须大于零，仪器误差不能为负")
    if any(not values for values in (D, d_shi, X0, X1, Y0, Y1)) or len(X0) != len(X1) or len(Y0) != len(Y1):
        raise ValueError("请填写完整且成对的测量数组")
    n = len(D)

    # 板长 / 板宽：单次测量，仅 B 类（无 A 类，不做 3σ 检验）
    uL = dl_inst / math.sqrt(3)
    uW = dl_inst / math.sqrt(3)

    # 缝长 / 缝宽（测量显微镜，逐对求差）
    Lx = [abs(x1 - x0) for x0, x1 in zip(X0, X1)]
    Ly = [abs(y1 - y0) for y0, y1 in zip(Y0, Y1)]

    # 3σ 坏值检验：D、d、Lx、Ly 都是同一被测量的等精度重复测量（n = 5），迭代剔除
    ot_D = outlier_test(D)
    ot_d = outlier_test(d_shi)
    ot_Lx = outlier_test(Lx)
    ot_Ly = outlier_test(Ly)
    D_kept = ot_D["kept"]
    d_kept = ot_d["kept"]
    Lx_kept = ot_Lx["kept"]
    Ly_kept = ot_Ly["kept"]

    # 孔径（游标卡尺，零点修正）
    D_a = sum(D_kept) / len(D_kept)
    D_corrected = D_a - d0_card
    uD = smartlab_u(D_kept, dd_inst)

    # 板厚（千分尺，零点修正）
    d_a = sum(d_kept) / len(d_kept)
    d_corrected = d_a - d0
    ud = smartlab_u(d_kept, dd_shi_inst)

    # 缝长 / 缝宽（测量显微镜，逐对求差）
    Lx_a = sum(Lx_kept) / len(Lx_kept)
    Ly_a = sum(Ly_kept) / len(Ly_kept)
    # 每对含两个读数，B 类按两个分度值合成
    uB_x = math.sqrt(2) * dx_inst / math.sqrt(3)
    uLx = math.sqrt(smartlab_ua(Lx_kept) ** 2 + uB_x ** 2)
    uLy = math.sqrt(smartlab_ua(Ly_kept) ** 2 + uB_x ** 2)

    # 各量 A / B 类分量（报告展示用；B 类 = Δ仪/√3，缝值按两个分度值合成）
    uA_D = smartlab_ua(D_kept); uB_D = dd_inst / SQRT3
    uA_d = smartlab_ua(d_kept); uB_d = dd_shi_inst / SQRT3
    uA_Lx = smartlab_ua(Lx_kept); uA_Ly = smartlab_ua(Ly_kept)
    t_D = T_FACTOR[len(D_kept)] if len(D_kept) < len(T_FACTOR) else 1.0
    t_d = T_FACTOR[len(d_kept)] if len(d_kept) < len(T_FACTOR) else 1.0
    t_Lx = T_FACTOR[len(Lx_kept)] if len(Lx_kept) < len(T_FACTOR) else 1.0
    t_Ly = T_FACTOR[len(Ly_kept)] if len(Ly_kept) < len(T_FACTOR) else 1.0

    if min(D_corrected, d_corrected, Lx_a, Ly_a) <= 0:
        raise ValueError("零点修正后孔径、板厚及缝尺寸必须大于零")
    if L * W <= math.pi * D_corrected ** 2 / 4 + Lx_a * Ly_a:
        raise ValueError("孔与缝的面积不能达到或超过板面积，请核对尺寸")
    # 体积（贯穿板厚 d）
    V_p = L * W * d_corrected
    V_h = math.pi * D_corrected ** 2 / 4 * d_corrected
    V_s = Lx_a * Ly_a * d_corrected
    V = V_p - V_h - V_s

    # 不确定度传递（相对合成）
    uVp = V_p * math.sqrt((uL / L) ** 2 + (uW / W) ** 2 + (ud / d_corrected) ** 2)
    uVh = V_h * math.sqrt((2 * uD / D_corrected) ** 2 + (ud / d_corrected) ** 2)
    uVs = V_s * math.sqrt((uLx / Lx_a) ** 2 + (uLy / Ly_a) ** 2 + (ud / d_corrected) ** 2)
    # All three volumes share d: propagate independent ORIGINAL measurements.
    area = L * W - math.pi * D_corrected ** 2 / 4 - Lx_a * Ly_a
    uV = math.sqrt((W * d_corrected * uL) ** 2 + (L * d_corrected * uW) ** 2
                   + (math.pi * D_corrected * d_corrected * uD / 2) ** 2
                   + (Ly_a * d_corrected * uLx) ** 2 + (Lx_a * d_corrected * uLy) ** 2
                   + (area * ud) ** 2)

    return {
        "dl_inst": dl_inst, "dd_inst": dd_inst, "dd_shi_inst": dd_shi_inst, "dx_inst": dx_inst,
        "d0": d0, "d0_card": d0_card,
        "L": L, "W": W, "uL": uL, "uW": uW,
        "D": D, "D_a": D_a, "D_corrected": D_corrected, "uD": uD,
        "d_shi": d_shi, "d_a": d_a, "d_corrected": d_corrected, "ud": ud,
        "X0": X0, "X1": X1, "Y0": Y0, "Y1": Y1,
        "Lx": Lx, "Ly": Ly, "Lx_a": Lx_a, "Ly_a": Ly_a, "uLx": uLx, "uLy": uLy,
        # A / B 类分量与 3σ 检验（报告展示用）
        "sD": std_dev(D_kept), "uA_D": uA_D, "uB_D": uB_D, "t_D": t_D, "n_D": len(D_kept),
        "sd": std_dev(d_kept), "uA_d": uA_d, "uB_d": uB_d, "t_d": t_d, "n_d": len(d_kept),
        "sLx": std_dev(Lx_kept), "uA_Lx": uA_Lx, "uB_x": uB_x, "t_Lx": t_Lx,
        "n_Lx": len(Lx_kept),
        "sLy": std_dev(Ly_kept), "uA_Ly": uA_Ly, "t_Ly": t_Ly, "n_Ly": len(Ly_kept),
        "ot_D": ot_D, "ot_d": ot_d, "ot_Lx": ot_Lx, "ot_Ly": ot_Ly,
        "D_kept": D_kept, "d_kept": d_kept, "Lx_kept": Lx_kept, "Ly_kept": Ly_kept,
        "V_p": V_p, "V_h": V_h, "V_s": V_s, "V": V,
        "uVp": uVp, "uVh": uVh, "uVs": uVs, "uV": uV,
        # u(V) 传播式的各项传递系数（代入数据用）
        "area": area,
        "coef_Wd": W * d_corrected, "coef_Ld": L * d_corrected,
        "coef_piDd": math.pi * D_corrected * d_corrected / 2,
        "coef_Lyd": Ly_a * d_corrected, "coef_Lxd": Lx_a * d_corrected,
        "REL": uV / V * 100 if V else 0.0,
        # 变体文本只能写固定格式（%.2f/%.3f 之类），表达不了课程 2-4 的取位规则，
        # 会出现「正文 (4.68 \pm 0.02)\times10^3 而结论 4683.7 \pm 17.6」这种不一致；
        # 故把「值 ± 不确定度」与单个不确定度都预格式化，变体用 %s 引用
        "L_pm": format_measure(L, uL), "W_pm": format_measure(W, uW),
        "D_pm": format_measure(D_corrected, uD), "d_pm": format_measure(d_corrected, ud),
        "Lx_pm": format_measure(Lx_a, uLx), "Ly_pm": format_measure(Ly_a, uLy),
        "V_pm": format_measure(V, uV),
        "uD_s": format_uncertainty(uD), "ud_s": format_uncertainty(ud),
        "uLx_s": format_uncertainty(uLx), "uLy_s": format_uncertainty(uLy),
        "uL_s": format_uncertainty(uL), "uW_s": format_uncertainty(uW),
        "uV_s": format_uncertainty(uV),
        "n": n,
    }


def _print_results(r: dict):
    print("=" * 60)
    print("长度与体积的测量 — 计算结果")
    print("=" * 60)
    print(f"零点读数: 千分尺 d0={r['d0']} mm, 游标卡尺 D0={r['d0_card']} mm")
    print(f"板长 L = {r['L']} mm, u(L) = {r['uL']:.4f} mm")
    print(f"板宽 W = {r['W']} mm, u(W) = {r['uW']:.4f} mm")
    print(f"孔径 D = {r['D']}, 平均 {r['D_a']:.3f} (修正 {r['D_corrected']:.3f}) mm, u(D) = {r['uD']:.5f} mm")
    print(f"板厚 d = {r['d_shi']}, 平均 {r['d_a']:.4f} (修正 {r['d_corrected']:.4f}) mm, u(d) = {r['ud']:.5f} mm")
    print(f"缝长 Lx = {r['Lx']}, 平均 {r['Lx_a']:.4f} mm, u(Lx) = {r['uLx']:.5f} mm")
    print(f"缝宽 Ly = {r['Ly']}, 平均 {r['Ly_a']:.4f} mm, u(Ly) = {r['uLy']:.5f} mm")
    print()
    print(f"板体积 Vp = {r['V_p']:.2f} mm³, u = {r['uVp']:.2f} mm³")
    print(f"圆孔体积 Vh = {r['V_h']:.2f} mm³, u = {r['uVh']:.2f} mm³")
    print(f"缝体积 Vs = {r['V_s']:.2f} mm³, u = {r['uVs']:.2f} mm³")
    print(f"金属体体积 V = {r['V']:.2f} mm³, u = {r['uV']:.2f} mm³")
    print("=" * 60)


def _generate_docx(data: dict, output_path: str):
    # 校验必填数据（required 字段为 null 或 array 含 null → 缺失）
    missing = []
    for k in ("dl_inst", "dd_inst", "dd_shi_inst", "dx_inst",
              "L", "W", "D", "d_shi", "X0", "X1", "Y0", "Y1"):
        v = data.get(k)
        if v is None:
            missing.append(k)
        elif isinstance(v, list) and any(x is None for x in v):
            missing.append(k)
    if missing:
        print("以下必填数据未填写，请补齐后重新运行：")
        for m in missing:
            print(f"  - {m}")
        return

    r = _compute(data)
    _print_results(r)

    doc = DocxReportWriter(output_path)
    doc.add_title("长度与体积的测量")
    doc.add_student_info()

    # ── 变体组合：实验原理 / 实验方法（存在 variants.json 且应用传入选择时生效）──
    variants = compose(SCRIPT_DIR, r)
    if "实验原理" in variants:
        doc.add_heading("实验原理", level=1)
        doc.add_paragraph_rich(variants["实验原理"])
    if "实验方法" in variants:
        doc.add_heading("实验方法", level=1)
        doc.add_paragraph_rich(variants["实验方法"])

    doc.add_heading("一、原始数据提交（拍照上传）", level=1)
    doc.add_data_photo("请在下方粘贴原始数据记录照片（含仪器读数与数据表格）。")

    doc.add_heading("二、数据处理", level=1)

    doc.add_heading("1. 实验参数", level=2)
    doc.add_paragraph("")
    doc.add_run("螺旋测微计零点读数 d₀ = ")
    doc.add_inline_math(f"{r['d0']} mm")
    doc.add_run("，游标卡尺零点读数 D₀ = ")
    doc.add_inline_math(f"{r['d0_card']} mm")
    doc.add_paragraph("")
    doc.add_run("仪器允差（均匀分布）：米尺 ")
    doc.add_inline_math(r"\Delta_{\text{仪}} = " + f"{r['dl_inst']}")
    doc.add_run(" mm，游标卡尺（50 分度）")
    doc.add_inline_math(r"\Delta_{\text{仪}} = " + f"{r['dd_inst']}")
    doc.add_run(" mm，螺旋测微计（一级）")
    doc.add_inline_math(r"\Delta_{\text{仪}} = " + f"{r['dd_shi_inst']}")
    doc.add_run(" mm，15J 测量显微镜 ")
    doc.add_inline_math(r"\Delta_{\text{仪}} = " + f"{r['dx_inst']}")
    doc.add_run(" mm")

    doc.add_heading("2. 板长与板宽", level=2)
    doc.add_paragraph("")
    doc.add_run("用米尺测量金属板长、宽各 1 次，属于单次测量，不确定度仅取 B 类（均匀分布）：")
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"u(L) = u(W) = \frac{\Delta_{\text{仪}}}{\sqrt{3}} = \frac{"
        + f"{r['dl_inst']}" + r"}{\sqrt{3}} \approx "
        + format_number(r["uL"], sig_figs=4) + r"\,\text{mm}"
    )
    doc.add_paragraph("")
    doc.add_run("板长 L = ")
    doc.add_inline_math(format_measure(r["L"], r["uL"]) + r" \text{ mm}")
    doc.add_run("（u(L) = ")
    doc.add_inline_math(format_uncertainty(r["uL"]) + r" \text{ mm}")
    doc.add_run("）；板宽 W = ")
    doc.add_inline_math(format_measure(r["W"], r["uW"]) + r" \text{ mm}")
    doc.add_run("（u(W) = ")
    doc.add_inline_math(format_uncertainty(r["uW"]) + r" \text{ mm}")
    doc.add_run("）")

    doc.add_heading("3. 孔径测量（游标卡尺，50 分度）", level=2)
    doc.add_paragraph("")
    doc.add_table(["测量量", *[str(i + 1) for i in range(r["n"])]],
                  [["D / mm", *[f"{x:.2f}" for x in r["D"]]]],
                  col_widths=[1.5] + [1.4] * r["n"])
    doc.add_paragraph("")
    doc.add_run("平均值：")
    doc.add_inline_math(f"D_a = {r['D_a']:.3f} mm")
    doc.add_run("，扣除游标卡尺零点读数 D₀ 后：")
    doc.add_inline_math(r"D = D_a - D_0 = " + format_measure(r["D_corrected"], r["uD"])
                        + r" \text{ mm}")
    doc.add_paragraph("")
    doc.add_run("3σ 坏值检验：")
    doc.add_inline_math(
        r"3\sigma = 3 \times " + format_number(r["sD"] * r["t_D"], sig_figs=4)
        + r" \approx " + format_number(3 * r["sD"] * r["t_D"], sig_figs=4) + r"\,\text{mm}"
    )
    doc.add_paragraph(outlier_note(r["ot_D"], unit=" mm", digits=4))
    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        r"u_A(D) = \frac{t\,s(D)}{\sqrt{n}} = \frac{" + f"{r['t_D']:g}" + r" \times "
        + format_number(r["sD"], sig_figs=5) + r"}{\sqrt{" + f"{r['n_D']}" + r"}} \approx "
        + format_number(r["uA_D"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"u_B(D) = \frac{\Delta_{\text{仪}}}{\sqrt{3}} = \frac{"
        + f"{r['dd_inst']}" + r"}{\sqrt{3}} \approx "
        + format_number(r["uB_D"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        r"u(D) = \sqrt{u_A(D)^2 + u_B(D)^2} = \sqrt{"
        + format_number(r["uA_D"], sig_figs=5) + r"^2 + "
        + format_number(r["uB_D"], sig_figs=5) + r"^2} \approx "
        + format_number(r["uD"], sig_figs=5) + r" \text{ mm}"
    )

    doc.add_heading("4. 板厚测量（螺旋测微计）", level=2)
    doc.add_paragraph("")
    doc.add_table(["测量量", *[str(i + 1) for i in range(r["n"])]],
                  [["d / mm", *[f"{x:.3f}" for x in r["d_shi"]]]],
                  col_widths=[1.5] + [1.4] * r["n"])
    doc.add_paragraph("")
    doc.add_run("平均值：")
    doc.add_inline_math(f"d_a = {r['d_a']:.4f} mm")
    doc.add_run("，扣除零点读数 d₀ 后：")
    doc.add_inline_math(r"d = d_a - d_0 = " + format_measure(r["d_corrected"], r["ud"])
                        + r" \text{ mm}")
    doc.add_paragraph("")
    doc.add_run("3σ 坏值检验：")
    doc.add_inline_math(
        r"3\sigma = 3 \times " + format_number(r["sd"] * r["t_d"], sig_figs=4)
        + r" \approx " + format_number(3 * r["sd"] * r["t_d"], sig_figs=4) + r"\,\text{mm}"
    )
    doc.add_paragraph(outlier_note(r["ot_d"], unit=" mm", digits=5))
    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        r"u_A(d) = \frac{t\,s(d)}{\sqrt{n}} = \frac{" + f"{r['t_d']:g}" + r" \times "
        + format_number(r["sd"], sig_figs=5) + r"}{\sqrt{" + f"{r['n_d']}" + r"}} \approx "
        + format_number(r["uA_d"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"u_B(d) = \frac{\Delta_{\text{仪}}}{\sqrt{3}} = \frac{"
        + f"{r['dd_shi_inst']}" + r"}{\sqrt{3}} \approx "
        + format_number(r["uB_d"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        r"u(d) = \sqrt{u_A(d)^2 + u_B(d)^2} = \sqrt{"
        + format_number(r["uA_d"], sig_figs=5) + r"^2 + "
        + format_number(r["uB_d"], sig_figs=5) + r"^2} \approx "
        + format_number(r["ud"], sig_figs=5) + r" \text{ mm}"
    )

    doc.add_heading("5. 缝长与缝宽测量（15J 测量显微镜）", level=2)
    doc.add_paragraph("")
    doc.add_run("沿 X 方向移动工作台，用十字线对准缝隙两边，读数差即为缝长；Y 方向同理得缝宽。"
                "每个方向记录 5 对读数（起点 X₀/Y₀、终点 X₁/Y₁），逐对求差：")
    rows = []
    for i in range(r["n"]):
        rows.append([
            str(i + 1),
            f"{r['X0'][i]:.3f}", f"{r['X1'][i]:.3f}", f"{r['Lx'][i]:.3f}",
            f"{r['Y0'][i]:.3f}", f"{r['Y1'][i]:.3f}", f"{r['Ly'][i]:.3f}",
        ])
    doc.add_table(
        ["次数", "X₀ / mm", "X₁ / mm", "Lx / mm", "Y₀ / mm", "Y₁ / mm", "Ly / mm"],
        rows, col_widths=[1.2, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7]
    )
    doc.add_paragraph("")
    doc.add_run("缝长：")
    doc.add_inline_math(r"L_x = " + format_measure(r["Lx_a"], r["uLx"]) + r" \text{ mm}")
    doc.add_run("，缝宽：")
    doc.add_inline_math(r"L_y = " + format_measure(r["Ly_a"], r["uLy"]) + r" \text{ mm}")
    doc.add_paragraph("")
    doc.add_run("每个缝值由两个读数之差得到（一个缝值含两个分度值），逐对求差后作 3σ 检验：")
    doc.add_inline_math(
        r"3\sigma = 3 \times " + format_number(r["sLx"] * r["t_Lx"], sig_figs=4)
        + r" \approx " + format_number(3 * r["sLx"] * r["t_Lx"], sig_figs=4)
        + r"\,\text{mm}"
    )
    doc.add_paragraph("缝长：" + outlier_note(r["ot_Lx"], unit=" mm", digits=5))
    doc.add_paragraph("缝宽：" + outlier_note(r["ot_Ly"], unit=" mm", digits=5))
    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        r"u_A(L_x) = \frac{t\,s(L_x)}{\sqrt{n}} = \frac{" + f"{r['t_Lx']:g}" + r" \times "
        + format_number(r["sLx"], sig_figs=5) + r"}{\sqrt{" + f"{r['n_Lx']}" + r"}} \approx "
        + format_number(r["uA_Lx"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_math(
        r"u_A(L_y) = \frac{t\,s(L_y)}{\sqrt{n}} = \frac{" + f"{r['t_Ly']:g}" + r" \times "
        + format_number(r["sLy"], sig_figs=5) + r"}{\sqrt{" + f"{r['n_Ly']}" + r"}} \approx "
        + format_number(r["uA_Ly"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"u_B = \frac{\sqrt{2}\,\Delta_{\text{仪}}}{\sqrt{3}} = \frac{\sqrt{2} \times "
        + f"{r['dx_inst']}" + r"}{\sqrt{3}} \approx "
        + format_number(r["uB_x"], sig_figs=5) + r"\,\text{mm}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        r"u(L_x) = \sqrt{u_A(L_x)^2 + u_B^2} = \sqrt{"
        + format_number(r["uA_Lx"], sig_figs=5) + r"^2 + "
        + format_number(r["uB_x"], sig_figs=5) + r"^2} \approx "
        + format_number(r["uLx"], sig_figs=5) + r" \text{ mm}"
    )
    doc.add_math(
        r"u(L_y) = \sqrt{u_A(L_y)^2 + u_B^2} = \sqrt{"
        + format_number(r["uA_Ly"], sig_figs=5) + r"^2 + "
        + format_number(r["uB_x"], sig_figs=5) + r"^2} \approx "
        + format_number(r["uLy"], sig_figs=5) + r" \text{ mm}"
    )

    doc.add_heading("6. 体积计算与不确定度", level=2)
    doc.add_paragraph("")
    doc.add_run("金属体体积由板体积扣除圆孔体积与缝体积得到（圆孔与缝均贯穿板厚 d）：")
    doc.add_math(
        r"V = V_p - V_h - V_s = L \cdot W \cdot d - \frac{\pi D^2}{4} \cdot d - L_x \cdot L_y \cdot d"
    )
    doc.add_paragraph("")
    rows = [
        ["板体积 Vp / mm³", f"{r['V_p']:.2f}", f"{r['uVp']:.2f}"],
        ["圆孔体积 Vh / mm³", f"{r['V_h']:.2f}", f"{r['uVh']:.2f}"],
        ["缝体积 Vs / mm³", f"{r['V_s']:.2f}", f"{r['uVs']:.2f}"],
        ["金属体体积 V / mm³", f"{r['V']:.2f}", f"{r['uV']:.2f}"],
    ]
    doc.add_table(["项目", "体积值", "不确定度"], rows, col_widths=[4.0, 2.5, 2.5])
    doc.add_paragraph("")
    doc.add_run("相对不确定度合成（各量独立）：")
    doc.add_math(
        r"\frac{u(V_p)}{V_p} = \sqrt{\left(\frac{u(L)}{L}\right)^2 + \left(\frac{u(W)}{W}\right)^2 + \left(\frac{u(d)}{d}\right)^2}"
    )
    doc.add_math(
        r"\frac{u(V_h)}{V_h} = \sqrt{\left(2\frac{u(D)}{D}\right)^2 + \left(\frac{u(d)}{d}\right)^2}, \quad "
        r"\frac{u(V_s)}{V_s} = \sqrt{\left(\frac{u(L_x)}{L_x}\right)^2 + \left(\frac{u(L_y)}{L_y}\right)^2 + \left(\frac{u(d)}{d}\right)^2}"
    )
    doc.add_paragraph("")
    doc.add_paragraph("板、孔、缝共用厚度测量，因此从原始独立尺寸传播不确定度。"
                      "令 a=Wd、b=Ld、c=πDd/2、e=L_yd、f=L_xd，"
                      "A=LW-πD²/4-L_xL_y（即对厚度的传递系数），则金属体体积的绝对不确定度：")
    # 展开成 6 项后整条超过版心（根号内不能跨行拆分），故用传递系数符号 a~f、A 书写。
    doc.add_math(
        r"u(V) = \sqrt{a^2u(L)^2 + b^2u(W)^2 + c^2u(D)^2 + e^2u(L_x)^2 + f^2u(L_y)^2 + A^2u(d)^2}"
    )
    doc.add_paragraph("代入数据（根号内各项平方和 = %s mm⁶）："
                      % format_number(r["uV"] ** 2, sig_figs=5))
    doc.add_math(
        r"u(V) = \sqrt{" + format_number(r["uV"] ** 2, sig_figs=5) + r"} \approx "
        + format_number(r["uV"], sig_figs=5) + r"\,\text{mm}^3"
    )
    doc.add_paragraph("按课程取位规则（不确定度只进不舍取 1 位有效数字），"
                       + f"u(V) = {format_number(r['uV'], r['uV'])} mm³。")
    doc.add_paragraph("")
    doc.add_run("最终结果：")
    v_power = math.floor(math.log10(r["V"]))
    doc.add_math(
        r"V = (" + format_number(r["V"] / 10 ** v_power, r["uV"] / 10 ** v_power)
        + r" \pm " + format_number(r["uV"] / 10 ** v_power, r["uV"] / 10 ** v_power)
        + r") \times 10^{" + f"{v_power}" + r"} \text{ mm}^3"
    )
    # 自定义画图：本实验无内置图，AI 生成的图按顺序追加在「数据处理」末尾
    render_custom_plot(doc, 1, width_cm=14)
    render_custom_plot(doc, 2, width_cm=14)
    render_custom_plot(doc, 3, width_cm=14)


    doc.add_heading("三、实验结果分析", level=1)

    # 结果分析 AI 导入消费点：AI 润色导入的「结果分析」覆盖硬编码段落
    if "结果分析" in variants:
        doc.add_paragraph_rich(variants["结果分析"])
    doc.add_paragraph("")
    doc.add_run("本实验综合使用米尺、游标卡尺、螺旋测微计和 15J 测量显微镜四种长度测量仪器，"
                "分别适用于不同精度等级的测量对象：板长与板宽用米尺单次测量，孔径用 50 分度游标卡尺，"
                "板厚用千分尺，缝长与缝宽用测量显微镜。测得金属体体积 V = ")
    doc.add_inline_math(f"{format_number(r['V'], sig_figs=2)} mm³")
    doc.add_run("，相对不确定度约 ")
    doc.add_inline_math(f"{format_percent(r['uV'] / r['V'] * 100)}%")
    doc.add_run("，精度主要受缝宽（最小尺寸）与孔径测量限制。")

    doc.add_paragraph("")
    doc.add_run("误差来源分析：")
    doc.add_run("（1）米尺估读误差：读数需估读到分度值的 1/10，且存在视差；")
    doc.add_run("（2）游标卡尺零点未对准及读数时游标刻线对齐判断误差；")
    doc.add_run("（3）千分尺零点读数修正与棘轮接触压力控制；")
    doc.add_run("（4）测量显微镜测微鼓轮的空回误差，要求单向旋转读数；")
    doc.add_run("（5）被测物体表面平整度、测量面磨损等系统因素。")

    # ── 变体组合：误差分析 / 结论（存在 variants.json 且应用传入选择时生效）──
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=1)
        doc.add_paragraph_rich(variants["误差分析"])
    if "结论" in variants:
        doc.add_heading("结论", level=1)
        doc.add_paragraph_rich(variants["结论"])

    doc.add_heading("四、思考题", level=1)

    # ── 思考题变体：题目写死；回答按问随机（dict）/ 整段润色覆盖（str）/ 硬编码兜底 ──
    import random
    if not render_custom_quiz(doc, r):
        _quiz = variants.get("思考题")
        if isinstance(_quiz, str) and _quiz.strip():
            doc.add_paragraph_rich(_quiz)
            _quiz = None
        elif not isinstance(_quiz, dict):
            _quiz = None

        doc.add_heading("1. 为什么米尺读数要估读到分度值的 1/10？", level=2)
        _o = _quiz.get("1") if _quiz else None
        if _o:
            doc.add_paragraph_rich(random.choice(_o))
        else:

            doc.add_paragraph(
                "答：米尺最小分度为 1 mm，测量时可精确读到毫米位。估读到分度值的 1/10（即 0.1 mm）"
                "可以在不降低可靠性的前提下充分利用仪器信息，减小读数随机误差。估读本身就是一次"
                "在相邻刻线之间的内插，是人为判断的结果，其不确定度约为最小分度的 1/10，故读数结果"
                "记为 L ± 0.1 mm 量级。"
            )

        doc.add_heading("2. 游标卡尺为什么能准确读出分度值的 1/n？", level=2)
        _o = _quiz.get("2") if _quiz else None
        if _o:
            doc.add_paragraph_rich(random.choice(_o))
        else:

            doc.add_paragraph(
                "答：游标卡尺利用游标（副尺）与主尺分度之间的微小差值来实现细分。n 个游标分度与主尺上 "
                "Mn−1 个分度等长，主尺分度 a 与游标分度 b 之差 h = a − b = a/n，即为游标卡尺的分度值。"
                "读数时只需判断游标上哪一根刻线与主尺刻线对齐，该刻线的序号 k 与 h 的乘积 kh 就是"
                "小于一个主尺分度的部分，因此可以准确读出 a/n 的整数倍而无需估读。"
            )

        doc.add_heading("3. 为什么要对千分尺和游标卡尺进行零点修正？", level=2)
        _o = _quiz.get("3") if _quiz else None
        if _o:
            doc.add_paragraph_rich(random.choice(_o))
        else:

            doc.add_paragraph(
                "答：仪器在长期使用后，测量面磨损或装配间隙变化会使“零位”偏离理想位置。若测量前两测量面"
                "直接接触时微分套筒读数不为零（千分尺零点读数 d₀ 可正可负），或游标零线与主尺零线不重合"
                "（游标卡尺零点读数 D₀），则所有测量读数都带有固定的系统偏差。通过测量前记录零点读数，"
                "并在结果中扣除（实际长度 = 测量读数 − 零点读数），即可消除该系统误差。"
            )

    doc.save()
    doc.close()


def main():
    DATA_FILE = os.path.join(SCRIPT_DIR, "data.json")
    DOCX_FILE = os.path.join(SCRIPT_DIR, "长度与体积的测量.docx")
    data = load_data(DATA_FILE)
    if not data:
        print("未找到 data.json 或数据为空，请先在应用中填写数据。")
        return
    _generate_docx(data, DOCX_FILE)
    print(f"报告已生成: {DOCX_FILE}")


if __name__ == "__main__":
    main()
