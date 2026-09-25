# -*- coding: utf-8 -*-
"""电流场模拟静电场：按「电流场模拟静电场-慕寒」的两种电极模型生成报告。

数据以表1的7×12半径和表3的6×10坐标为准；表2均值与拟合系数每次重算。
源文档正文的实验拟合系数与其表2不一致，不能作为固定常数写入报告。
"""

import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import linear_regression
from common.data_io import load_data
from common.docx_report import DocxReportWriter
from common.custom_plot import render_custom_plot
from common.variants import compose, render_custom_quiz

COAX_LEVELS = tuple(range(1, 8))
PARALLEL_LEVELS = tuple(range(3, 9))
ANGLES = tuple(range(0, 360, 30))
COLORS = ("#0072B2", "#E69F00", "#009E73", "#CC79A7",
          "#56B4E9", "#D55E00", "#000000")

plt.rcParams.update({
    "font.sans-serif": ["Microsoft YaHei", "SimHei", "DejaVu Sans"],
    "axes.unicode_minus": False,
    "font.size": 9,
    "axes.labelsize": 9,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "savefig.dpi": 300,
})


def _number(value, label):
    if value is None:
        raise ValueError(f"{label}未填写")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}不是有效数字") from exc
    if not math.isfinite(result):
        raise ValueError(f"{label}必须是有限数字")
    return result


def _matrix(data, key, rows, cols, positive=False):
    raw = data.get(key)
    if not isinstance(raw, list) or len(raw) != rows:
        raise ValueError(f"{key}应有{rows}行；旧版仅有半径汇总值的数据请重新核对表1、表3")
    result = []
    for i, row in enumerate(raw, 1):
        if not isinstance(row, list) or len(row) != cols:
            raise ValueError(f"{key}第{i}行应有{cols}个点")
        values = [_number(v, f"{key}第{i}行第{j}点") for j, v in enumerate(row, 1)]
        if positive and any(v <= 0 for v in values):
            raise ValueError(f"{key}第{i}行半径必须大于0")
        result.append(values)
    return result


def _compute(data):
    u_a = _number(data.get("u_a"), "电源电压 U_a")
    r_a = _number(data.get("r_a"), "内电极半径 r_a")
    r_b = _number(data.get("r_b"), "外电极半径 r_b")
    if not (u_a >= 8 and 0 < r_a < r_b):
        raise ValueError("需满足 U_a≥8 V 且 0<r_a<r_b，才能覆盖模板中的全部等势线")
    coax = _matrix(data, "coax_radii", 7, 12, positive=True)
    px = _matrix(data, "parallel_x", 6, 10)
    py = _matrix(data, "parallel_y", 6, 10)
    avg_r = [sum(row) / len(row) for row in coax]
    ln_r = [math.log(v) for v in avg_r]
    ratio = [u / u_a for u in COAX_LEVELS]
    fit = linear_regression(ln_r, ratio)  # 与慕寒模板图2一致：x=ln r，y=U_r/U_a
    theory_slope = -1 / math.log(r_b / r_a)
    return {
        "u_a": u_a, "r_a": r_a, "r_b": r_b,
        "coax_radii": coax, "parallel_x": px, "parallel_y": py,
        "r": avg_r, "ln_r": ln_r,
        "u_r": COAX_LEVELS, "u_r_ua": ratio, "n": len(COAX_LEVELS),
        "slope": fit.slope, "intercept": fit.intercept,
        "slope_u": fit.slope_uncertainty, "intercept_u": fit.intercept_uncertainty,
        "r_corr": fit.r, "r_squared": fit.r_squared,
        "theory_slope": theory_slope, "theory_intercept": 1.0,
        "slope_error": abs((fit.slope - theory_slope) / theory_slope) * 100,
        "intercept_error": abs(fit.intercept - 1.0) * 100,
    }


def _save_figure(fig, path):
    fig.savefig(path, dpi=300, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def _plot_coax(r, path):
    fig, ax = plt.subplots(figsize=(6.5, 6.0), constrained_layout=True)
    theta = np.linspace(0, 2 * np.pi, 361)
    observed_theta = np.deg2rad(ANGLES)
    for i, voltage in enumerate(COAX_LEVELS):
        color = COLORS[i]
        radius = r["r"][i]
        ax.plot(radius * np.cos(theta), radius * np.sin(theta),
                color=color, linewidth=1.7, label=f"{voltage} V")
        ax.scatter(np.array(r["coax_radii"][i]) * np.cos(observed_theta),
                   np.array(r["coax_radii"][i]) * np.sin(observed_theta),
                   color=color, s=8, alpha=0.5, zorder=3)
        ax.text(radius + 0.08, (3 - i) * 0.13, f"{voltage}V", color=color, fontsize=7)
    for angle in np.deg2rad(range(0, 360, 30)):
        ax.annotate("", xy=(4.65 * np.cos(angle), 4.65 * np.sin(angle)),
                    xytext=(2.6 * np.cos(angle), 2.6 * np.sin(angle)),
                    arrowprops={"arrowstyle": "->", "lw": 0.65, "color": "#7A8490"})
    ax.set(xlabel="x (cm)", ylabel="y (cm)", title="同轴电缆模型：等势线与电场线")
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlim(-6, 6.4)
    ax.set_ylim(-6, 6)
    ax.grid(alpha=0.18)
    _save_figure(fig, path)


def _plot_fit(r, path):
    x = np.array(r["ln_r"])
    y = np.array(r["u_r_ua"])
    xx = np.linspace(min(x) - 0.06, max(x) + 0.06, 250)
    fig, ax = plt.subplots(figsize=(7, 4.5), constrained_layout=True)
    ax.scatter(x, y, s=36, marker="o", facecolors="white", edgecolors="#0072B2",
               linewidths=1.5, label="测量点", zorder=3)
    ax.plot(xx, r["slope"] * xx + r["intercept"], color="#D55E00",
            linewidth=1.8, label="实验拟合")
    ax.plot(xx, 1 + r["theory_slope"] * xx, color="#343B46",
            linewidth=1.1, linestyle="--", label="理论关系")
    ax.set(xlabel="ln(r / cm)", ylabel=r"$U_r/U_a$", title="同轴电缆模型：归一化电位与 ln r")
    ax.set_ylim(bottom=0)
    ax.grid(alpha=0.18)
    ax.legend(frameon=False, fontsize=8)
    _save_figure(fig, path)


def _plot_parallel(r, path):
    fig, ax = plt.subplots(figsize=(7.4, 5.4), constrained_layout=True)
    curves = []
    for i, voltage in enumerate(PARALLEL_LEVELS):
        xs = np.array(r["parallel_x"][i])
        ys = np.array(r["parallel_y"][i])
        # 每级全部10个实测点参与 x(y) 二次最小二乘，不预设剔除点。
        polynomial = np.poly1d(np.polyfit(ys, xs, 2))
        yy = np.linspace(min(ys), max(ys), 200)
        ax.plot(polynomial(yy), yy, color=COLORS[i], linewidth=1.9,
                label=f"{voltage} V")
        ax.scatter(xs, ys, s=13, color=COLORS[i], alpha=0.65, zorder=3)
        curves.append((polynomial, min(ys), max(ys)))
        label_y = float(np.median(ys))
        ax.text(polynomial(label_y) + 0.06, label_y, f"{voltage}V",
                color=COLORS[i], fontsize=7)
    # 中央共同测量区域的电场线示意：与近似竖直等势线正交，方向由高电位到低电位。
    low = max(curve[1] for curve in curves)
    high = min(curve[2] for curve in curves)
    for y in np.linspace(low + 0.2, high - 0.2, 9):
        x_left = curves[-1][0](y) + 0.18
        x_right = curves[0][0](y) - 0.18
        ax.annotate("", xy=(x_right, y), xytext=(x_left, y),
                    arrowprops={"arrowstyle": "->", "lw": 0.7, "color": "#8B949E"})
    ax.set(xlabel="x (cm)", ylabel="y (cm)", title="平行线电极模型：等势线与电场线")
    ax.grid(alpha=0.15)
    ax.set_xlim(min(min(row) for row in r["parallel_x"]) - 0.3,
                max(max(row) for row in r["parallel_x"]) + 0.3)
    ax.set_ylim(min(min(row) for row in r["parallel_y"]) - 0.3,
                max(max(row) for row in r["parallel_y"]) + 0.3)
    _save_figure(fig, path)


def _generate_docx(data, output_path):
    r = _compute(data)
    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)
    coax_path = os.path.join(output_dir, "coax_field.png")
    fit_path = os.path.join(output_dir, "fit_plot.png")
    parallel_path = os.path.join(output_dir, "parallel_field.png")
    _plot_coax(r, coax_path)
    _plot_fit(r, fit_path)
    _plot_parallel(r, parallel_path)

    doc = DocxReportWriter(output_path)
    doc.add_title("电流场模拟静电场")
    doc.add_student_info()
    variants = compose(SCRIPT_DIR, r)

    doc.add_heading("一、实验原理", level=1)
    if "实验原理" in variants:
        doc.add_paragraph_rich(variants["实验原理"])
    else:
        doc.add_paragraph_rich(
            "无电荷区的静电位与均匀不良导体中稳恒电流场的电位都满足"
            r"$\nabla^2 U=0$。电极形状、电位边界条件一致，且介质电导率均匀并远小于"
            "电极电导率时，两场具有相同的电位分布。因此可用电流场模拟难以直接测量的静电场。"
        )
        doc.add_paragraph_rich(
            r"同轴电缆模型满足 $U_r/U_a=\ln(r_b/r)/\ln(r_b/r_a)$；"
            r"令 $x=\ln(r/\mathrm{cm})$，则 $U_r/U_a=1-x/\ln(r_b/r_a)$。"
            "平行线电极模型在中央区域近似匀强，边缘处出现弯曲。"
        )
    if "实验方法" in variants:
        doc.add_heading("实验方法", level=1)
        doc.add_paragraph_rich(variants["实验方法"])

    doc.add_heading("二、数据记录", level=1)
    doc.add_data_photo("原始测量照片未附；下列表格来自当前保存的数据。")
    doc.add_paragraph("表1 同轴电缆模型：1～7 V 等位线，每30°记录一个半径，共12点。")
    for start in (0, 6):
        headers = ["电势"] + [f"{angle}°" for angle in ANGLES[start:start + 6]]
        rows = [[f"{level} V"] + [f"{v:.2f}" for v in r["coax_radii"][i][start:start + 6]]
                for i, level in enumerate(COAX_LEVELS)]
        doc.add_table(headers, rows)
    doc.add_paragraph("半径单位：cm。源模板角度行中的6 V第10列“70°”按其30°步进更正为270°。")

    doc.add_paragraph("表3 平行线电极模型：3～8 V 等位线，每级10个(x,y)坐标。")
    for start in (0, 5):
        headers = ["电势", "坐标"] + [f"点{j}" for j in range(start + 1, start + 6)]
        rows = []
        for i, level in enumerate(PARALLEL_LEVELS):
            rows.append([f"{level} V", "x/cm"] +
                        [f"{r['parallel_x'][i][j]:.1f}" for j in range(start, start + 5)])
            rows.append(["", "y/cm"] +
                        [f"{r['parallel_y'][i][j]:.1f}" for j in range(start, start + 5)])
        doc.add_table(headers, rows)
    doc.add_paragraph("表中保留全部原始读数；平行线电极场图使用每级全部10个测量点拟合等势线。")

    doc.add_page_break()
    doc.add_heading("三、数据处理与作图", level=1)
    doc.add_heading("（一）同轴电缆静电场分布", level=2)
    if not render_custom_plot(doc, 1, width_cm=9.8):
        doc.add_image(coax_path, width_cm=9.8)
    doc.add_paragraph("图1 各级等势线按12个实测半径取平均绘圆，浅色点为原始半径位置；箭头沿电位降低方向。")
    doc.add_paragraph("表2 同轴电缆模型的 U_r/U_a 与 ln(r/cm) 关系。")
    doc.add_table(["U_r/V", "U_r/U_a", "平均r/cm", "ln(r/cm)"],
                  [[f"{u}", f"{r['u_r_ua'][i]:.3f}", f"{r['r'][i]:.3f}",
                    f"{r['ln_r'][i]:.3f}"] for i, u in enumerate(COAX_LEVELS)])
    doc.add_paragraph("每级平均半径由表1的12个半径重新求算，未照抄源文档中个别不一致的平均值。")
    doc.add_math(r"\frac{U_r}{U_a}=1-\frac{\ln(r/\mathrm{cm})}{\ln(r_b/r_a)}")
    doc.add_paragraph(f"取 r_a={r['r_a']:.2f} cm、r_b={r['r_b']:.2f} cm，"
                      f"理论斜率={r['theory_slope']:.4f}，理论截距=1。")
    if not render_custom_plot(doc, 2, width_cm=14):
        doc.add_image(fit_path, width_cm=14)
    doc.add_paragraph(f"图2 实验点、最小二乘拟合与理论关系。实验式："
                      f"U_r/U_a = {r['slope']:.4f} ln(r/cm) + {r['intercept']:.4f}；"
                      f"R²={r['r_squared']:.4f}。")
    doc.add_paragraph(f"斜率相对误差={r['slope_error']:.2f}%；"
                      f"截距相对误差={r['intercept_error']:.2f}%。")

    doc.add_heading("（二）平行线电极静电场分布", level=2)
    if not render_custom_plot(doc, 3, width_cm=14):
        doc.add_image(parallel_path, width_cm=14)
    doc.add_paragraph("图3 根据表3全部坐标在各级测量范围内拟合的等势线；中央水平箭头为"
                      "与等势线近似正交的电场方向示意，不代表新增测量点。")

    doc.add_heading("四、回答问题及结果分析", level=1)
    if not render_custom_quiz(doc, r):
        doc.add_heading("1. 电源电压加倍后，场的形状与数值如何变化？", level=2)
        doc.add_paragraph("在电极几何和介质条件不变时，归一化等势线与电场线的形状不变；"
                          "各点电位及电场强度随电源电压同比增大。")
        doc.add_heading("2. 导电介质的导电率大小如何影响测量？", level=2)
        doc.add_paragraph("理想均匀介质中，电位分布与导电率绝对值无关；实际介质过于导电时"
                          "引线和电源内阻分压更明显，过于不导电时探针接触电阻和扰动更明显。")
        doc.add_heading("3. 模拟静电场须满足什么条件？", level=2)
        doc.add_paragraph("电极与被模拟导体几何相似；介质导电率均匀且远低于电极；"
                          "电极的电位和接地边界条件与原静电场对应。")

    doc.add_heading("实验结果分析", level=2)
    doc.add_paragraph(f"同轴模型的 U_r/U_a～ln(r/cm) 拟合斜率为 {r['slope']:.4f}，"
                      f"理论值为 {r['theory_slope']:.4f}；"
                      f"拟合截距为 {r['intercept']:.4f}，理论值为1。"
                      "平行线电极中央区域等势线近似平行，边缘发生弯曲。"
                      "偏差可来自电极有限尺寸、接触电阻、介质不均匀和探针定位。")
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=2)
        doc.add_paragraph_rich(variants["误差分析"])
    if "结论" in variants:
        doc.add_heading("结论", level=2)
        doc.add_paragraph_rich(variants["结论"])
    doc.save()
    doc.close()
    return r


def main():
    data_file = os.path.join(SCRIPT_DIR, "data.json")
    data = load_data(data_file)
    if not data:
        raise ValueError("未找到 data.json 或数据为空，请先在应用中填写数据")
    output = os.path.join(SCRIPT_DIR, "静电场的模拟.docx")
    result = _generate_docx(data, output)
    print(f"报告已生成: {output}")
    print(f"U_r/U_a = {result['slope']:.4f} ln(r/cm) + {result['intercept']:.4f}")


if __name__ == "__main__":
    main()
