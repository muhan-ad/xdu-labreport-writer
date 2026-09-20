"""薄透镜焦距的测量（凸透镜） — 数据处理脚本。

仅覆盖凸透镜三种方法：自准法、物距像距法、共轭法。
数据处理（不确定度分析）仅针对自准法和物距像距法，共轭法只做原始数据展示。

凹透镜版本（自准法 / 物像法）见同级目录 实验脚本/薄透镜焦距的测量（凹透镜）/。
"""

import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))
from common import *
from common.docx_report import DocxReportWriter
from common.data_io import load_data
from common.variants import compose

# ── 物理常数与仪器参数（按教材） ──
DELTA_INSTRUMENT = 0.05  # cm, Δ_仪 = 0.5 × 0.1cm（光具座最小分度 0.1cm）

MIN_CONJ_ROWS = 3  # 共轭法至少测几次（少于这个数视为填得不够，不出报告）


# 逐项展开的上限：超过这个项数就改代入「求和值」。
# 根号/分式在 Word 里不能跨行拆分，8 项展开会让公式远超版心而顶出页面；
# 教材在求和处也是直接代入求和结果（如 √(Σ(x−x̄)²/(n−1)) = √(0.02879/7)）。
MAX_TERMS_INLINE = 5


def _sum_str(vals, prec: int) -> str:
    """把一串数值写成 LaTeX 加法式（「带入数据」那一步用）。

    项数超过 MAX_TERMS_INLINE 时给出求和值，避免公式过长越界。
    """
    vals = list(vals)
    if len(vals) > MAX_TERMS_INLINE:
        return f"{sum(vals):.{prec}f}"
    out = ""
    for i, v in enumerate(vals):
        mag = f"{abs(v):.{prec}f}"
        if i == 0:
            out = ("-" if v < 0 else "") + mag
        else:
            out += (" - " if v < 0 else " + ") + mag
    return out


# （方式三：_create_template 已移除，数据真相为 data.json）


def _read_conj(conjugate_raw, missing: list):
    """读取共轭法数据（data["conjugate"] 的定长矩阵，每行 [X₃, X₁, X₂]）。

    schema 把容器定死在 8 行，学生填几次算几次 —— 所以：
      整行全空 → 视为未使用的行，直接跳过（不算缺失）；
      只有部分格空 → 记入 missing（这才是真漏填）。
    返回 [(序号, X₃, X₁, X₂), ...]，序号是原始行号，从 1 起。
    """
    rows = []
    if not isinstance(conjugate_raw, list):
        return rows
    for i, raw in enumerate(conjugate_raw):
        idx = i + 1
        cells = list(raw)[:3] if isinstance(raw, list) else [raw]
        cells += [None] * (3 - len(cells))
        x3, x1, x2 = cells
        if x3 is None and x1 is None and x2 is None:
            continue  # 未使用的行
        for lbl, v in zip(("X₃", "X₁", "X₂"), (x3, x1, x2)):
            if v is None:
                missing.append(f"共轭法 第 {idx} 行「{lbl}」")
        if x3 is not None and x1 is not None and x2 is not None:
            rows.append((idx, float(x3), float(x1), float(x2)))
    return rows


def _compute(data: dict) -> dict:
    """数据处理：由原始数据计算三种方法的焦距与不确定度，返回数值字典。

    计算逻辑与原 _generate_docx 完全一致，仅抽出以便正文与变体章节
    （%%DATA:key:格式%% 占位符）共用同一份结果。
    """

    # ── 取出数据 ──
    f_auto_raw = data["f_auto"]       # 自准法：8 次 f 值
    u_raw = data["u"]                 # 物距像距法：物距 u
    v_raw = data["v"]                 # 物距像距法：8 次像距 v
    x0_raw = data["x0"]               # 共轭法：物屏位置 X0
    conjugate_raw = data["conjugate"] # 共轭法：定长 8 行，每行 [X3, X1, X2]

    # ── 类型转换 ──
    f_auto = [float(v) for v in f_auto_raw]
    u = float(u_raw)
    v_vals = [float(v) for v in v_raw]
    x0 = float(x0_raw)
    _conj = _read_conj(conjugate_raw, [])   # 已过必填校验，这里只取回非空行
    x3_vals = [r[1] for r in _conj]
    x1_vals = [r[2] for r in _conj]
    x2_vals = [r[3] for r in _conj]

    # ── 自准法 ──
    # 3σ 坏值检验（8 次等精度重复测量，迭代剔除）；之后一律用保留数据重算
    ot_auto = outlier_test(f_auto)
    auto_clean = ot_auto["kept"]
    n_auto_clean = ot_auto["n_kept"]
    auto_bad = [i - 1 for i, _ in ot_auto["bad"]]      # 兼容旧字段：被剔除值的下标（0 起）
    f_auto_bar = mean(auto_clean)
    s_auto = ot_auto["std"]                            # 保留数据的标准差
    sigma_auto = ot_auto["sigma"]                      # σ = s × t_{0.683}(n)

    uA_auto = type_a(auto_clean)
    uB_auto = type_b(DELTA_INSTRUMENT)
    u_auto = combine(uA_auto, uB_auto)
    e_auto = u_auto / f_auto_bar * 100

    # ── 物距像距法 ──
    # 3σ 坏值检验（8 次等精度重复测量，迭代剔除）
    ot_v = outlier_test(v_vals)
    v_clean = ot_v["kept"]
    n_v_clean = ot_v["n_kept"]
    v_bad = [i - 1 for i, _ in ot_v["bad"]]
    v_bar = mean(v_clean)
    s_v = ot_v["std"]
    sigma_v = ot_v["sigma"]

    # 每个 v 对应的 f
    if u + v_bar == 0:
        print(f"[错误] 物距与像距平均值之和为零（u = {u:g} cm，v̄ = {v_bar:g} cm），"
              "无法计算物距像距法焦距，请检查 u / v 数据。")
        return None
    f_uv_vals = [u * vi / (u + vi) for vi in v_clean]
    f_uv_bar = mean(f_uv_vals)

    # Δv 不确定度
    uA_v = type_a(v_clean)
    uB_v = type_b(DELTA_INSTRUMENT)
    u_v = combine(uA_v, uB_v)

    # Δf 误差传播（u 为常数）
    u_f_uv = u ** 2 * u_v / (u + v_bar) ** 2
    e_uv = u_f_uv / f_uv_bar * 100

    # ── 共轭法（仅计算 D/d/f 用于展示） ──
    d_vals = []
    dd_vals = []
    f_conj_vals = []
    for i in range(len(x3_vals)):
        di = abs(x3_vals[i] - x0)
        ddi = abs(x2_vals[i] - x1_vals[i])
        fi = (di ** 2 - ddi ** 2) / (4 * di)
        d_vals.append(di)
        dd_vals.append(ddi)
        f_conj_vals.append(fi)

    # 结论引用量：共轭法平均焦距及与其他方法的差值
    f_conj_mean = mean(f_conj_vals)

    return {
        # 原始数据（转换后）
        "f_auto": f_auto, "u": u, "v_vals": v_vals, "x0": x0,
        "x3_vals": x3_vals, "x1_vals": x1_vals, "x2_vals": x2_vals,
        # 自准法
        "f_auto_bar": f_auto_bar, "s_auto": s_auto, "sigma_auto": sigma_auto,
        "auto_bad": auto_bad, "n_auto_clean": n_auto_clean,
        "uA_auto": uA_auto, "uB_auto": uB_auto, "u_auto": u_auto, "e_auto": e_auto,
        "ot_auto": ot_auto, "f_auto_clean": auto_clean,
        # 物距像距法
        "v_bar": v_bar, "s_v": s_v, "sigma_v": sigma_v, "v_bad": v_bad,
        "n_v_clean": n_v_clean, "f_uv_vals": f_uv_vals, "f_uv_bar": f_uv_bar,
        "ot_v": ot_v, "v_clean": v_clean,
        "uA_v": uA_v, "uB_v": uB_v, "u_v": u_v, "u_f_uv": u_f_uv, "e_uv": e_uv,
        # 共轭法
        "d_vals": d_vals, "dd_vals": dd_vals, "f_conj_vals": f_conj_vals,
        "f_conj_mean": f_conj_mean,
        # 方法间比较
        "diff_auto_conj": abs(f_auto_bar - f_conj_mean),
        "diff_uv_conj": abs(f_uv_bar - f_conj_mean),
    }


def _generate_docx(data: dict, output_path: str):
    """从 data.json 读取数据，计算并生成 Word 实验报告。"""

    # ═══════════════════════════════════════════
    # 1. 读取数据（含必填空值校验）
    # ═══════════════════════════════════════════

    # 校验必填数据（required 字段为 null，或 array/matrix 含 null → 缺失）
    def _flat(v):
        if isinstance(v, list) and v and isinstance(v[0], list):
            return [x for row in v for x in row]
        return v if isinstance(v, list) else [v]

    missing = []
    for k in ("f_auto", "u", "v", "x0"):
        v = data.get(k)
        if v is None:
            missing.append(k)
        elif isinstance(v, list) and any(x is None for x in _flat(v)):
            missing.append(k)
    # 共轭法走定长容器：整行空 = 未使用的行，只有部分空才算漏填
    conj = _read_conj(data.get("conjugate"), missing)
    if missing:
        print("以下必填数据未填写，请补齐后重新运行：")
        for m in missing:
            print(f"  - {m}")
        return
    if len(conj) < MIN_CONJ_ROWS:
        print(f"[错误] 共轭法至少需要 {MIN_CONJ_ROWS} 次测量（当前填了 {len(conj)} 次），请补齐后重新运行。")
        return

    # ═══════════════════════════════════════════
    # 2. 计算（抽出为 _compute，变体章节共用同一份结果）
    # ═══════════════════════════════════════════

    r = _compute(data)
    if r is None:
        return
    _UNPACK_KEYS = (
        "f_auto u v_vals x0 x3_vals x1_vals x2_vals "
        "f_auto_bar s_auto sigma_auto auto_bad n_auto_clean "
        "uA_auto uB_auto u_auto e_auto "
        "v_bar s_v sigma_v v_bad n_v_clean f_uv_vals f_uv_bar "
        "uA_v uB_v u_v u_f_uv e_uv "
        "d_vals dd_vals f_conj_vals"
    ).split()
    (f_auto, u, v_vals, x0, x3_vals, x1_vals, x2_vals,
     f_auto_bar, s_auto, sigma_auto, auto_bad, n_auto_clean,
     uA_auto, uB_auto, u_auto, e_auto,
     v_bar, s_v, sigma_v, v_bad, n_v_clean, f_uv_vals, f_uv_bar,
     uA_v, uB_v, u_v, u_f_uv, e_uv,
     d_vals, dd_vals, f_conj_vals) = (r[k] for k in _UNPACK_KEYS)
    ot_auto = r["ot_auto"]; ot_v = r["ot_v"]
    f_auto_clean = r["f_auto_clean"]; v_clean = r["v_clean"]

    variants = compose(SCRIPT_DIR, r)

    # ═══════════════════════════════════════════
    # 3. 生成 Word 报告
    # ═══════════════════════════════════════════

    doc = DocxReportWriter(output_path)

    # ── 标题 ──
    doc.add_title("薄透镜焦距的测量（凸透镜）")
    doc.add_student_info()

    # ── 变体章节：实验原理 / 实验方法（置于数据记录前） ──
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
    doc.add_data_photo("（请在此处粘贴原始数据记录照片）")

    # 1. 自准法
    doc.add_heading("1. 自准法测量凸透镜焦距", level=2)
    auto_headers = ["次数$n$"] + [str(i) for i in range(1, 9)]
    auto_row = ["$f$ / cm"] + [f"{v:.2f}" for v in f_auto]
    doc.add_table(auto_headers, [auto_row],
                  col_widths=[2.0] + [1.2] * 8)

    # 2. 物距像距法
    doc.add_heading("2. 物距像距法测量凸透镜焦距", level=2)
    doc.add_paragraph("")
    doc.add_run("物距 u = ")
    doc.add_inline_math(f"{u:.2f} \\text{{ cm}}")

    uv_headers = ["次数$n$"] + [str(i) for i in range(1, 9)]
    uv_v_row = ["像距 $v$ / cm"] + [f"{v:.2f}" for v in v_vals]
    uv_f_row = ["$f$ / cm"] + [f"{fv:.2f}" for fv in f_uv_vals]
    doc.add_table(uv_headers, [uv_v_row, uv_f_row],
                  col_widths=[2.0] + [1.2] * 8)

    # 3. 共轭法
    doc.add_heading("3. 共轭法测量凸透镜焦距", level=2)
    doc.add_paragraph("")
    doc.add_run("物屏位置 ")
    doc.add_inline_math(f"X_0 = {x0:.2f} \\text{{ cm}}")

    conj_headers = ["次数$n$", "$X_3$ / cm", "$X_1$ / cm", "$X_2$ / cm", "$D$ / cm", "$d$ / cm", "$f$ / cm"]
    conj_rows = []
    for i in range(len(x3_vals)):
        conj_rows.append([
            str(i + 1),
            f"{x3_vals[i]:.2f}",
            f"{x1_vals[i]:.2f}",
            f"{x2_vals[i]:.2f}",
            f"{d_vals[i]:.2f}",
            f"{dd_vals[i]:.2f}",
            f"{f_conj_vals[i]:.2f}",
        ])
    doc.add_table(conj_headers, conj_rows,
                  col_widths=[1.2, 1.8, 1.8, 1.8, 1.8, 1.8, 2.2])

    # ═══════════════════════════════════════════
    # 二、数据处理和误差分析
    # ═══════════════════════════════════════════
    doc.add_heading("二、数据处理和误差分析", level=1)

    # ── 2.1 自准法 ──
    doc.add_heading("1. 自准法测量凸透镜焦距", level=2)

    doc.add_paragraph("(1) 判断是否有坏值")
    doc.add_paragraph("计算焦距平均值：")
    doc.add_math(
        rf"\bar{{f}} = \frac{{1}}{{{n_auto_clean}}}\sum_{{i=1}}^{{{n_auto_clean}}} f_i"
        rf" = \frac{{{_sum_str(f_auto_clean, 2)}}}{{{n_auto_clean}}}"
        rf" \approx {f_auto_bar:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("计算标准差：")
    doc.add_math(
        rf"s = \sqrt{{\frac{{\sum_{{i=1}}^{{{n_auto_clean}}}(f_i - \bar{{f}})^2}}"
        rf"{{{n_auto_clean} - 1}}}}"
        rf" = \sqrt{{\frac{{{_sum_str([(x - f_auto_bar) ** 2 for x in f_auto_clean], 6)}}}"
        rf"{{{n_auto_clean - 1}}}}} \approx {s_auto:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("")
    doc.add_run("n = ")
    doc.add_inline_math(f"{n_auto_clean}")
    doc.add_run("，按教材 n > 6 时 σ ≈ s 取 t = ")
    doc.add_inline_math(f"{t_factor(n_auto_clean):g}")
    doc.add_run("，")
    doc.add_math(
        rf"\sigma = s \times t = {s_auto:.6f} \times {t_factor(n_auto_clean):g}"
        rf" \approx {sigma_auto:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("")
    doc.add_run("3σ 检验：")
    doc.add_inline_math(
        rf"3\sigma = 3 \times {sigma_auto:.6f} \approx {3 * sigma_auto:.3f} \mathrm{{cm}}"
    )
    doc.add_paragraph(outlier_note(ot_auto, unit=" cm", digits=3))

    doc.add_paragraph("(2) 不确定度的计算")
    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        rf"\Delta f_A = \frac{{\sigma}}{{\sqrt{{{n_auto_clean}}}}}"
        rf" = \frac{{{sigma_auto:.6f}}}{{\sqrt{{{n_auto_clean}}}}}"
        rf" \approx {uA_auto:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"\Delta_{\text{仪}} = 0.5 \times 0.1 = 0.05 \mathrm{cm}"
    )
    doc.add_math(
        rf"\Delta f_B = \frac{{\Delta_{{\text{{仪}}}}}}{{\sqrt{{3}}}}"
        rf" = \frac{{0.05}}{{\sqrt{{3}}}} \approx {uB_auto:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        rf"\Delta f = \sqrt{{(\Delta f_A)^2 + (\Delta f_B)^2}}"
        rf" = \sqrt{{{uA_auto:.6f}^2 + {uB_auto:.6f}^2}}"
        rf" \approx {u_auto:.2f} \mathrm{{cm}}"
    )

    doc.add_paragraph("(3) 结果表示")
    # format_number(值, 不确定度) 只把**数值**按不确定度末位对齐，不含 ± 项，
    # 所以这里要把不确定度本身也格式化出来（此前漏了，结果写成 (15.00) 而没有 ±）。
    f_auto_fmt = format_number(f_auto_bar, u_auto)
    u_auto_fmt = format_number(u_auto, u_auto)
    doc.add_math(
        rf"f = \bar{{f}} \pm \Delta f = ({f_auto_fmt} \pm {u_auto_fmt}) \mathrm{{cm}}"
    )
    doc.add_math(
        rf"E = \frac{{\Delta f}}{{\bar{{f}}}} \times 100\%"
        rf" = \frac{{{u_auto:.6f}}}{{{f_auto_bar:.5f}}} \times 100\%"
        rf" \approx {e_auto:.2f}\%"
    )

    # ── 2.2 物距像距法 ──
    doc.add_heading("2. 物距像距法测量凸透镜焦距", level=2)

    doc.add_paragraph("(1) 不确定度的计算")
    doc.add_paragraph("")
    doc.add_run("由透镜公式 ")
    doc.add_inline_math(r"f = \frac{uv}{u + v}")
    doc.add_run("，对 v 求偏导：")
    doc.add_math(r"\frac{\partial f}{\partial v} = \frac{u^2}{(u + v)^2}")
    doc.add_paragraph("")
    doc.add_run("故 ")
    doc.add_inline_math(r"\Delta f = \frac{u^2 \Delta v}{(u + v)^2}")
    doc.add_run("，需先求 ")
    doc.add_inline_math(r"\Delta v")
    doc.add_run("。")

    doc.add_paragraph("计算像距平均值：")
    doc.add_math(
        rf"\bar{{v}} = \frac{{1}}{{{n_v_clean}}}\sum_{{i=1}}^{{{n_v_clean}}} v_i"
        rf" = \frac{{{_sum_str(v_clean, 2)}}}{{{n_v_clean}}} \approx {v_bar:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("计算标准差：")
    doc.add_math(
        rf"s = \sqrt{{\frac{{\sum_{{i=1}}^{{{n_v_clean}}}(v_i - \bar{{v}})^2}}"
        rf"{{{n_v_clean} - 1}}}}"
        rf" = \sqrt{{\frac{{{_sum_str([(x - v_bar) ** 2 for x in v_clean], 6)}}}"
        rf"{{{n_v_clean - 1}}}}} \approx {s_v:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("")
    doc.add_run("n = ")
    doc.add_inline_math(f"{n_v_clean}")
    doc.add_run("，按教材 n > 6 时 σ ≈ s 取 t = ")
    doc.add_inline_math(f"{t_factor(n_v_clean):g}")
    doc.add_run("，")
    doc.add_math(
        rf"\sigma = s \times t = {s_v:.6f} \times {t_factor(n_v_clean):g}"
        rf" \approx {sigma_v:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("")
    doc.add_run("3σ 检验：")
    doc.add_inline_math(
        rf"3\sigma = 3 \times {sigma_v:.6f} \approx {3 * sigma_v:.3f} \mathrm{{cm}}"
    )
    doc.add_paragraph(outlier_note(ot_v, unit=" cm", digits=3))

    doc.add_paragraph("A类不确定度：")
    doc.add_math(
        rf"\Delta v_A = \frac{{\sigma}}{{\sqrt{{{n_v_clean}}}}}"
        rf" = \frac{{{sigma_v:.6f}}}{{\sqrt{{{n_v_clean}}}}}"
        rf" \approx {uA_v:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("B类不确定度：")
    doc.add_math(
        r"\Delta_{\text{仪}} = 0.5 \times 0.1 = 0.05 \mathrm{cm}"
    )
    doc.add_math(
        rf"\Delta v_B = \frac{{\Delta_{{\text{{仪}}}}}}{{\sqrt{{3}}}}"
        rf" = \frac{{0.05}}{{\sqrt{{3}}}} \approx {uB_v:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("合成不确定度：")
    doc.add_math(
        rf"\Delta v = \sqrt{{(\Delta v_A)^2 + (\Delta v_B)^2}}"
        rf" = \sqrt{{{uA_v:.6f}^2 + {uB_v:.6f}^2}}"
        rf" \approx {u_v:.2f} \mathrm{{cm}}"
    )

    doc.add_paragraph("(2) 求 Δf")
    doc.add_math(
        rf"\Delta f = \frac{{u^2 \Delta v}}{{(u + \bar{{v}})^2}}"
        rf" = \frac{{{u:.2f}^2 \times {u_v:.6f}}}{{({u:.2f} + {v_bar:.2f})^2}}"
        rf" \approx {u_f_uv:.2f} \mathrm{{cm}}"
    )
    doc.add_paragraph("焦距平均值：")
    doc.add_math(
        rf"\bar{{f}} = \frac{{1}}{{{len(f_uv_vals)}}}\sum_{{i=1}}^{{{len(f_uv_vals)}}} f_i"
        rf" = \frac{{{_sum_str(f_uv_vals, 5)}}}{{{len(f_uv_vals)}}}"
        rf" \approx {f_uv_bar:.2f} \mathrm{{cm}}"
    )

    doc.add_paragraph("(3) 结果表示")
    f_uv_fmt = format_number(f_uv_bar, u_f_uv)
    u_f_uv_fmt = format_number(u_f_uv, u_f_uv)
    doc.add_math(
        rf"f = \bar{{f}} \pm \Delta f = ({f_uv_fmt} \pm {u_f_uv_fmt}) \mathrm{{cm}}"
    )
    doc.add_math(
        rf"E = \frac{{\Delta f}}{{\bar{{f}}}} \times 100\%"
        rf" = \frac{{{u_f_uv:.6f}}}{{{f_uv_bar:.5f}}} \times 100\%"
        rf" \approx {e_uv:.2f}\%"
    )

    # ── 变体章节：误差分析（置于结果分析/思考题前） ──
    if "误差分析" in variants:
        doc.add_heading("误差分析", level=1)
        doc.add_paragraph_rich(variants["误差分析"])

    # ═══════════════════════════════════════════
    # 三、思考题和结果分析
    # ═══════════════════════════════════════════
    doc.add_heading("三、思考题和结果分析", level=1)

    # ── 思考题变体：题目写死；回答按问随机（dict）/ 整段润色覆盖（str）/ 硬编码兜底 ──
    import random
    _quiz = variants.get("思考题")
    if isinstance(_quiz, str) and _quiz.strip():
        doc.add_paragraph_rich(_quiz)
        _quiz = None
    elif not isinstance(_quiz, dict):
        _quiz = None

    # Q1
    doc.add_heading("1. 用物距像距法测凸透镜焦距时，证明当 u = 2f 时测量的相对不确定度误差最小。", level=2)
    _o = _quiz.get("1") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:

        doc.add_paragraph("对物距像距法公式求相对不确定度：")
        doc.add_math(r"\frac{\Delta f}{f} = \frac{\Delta u}{u} + \frac{\Delta v}{v}")
        doc.add_paragraph("")
        doc.add_run("由透镜公式 ")
        doc.add_inline_math(r"\frac{1}{f} = \frac{1}{u} + \frac{1}{v}")
        doc.add_run(" 得 ")
        doc.add_inline_math(r"v = \frac{uf}{u - f}")
        doc.add_run("，代入上式化简：")
        doc.add_math(r"\frac{\Delta f}{f} = \frac{\Delta u}{u} + \frac{\Delta u}{u - f}")
        doc.add_paragraph("")
        doc.add_run("令 ")
        doc.add_inline_math(r"x = u")
        doc.add_run("，则误差函数 ")
        doc.add_inline_math(r"E(x) = \frac{\Delta x}{x} + \frac{\Delta x}{x - f}")
        doc.add_run("。")
        doc.add_paragraph("对 x 求导并令导数为 0：")
        doc.add_math(r"\frac{dE}{dx} = -\frac{\Delta x}{x^2} + \frac{\Delta x}{(x - f)^2} = 0")
        doc.add_paragraph("解得：")
        doc.add_math(r"x = 2f")
        doc.add_paragraph("")
        doc.add_run("即 ")
        doc.add_inline_math(r"u = 2f")
        doc.add_run(" 时，相对不确定度最小。此时 ")
        doc.add_inline_math(r"u = v = 2f")
        doc.add_run("，物和像对称分布在透镜两侧。")

        # Q2
    doc.add_heading("2. 用共轭法测凸透镜焦距时，为什么必须使 D > 4f？", level=2)
    _o = _quiz.get("2") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:

        doc.add_paragraph("由透镜公式和共轭法几何关系：")
        doc.add_math(r"uv = fD")
        doc.add_math(r"u + v = D")
        doc.add_paragraph("联立解得：")
        doc.add_math(r"u, v = \frac{D \pm \sqrt{D^2 - 4fD}}{2}")
        doc.add_paragraph("")
        doc.add_run("要有两个不同的实解（即透镜可在两个位置成清晰实像），必须满足判别式大于零：")
        doc.add_math(r"D^2 - 4fD > 0")
        doc.add_paragraph("即：")
        doc.add_math(r"D > 4f")
        doc.add_paragraph("")
        doc.add_run("若 ")
        doc.add_inline_math(r"D \leq 4f")
        doc.add_run("，则透镜在物屏与像屏之间移动时最多只有一个位置能成清晰实像，无法完成共轭法测量。")

        # Q3
    doc.add_heading("3. 三种测量凸透镜焦距的方法中，试分析哪种方法更为精确。", level=2)
    _o = _quiz.get("3") if _quiz else None
    if _o:
        doc.add_paragraph_rich(random.choice(_o))
    else:


        doc.add_paragraph("(1) 物距像距法")
        doc.add_paragraph("")
        doc.add_run("原理：")
        doc.add_inline_math(r"f = \frac{uv}{u + v}")
        doc.add_run("。")
        doc.add_paragraph("误差来源：像距 v 的测量误差，且当 u 不等于 2f 时误差较大。需要同时测量物距和像距，透镜光心位置的估计会引入额外误差。")

        doc.add_paragraph("(2) 共轭法")
        doc.add_paragraph("")
        doc.add_run("原理：")
        doc.add_inline_math(r"f = \frac{D^2 - d^2}{4D}")
        doc.add_run("。")
        doc.add_paragraph("误差来源：d（两次成像透镜位移）的测量误差。但 D > 4f 时误差较小，且该方法把焦距的测量归结为对可以精确测量的量 D 和 d 的测量，避免了测量 u 和 v 时由于估计透镜光心位置不准带来的误差。")

        doc.add_paragraph("(3) 自准法")
        doc.add_paragraph("原理：当倒立实像与物等大倒立时，物屏到透镜的距离即为焦距。")
        doc.add_paragraph("误差来源：钢尺测量存在读数误差，平面镜是否严格垂直于光轴影响成像质量，清晰成像的判断也有一定主观误差。")

        doc.add_paragraph("结论：共轭法最为精确。该方法避免了透镜光心位置的估计误差，将焦距测量转化为物屏像屏间距 D 和透镜位移 d 的测量，这两个量均可在光具座上精确读取。")

        # ── 变体章节：结论（置于结果分析/思考题后） ──
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
