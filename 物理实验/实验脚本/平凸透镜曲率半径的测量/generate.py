"""牛顿环（平凸透镜曲率半径） — 数据处理脚本。"""

import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.variants import compose
from common.data_io import load_data

# ── 物理常数 ──
LAMBDA = 589.3e-6         # 钠光波长 (mm)，589.3 nm
DELTA_INSTRUMENT = 0.004   # 测量显微镜仪器误差 (mm)
SKIP_N = 5                 # 逐差法间隔
T_FACTOR = 1.14            # t 因子 (n=5, df=4, P=0.683) —— 教材表 2-2-1


# （方式三：_create_template 已移除，数据真相为 data.json）


def _compute(data: dict) -> dict:
    """由左右读数计算各暗环直径、逐差与不确定度，返回结果字典 r。"""
    rings = [int(v) for v in data["rings"]]          # 20, 19, ..., 11
    d_left = [float(v) for v in data["d_left"]]       # 左侧读数
    d_right = [float(v) for v in data["d_right"]]     # 右侧读数

    # 直径和直径平方
    D_m = [abs(d_right[i] - d_left[i]) for i in range(10)]
    D_m2 = [d ** 2 for d in D_m]

    # 逐差法（skip-5）：环 20~16 (idx 0~4) 对应 环 15~11 (idx 5~9)
    # 配对依赖"大环在前"的录入顺序，这里用 rings 显式校验，避免顺序颠倒时
    # 算出负的曲率半径并静默写进报告
    if any(rings[i] <= rings[i + 1] for i in range(len(rings) - 1)):
        print(f"[错误] 暗环序号必须从大到小排列（当前为 {rings}），"
              "请按 20→11 的顺序录入 d_left / d_right。")
        return None
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
    t_used = T_FACTOR if n_pairs == 5 else t_factor(n_pairs)   # n=5 用教材值 1.14
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
        "diffs": diffs, "avg_diff": avg_diff, "std_diff": std_diff,
        "R_individual": R_individual, "R_kept": R_kept, "R_bar": R_bar,
        "ot": ot, "n_pairs": n_pairs, "s_R": s_R, "sum_sq_R": sum_sq_R,
        "sigma_R": sigma_R, "sigma3_R": sigma3_R, "t_used": t_used,
        "avg_D": avg_D, "u_A": u_A, "u_B": u_B, "u_c": u_c,
        "rel_u": u_c / R_bar * 100,
    }


def _generate_docx(data: dict, output_path: str):
    """从 data.json 读取数据，计算并生成 Word 实验报告。"""

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

    doc.add_paragraph("")  # 段落容器
    doc.add_run("采用逐差法处理数据，取环距 ")
    doc.add_inline_math(f"m - n = {SKIP_N}")
    doc.add_run("，将环序 20~16 与 15~11 逐项配对，计算 ")
    doc.add_inline_math("D_m^2 - D_{m-5}^2")
    doc.add_run(f" 的 {len(r['diffs'])} 组差值。")
    doc.add_paragraph("曲率半径平均值：")
    doc.add_math(
        r"\bar{R} = \frac{\overline{D_{m}^{2} - D_{m-5}^{2}}}{4 \cdot 5 \cdot \lambda} = "
        r"\frac{" + format_number(avg_diff, sig_figs=7) + r"}"
        r"{4 \times 5 \times 589.3 \times 10^{-6}}"
        r" \approx " + format_number(R_bar, sig_figs=6) + r"\,\mathrm{mm}"
    )

    # 3σ 坏值检验：5 个逐差结果 R_i 是同一被测量 R 的等精度重复测定
    doc.add_paragraph("")
    doc.add_run(f"{r['ot']['n_all']} 个逐差结果 ")
    doc.add_inline_math("R_i")
    doc.add_run(" 是同一被测量 R 的等精度重复测定，作 3σ 坏值检验：")
    doc.add_math(
        r"s_{R} = \sqrt{\frac{\sum_{i=1}^{" + str(r["ot"]["n_all"])
        + r"} (R_i - \bar{R})^{2}}{" + str(r["ot"]["n_all"] - 1) + r"}} = "
        r"\sqrt{\frac{" + format_number(sum_sq_R, sig_figs=6) + r"}{"
        + str(r["ot"]["n_all"] - 1) + r"}}"
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
    doc.add_paragraph(outlier_note(r["ot"], unit=" mm", digits=3))

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
        r"\frac{0.004}{\sqrt{3}} \approx 0.0023\,\mathrm{mm}"
    )
    doc.add_math(
        r"\Delta R_{B} = \frac{4 u(x) \bar{R}}{\bar{D}} = "
        r"\frac{4 \times 0.0023 \times " + format_number(R_bar, sig_figs=6) + r"}"
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

    # ── 三、实验结果分析 ──
    doc.add_heading("三、实验结果分析", level=1)

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

    # ── 思考题变体：题目写死；回答按问随机（dict）/ 整段润色覆盖（str）/ 硬编码兜底 ──
    import random
    _quiz = variants.get("思考题")
    if isinstance(_quiz, str) and _quiz.strip():
        doc.add_paragraph_rich(_quiz)
        _quiz = None
    elif not isinstance(_quiz, dict):
        _quiz = None

    doc.add_heading("1. 牛顿环中心为何不是理想暗点？对 R 测量有无影响？", level=2)
    _o = _quiz.get("1") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:

        doc.add_paragraph(
            "答：实际实验中，平凸透镜和平面玻璃接触处存在弹性形变，"
            "导致接触处为一个小圆面而非理想点接触；此外镜面上可能有微量灰尘，"
            "引起附加光程差，使中心呈现或暗或明的圆斑。"
        )
        doc.add_paragraph("")
        doc.add_run("对 R 测量无影响。因为采用 ")
        doc.add_inline_math("D_m^2 - D_n^2")
        doc.add_run(" 的差值法处理数据时，附加厚度 a 在相减过程中被消除，不改变干涉条纹的级次差。")

    doc.add_heading("2. 说明牛顿环分布特点及干涉级次分布。", level=2)
    _o = _quiz.get("2") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:

        doc.add_paragraph("")
        doc.add_run("答：牛顿环中心为暗斑，周围交替分布明暗相间的同心圆环。")
        doc.add_run("环的分布特点是中央稀疏、边缘密集，呈内疏外密的不均匀排列。")
        doc.add_run("干涉级次分布：中央级次低（")
        doc.add_inline_math("m")
        doc.add_run(" 小），由内向外级次逐渐增大（")
        doc.add_inline_math("m")
        doc.add_run(" 增大），明环与暗环交替出现。")

    doc.add_heading("3. 牛顿环各环间距是否相等？根据以下原理进行解释。", level=2)
    _o = _quiz.get("3") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:

        doc.add_paragraph("")
        doc.add_run("测量原理：")
        doc.add_inline_math(r"R = \frac{D_m^2 - D_n^2}{4(m-n)\lambda}")
        doc.add_paragraph("")
        doc.add_run("答：不相等。空气膜厚度沿径向不均匀变化是根本原因。")
        doc.add_run("由几何关系 ")
        doc.add_inline_math("R^2 = (R-d)^2 + r^2")
        doc.add_run("，略去 d² 得 ")
        doc.add_inline_math(r"d = \frac{r^{2}}{2R}")
        doc.add_run("。")
        doc.add_paragraph("")
        doc.add_run("可见膜厚 ")
        doc.add_inline_math("d")
        doc.add_run(" 与 ")
        doc.add_inline_math("r^2")
        doc.add_run(" 成正比，即越远离中心，厚度增加越快，")
        doc.add_run("光程差变化越剧烈，导致相邻干涉环之间的间距越来越小，")
        doc.add_run("形成内疏外密的分布。")

        # ── 保存 ──
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
