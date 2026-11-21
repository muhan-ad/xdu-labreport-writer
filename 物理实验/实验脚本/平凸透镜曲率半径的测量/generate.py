"""牛顿环（平凸透镜曲率半径） — 数据处理脚本。"""

import math
import os
import random
import sys
from tempfile import TemporaryDirectory

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.variants import compose, render_custom_quiz
from common.custom_plot import render_custom_plot
from common.data_io import load_data, bind_input_parameters
from common.regression import linear_regression
from common.plot_utils import plot_fit

# ── 物理常数 ──
LAMBDA = None  # 由当前用户填写的波长换算为 mm
DELTA_INSTRUMENT = None  # 由当前用户仪器参数绑定，无示例兜底
SKIP_N = 5                 # 逐差法间隔


# （方式三：_create_template 已移除，数据真相为 data.json）


def _compute(data: dict) -> dict:
    """由左右读数计算各暗环直径、逐差与不确定度，返回结果字典 r。"""
    bind_input_parameters(data, globals(), SCRIPT_DIR)
    global LAMBDA
    wavelength = data.get("wavelength_nm")
    if isinstance(wavelength, bool) or not isinstance(wavelength, (int, float)) or not math.isfinite(wavelength) or wavelength <= 0:
        raise ValueError("光源波长 λ：请填写有限正数（nm）")
    LAMBDA = wavelength * 1e-6
    rings = data.get("rings")
    if (not isinstance(rings, list) or len(rings) != 10 or any(
            isinstance(v, bool) or not isinstance(v, (int, float))
            or not math.isfinite(v) or v <= 0 or v != int(v) for v in rings)):
        raise ValueError("暗环序号应为10个连续的正整数，可递增或递减")
    rings = [int(v) for v in rings]
    step = rings[1] - rings[0]
    if abs(step) != 1 or any(second - first != step for first, second in zip(rings, rings[1:])):
        raise ValueError("本实验采用隔5项逐差法，暗环序号应连续递增或递减，不能跳号、重复或混排")
    d_left = [float(v) for v in data["d_left"]]       # 左侧读数
    d_right = [float(v) for v in data["d_right"]]     # 右侧读数
    if step == 1:
        # 统一按高环号减低环号配对，环号和左右读数同步倒序。
        rings.reverse()
        d_left.reverse()
        d_right.reverse()

    # 直径和直径平方
    D_m = [abs(d_right[i] - d_left[i]) for i in range(10)]
    D_m2 = [d ** 2 for d in D_m]
    radius_squared = [value / 4 for value in D_m2]
    fit = linear_regression(rings, radius_squared)
    if fit.slope <= 0:
        raise ValueError("最小二乘斜率应为正，请核对环号与左右读数的对应关系")
    fitted_radius = fit.slope / LAMBDA

    # 逐差法（skip-5）：高环号组 (idx 0~4) 对应低环号组 (idx 5~9)。
    diffs = [D_m2[i] - D_m2[i + SKIP_N] for i in range(5)]
    bad_diff = [round(x, 4) for x in diffs if x <= 0]
    if bad_diff:
        print(f"[错误] 逐差 D²_m − D²_n 出现非正值 {bad_diff}："
              "较大暗环的直径必须大于较小暗环，请检查 d_left / d_right 的配对。")
        return None
    avg_diff = mean(diffs)
    std_diff = std_dev(diffs)

    # 每组差对应的曲率半径
    R_individual = [d / (4 * SKIP_N * LAMBDA) for d in diffs]

    # ── 3σ 坏值检验 ──
    # 5 个逐差结果 R_i 是同一被测量 R 的等精度重复测定，检验并迭代剔除坏值后
    # 再用保留数据重算平均值、标准差与不确定度（样本数据无坏值时结果不变）。
    ot = outlier_test(R_individual)
    R_kept = ot["kept"]
    n_pairs = ot["n_kept"]
    s_R = std_dev(R_kept)
    sigma_R = ot["sigma"]                       # σ = s × t_{0.683}(n)
    sigma3_R = ot["sigma3"]                     # 3σ 检验判据
    t_used = t_factor(n_pairs)   # n=5 用教材值 1.14
    R_bar = mean(R_kept)
    sum_sq_R = sum((x - R_bar) ** 2 for x in R_kept)

    # Type A：5 个 R_i 的标准误
    u_A = t_used * s_R / math.sqrt(n_pairs) if n_pairs > 1 else 0.0

    # Type B：由仪器误差传播
    # 每个位置读数：u(x) = Δ_仪 / √3
    # 直径 D = |x_R - x_L| → u(D) = √2 · u(x)
    # D² 的相对不确定度：u_rel(D²) ≈ 2 · u(D) / D
    # D²_m - D²_n：相对不确定度 ≈ √2 · u_rel(D²)
    u_pos = DELTA_INSTRUMENT / math.sqrt(3)
    avg_D = mean(D_m)
    u_D = math.sqrt(2) * u_pos
    u_rel_D2 = 2 * u_D / avg_D
    u_rel_diff = math.sqrt(2) * u_rel_D2
    u_B = u_rel_diff * R_bar

    # 合成不确定度
    u_c = combine(u_A, u_B)

    return {
        "rings": rings, "d_left": d_left, "d_right": d_right,
        "D_m": D_m, "D_m2": D_m2,
        "radius_squared": radius_squared, "fit_slope": fit.slope,
        "fit_intercept": fit.intercept, "fit_r_squared": fit.r_squared,
        "fitted_radius": fitted_radius,
        "diffs": diffs, "avg_diff": avg_diff, "std_diff": std_diff,
        "R_individual": R_individual, "R_kept": R_kept, "R_bar": R_bar,
        "ot": ot, "n_pairs": n_pairs, "s_R": s_R, "sum_sq_R": sum_sq_R,
        "sigma_R": sigma_R, "sigma3_R": sigma3_R, "t_used": t_used,
        "avg_D": avg_D, "u_A": u_A, "u_B": u_B, "u_c": u_c,
        "rel_u": u_c / R_bar * 100,
    }


def _generate_docx(data: dict, output_path: str):
    """从 data.json 读取数据，计算并生成 Word 实验报告。"""
    bind_input_parameters(data, globals(), SCRIPT_DIR)
    global LAMBDA
    wavelength = data.get("wavelength_nm")
    if isinstance(wavelength, bool) or not isinstance(wavelength, (int, float)) or not math.isfinite(wavelength) or wavelength <= 0:
        raise ValueError("光源波长 λ：请填写有限正数（nm）")
    LAMBDA = wavelength * 1e-6

    # ═══════════════════════════════════════════════
    # 1. 读取数据（含空值校验）
    # ═══════════════════════════════════════════════
    # 校验必填数据（required 字段为 null 或 array 含 null → 缺失）
    missing = []
    for k in ("rings", "d_left", "d_right"):
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

    # ═══════════════════════════════════════════════
    # 2. 数据处理：直径、逐差与不确定度（见 _compute）
    # ═══════════════════════════════════════════════
    r = _compute(data)
    if r is None:
        return
    R_bar = r["R_bar"]
    u_A = r["u_A"]
    u_B = r["u_B"]
    u_c = r["u_c"]
    avg_diff = r["avg_diff"]
    avg_D = r["avg_D"]
    s_R = r["s_R"]
    sum_sq_R = r["sum_sq_R"]
    sigma_R = r["sigma_R"]
    sigma3_R = r["sigma3_R"]
    t_used = r["t_used"]
    n_pairs = r["n_pairs"]

    # ═══════════════════════════════════════════════
    # 5. 生成 docx 报告
    # ═══════════════════════════════════════════════
    doc = DocxReportWriter(output_path)

    # ── 零、实验标题 ──
    doc.add_title("平凸透镜曲率半径的测量")
    doc.add_student_info()

    # ── 变体组合：实验原理 / 实验方法（存在 variants.json 且应用传入选择时生效）──
    variants = compose(SCRIPT_DIR, r)
    if "实验原理" in variants:
        doc.add_heading("实验原理", level=1)
        doc.add_paragraph_rich(variants["实验原理"])
    if "实验方法" in variants:
        doc.add_heading("实验方法", level=1)
        doc.add_paragraph_rich(variants["实验方法"])

    # ── 一、原始数据提交（拍照上传） ──
    doc.add_heading("一、原始数据提交（拍照上传）", level=1)
    doc.add_data_photo("请在下方粘贴原始数据记录照片。")

    # ── 二、数据处理 ──
    doc.add_heading("二、数据处理", level=1)
    doc.add_table(
        ["环号", "左读数 / mm", "右读数 / mm", "直径 / mm", "半径 / mm", "半径平方 / mm²"],
        [[str(n), format_number(left), format_number(right), format_number(diameter),
          format_number(diameter / 2), format_number(radius2)]
         for n, left, right, diameter, radius2 in zip(
             r["rings"], r["d_left"], r["d_right"], r["D_m"], r["radius_squared"])],
    )
    doc.add_heading("1. 作图与最小二乘拟合", level=2)
    doc.add_paragraph("按记录表将直径换算为半径，以环号 n 为横轴、半径平方为纵轴。用最小二乘法验证斜率，拟合允许截距以吸收中心位置偏移等影响。")
    doc.add_math(r"r_n^2 = (n-1)R\lambda,\quad r_n^2 = kn+b,\quad R_{\mathrm{fit}} = \frac{k}{\lambda}")
    doc.add_paragraph(
        f"拟合斜率 k = {format_number(r['fit_slope'])} mm²，截距 b = "
        f"{format_number(r['fit_intercept'])} mm²，决定系数为 {format_number(r['fit_r_squared'])}。"
    )
    doc.add_math(r"R_{\mathrm{fit}} \approx " + format_number(r["fitted_radius"]) + r"\,\mathrm{mm}")
    with TemporaryDirectory(prefix="newton-rings-") as directory:
        image = plot_fit(
            r["rings"], r["radius_squared"], r["fit_slope"], r["fit_intercept"],
            xlabel=r"Ring number $n$", ylabel=r"$r_n^2$ (mm$^2$)",
            save_path=os.path.join(directory, "newton-rings-fit.png"),
            data_label="Measured", fit_label="Least-squares fit",
        )
        doc.add_image(image, width_cm=14, caption="半径平方随环号变化及最小二乘拟合")
    doc.add_heading("2. 逐差法", level=2)

    doc.add_paragraph("")  # 段落容器
    doc.add_run("采用逐差法处理数据，取环距 ")
    doc.add_inline_math(f"m - n = {SKIP_N}")
    doc.add_run(f"，将环序 {r['rings'][0]}~{r['rings'][4]} 与 {r['rings'][5]}~{r['rings'][9]} 逐项配对，计算 ")
    doc.add_inline_math("D_m^2 - D_{m-5}^2")
    doc.add_run(f" 的 {len(r['diffs'])} 组差值。")
    doc.add_table(
        ["高环号", "低环号", "直径平方差 / mm²", "曲率半径 / mm"],
        [[str(high), str(low), format_number(diff), format_number(radius)]
         for high, low, diff, radius in zip(r["rings"], r["rings"][SKIP_N:], r["diffs"], r["R_individual"])],
    )
    doc.add_paragraph("五组逐差结果的初算平均值：")
    doc.add_math(
        r"\bar{R} = \frac{\overline{D_{m}^{2} - D_{m-5}^{2}}}{4 \cdot 5 \cdot \lambda} = "
        r"\frac{" + format_number(avg_diff, sig_figs=7) + r"}"
        r"{4 \times 5 \times " + format_number(LAMBDA * 1e6, sig_figs=8) + r" \times 10^{-6}}"
        r" \approx " + format_number(mean(r["R_individual"]), sig_figs=6) + r"\,\mathrm{mm}"
    )

    # 3σ 坏值检验：5 个逐差结果 R_i 是同一被测量 R 的等精度重复测定
    doc.add_paragraph("")
    doc.add_run(f"{r['ot']['n_all']} 个逐差结果 ")
    doc.add_inline_math("R_i")
    doc.add_run(" 是同一被测量 R 的等精度重复测定，作 3σ 坏值检验：")
    doc.add_paragraph(outlier_note(r["ot"], unit=" mm", digits=3))
    doc.add_paragraph(f"以下用保留的 {n_pairs} 组读数计算平均值和不确定度。")
    doc.add_math(
        r"s_{R} = \sqrt{\frac{\sum_{i=1}^{" + str(n_pairs)
        + r"} (R_i - \bar{R})^{2}}{" + str(n_pairs - 1) + r"}} = "
        r"\sqrt{\frac{" + format_number(sum_sq_R, sig_figs=6) + r"}{"
        + str(n_pairs - 1) + r"}}"
        r" \approx " + format_number(s_R, sig_figs=3) + r"\,\mathrm{mm}"
    )
    doc.add_math(
        r"\sigma = s_{R} \times t_{0.683} = "
        + format_number(s_R, sig_figs=3) + r" \times " + format_number(t_used, sig_figs=3)
        + r" \approx " + format_number(sigma_R, sig_figs=3) + r"\,\mathrm{mm}"
    )
    doc.add_math(
        r"3\sigma = 3 \times " + format_number(sigma_R, sig_figs=3)
        + r" \approx " + format_number(sigma3_R, sig_figs=3) + r"\,\mathrm{mm}"
    )

    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        r"\Delta R_{A} = t \cdot \frac{s_{R}}{\sqrt{n}} = "
        + format_number(t_used, sig_figs=3) + r" \times \frac{"
        + format_number(s_R, sig_figs=3) + r"}{\sqrt{" + str(n_pairs) + r"}}"
        r" \approx " + format_number(u_A, sig_figs=3) + r"\,\mathrm{mm}"
    )

    doc.add_paragraph("")
    doc.add_run("B 类不确定度由读数误差 ")
    doc.add_inline_math(r"u(x) = \frac{\Delta_{\text{仪}}}{\sqrt{3}}")
    doc.add_run(" 经直径 D、D² 及其逐差逐级传播得到：")
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"u(x) = \frac{\Delta_{\text{仪}}}{\sqrt{3}} = "
        r"\frac{" + format_number(DELTA_INSTRUMENT, sig_figs=6) + r"}{\sqrt{3}} \approx " + format_number(DELTA_INSTRUMENT / math.sqrt(3), sig_figs=6) + r"\,\mathrm{mm}"
    )
    doc.add_math(
        r"\Delta R_{B} = \frac{4 u(x) \bar{R}}{\bar{D}} = "
        r"\frac{4 \times " + format_number(DELTA_INSTRUMENT / math.sqrt(3), sig_figs=6) + r" \times " + format_number(R_bar, sig_figs=6) + r"}"
        r"{" + format_number(avg_D, sig_figs=5) + r"}"
        r" \approx " + format_number(u_B, sig_figs=3) + r"\,\mathrm{mm}"
    )

    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        r"\Delta R = \sqrt{\Delta R_{A}^{2} + \Delta R_{B}^{2}} = "
        r"\sqrt{" + format_number(u_A, sig_figs=3) + r"^{2} + "
        + format_number(u_B, sig_figs=3) + r"^{2}}"
        r" \approx " + format_number(u_c, sig_figs=3) + r"\,\mathrm{mm}"
    )

    doc.add_paragraph("曲率半径测量结果：")
    R_display = format_number(R_bar, u_c)
    u_display = format_number(u_c, u_c)
    doc.add_math(
        r"R = \bar{R} \pm \Delta R = ("
        + R_display + r" \pm " + u_display + r")\,\mathrm{mm}"
    )
    doc.add_paragraph("其中不确定度按只进不舍保留 1 位有效数字，测得值末位与其对齐。")
    # 自定义图追加在「数据处理」末尾。
    render_custom_plot(doc, 1, width_cm=14)
    render_custom_plot(doc, 2, width_cm=14)
    render_custom_plot(doc, 3, width_cm=14)


    # ── 三、实验结果分析 ──
    doc.add_heading("三、实验结果分析", level=1)
    doc.add_table(
        ["计算方法", "曲率半径 / mm"],
        [["作图与最小二乘拟合", format_number(r["fitted_radius"])],
         ["逐差法", format_number(R_bar)]],
    )

    # 结果分析 AI 导入消费点：AI 润色导入的「结果分析」覆盖硬编码段落
    if "结果分析" in variants:
        doc.add_paragraph_rich(variants["结果分析"])
    doc.add_paragraph("")
    doc.add_run("本次测量曲率半径 ")
    doc.add_inline_math(f"R = {format_number(R_bar, u_c)} mm")
    doc.add_run("，合成不确定度 ")
    doc.add_inline_math(f"u_c \\approx {format_number(u_c, sig_figs=3)} mm")
    doc.add_run(f"，相对不确定度约为 {format_number(u_c / R_bar * 100, sig_figs=3)}%。")

    doc.add_paragraph("")
    doc.add_run("误差主要来源于以下几个方面：")
    doc.add_run("（1）A 类不确定度占主导，来自 5 组逐差结果的统计涨落，")
    doc.add_run("反映在 R_i 的标准偏差较大（")
    doc.add_inline_math(f"u_A \\approx {format_number(u_A, sig_figs=3)} mm")
    doc.add_run("）；（2）B 类不确定度来自测量显微镜的仪器误差，")
    doc.add_run("贡献较小（")
    doc.add_inline_math(f"u_B \\approx {format_number(u_B, sig_figs=3)} mm")
    doc.add_run("）；（3）透镜与平板玻璃接触处的弹性形变和微量灰尘可能引入附加光程差，")
    doc.add_run("但采用逐差法后该系统误差已在 ")
    doc.add_inline_math("D_m^2")
    doc.add_run(" 差值中被消除；")
    doc.add_run("（4）测量过程中显微镜鼓轮未严格单方向旋转可能引入螺距差。")

    # ── 变体组合：误差分析 / 结论（存在 variants.json 且应用传入选择时生效）──
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=1)
        doc.add_paragraph_rich(variants["误差分析"])
    if "结论" in variants:
        doc.add_heading("结论", level=1)
        doc.add_paragraph_rich(variants["结论"])

    # ── 四、思考题 ──
    doc.add_heading("四、思考题", level=1)

    if not render_custom_quiz(doc, r):
        quiz = variants.get("思考题")
        answers = quiz if isinstance(quiz, dict) else {}
        doc.add_heading("1. 比较反射光与透射光形成的牛顿环", level=2)
        if answers.get("1"):
            doc.add_paragraph_rich(random.choice(answers["1"]))
        else:
            doc.add_paragraph("空气膜的薄膜几何条件相同。反射光的两束光在两界面反射时只有一次发生半波相变，而透射干涉的两束光相对经历两次反射，没有额外的半波相差。因此理想情况下，反射暗环对应透射亮环，反射亮环对应透射暗环。")
            doc.add_math(r"2t=k\lambda\quad(\text{透射亮、反射暗}),\qquad 2t=(k+\tfrac12)\lambda\quad(\text{透射暗、反射亮})")
            doc.add_paragraph("反射光的两束干涉光强较接近，条纹通常更清晰。透射光的直透分量较强，参与干涉的多次反射分量较弱，因此透射条纹的对比度通常较低。")

        doc.add_heading("2. 充入折射率大于 1 的透明液体后，环形、间距与级次如何变化？", level=2)
        if answers.get("2"):
            doc.add_paragraph_rich(random.choice(answers["2"]))
        else:
            doc.add_paragraph("设液体折射率为 n，真空波长为 λ，近轴空气膜几何关系改用液膜厚度 t。均匀液膜的等厚线仍是同心圆。对透射亮环取中心为第 1 环，按本实验讲义的级次约定：")
            doc.add_math(r"t\simeq\frac{r^2}{2R},\qquad 2nt=(k-1)\lambda,\qquad r_k=\sqrt{\frac{(k-1)R\lambda}{n}}")
            doc.add_paragraph("同一级亮环的半径及相邻环距均缩为原来的 1/√n。同一非中心半径所对应的干涉级次增大。")

    doc.save()
    doc.close()


def main():
    DATA_FILE = os.path.join(SCRIPT_DIR, "data.json")
    DOCX_FILE = os.path.join(SCRIPT_DIR, "平凸透镜曲率半径的测量.docx")

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
