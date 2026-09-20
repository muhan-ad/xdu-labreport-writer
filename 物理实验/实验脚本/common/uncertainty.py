"""不确定度计算：A类、B类、合成、传递。"""

import math


def mean(data: list[float]) -> float:
    """算术平均值。"""
    if not data:
        raise ValueError("data 不能为空")
    return sum(data) / len(data)


def std_dev(data: list[float], ddof: int = 1) -> float:
    """样本标准差 (ddof=1) 或总体标准差 (ddof=0)。"""
    n = len(data)
    if n < 2:
        return 0.0
    avg = mean(data)
    return math.sqrt(sum((x - avg) ** 2 for x in data) / (n - ddof))


# t_{0.683} 因子表（教材表 2-2-1，置信概率 P=0.683）。
# 教材 :333 正文「n = 6 是拐点，当 n > 6 时，t 的变化小而缓慢，可取 σ ≈ s」，
# 例题（:403，n=15）也是「测量次数大于 6 次，t 分布因子取 1」；
# 各实验知识库口径一致：薄透镜（凸）「n=8>6，则 t 分布因子取 1」，
# 声速（水中）「n=5 查表知 t=1.14」（说明 n ≤ 6 仍查表）。
# 故：n > 6 取 1，n ≤ 6 取表值。（曾误用表值 1.09/1.08 于 n=7/8，与上述口径不符。）
T_FACTOR_0683 = {2: 1.84, 3: 1.32, 4: 1.20, 5: 1.14, 6: 1.11, 7: 1.09, 8: 1.08}


def t_factor(n: int) -> float:
    """t_{0.683} 因子：n > 6 取 1（σ ≈ s），n ≤ 6 取表值。"""
    if n > 6:
        return 1.0
    return T_FACTOR_0683.get(n, 1.0)


def type_a(data: list[float]) -> float:
    """A类不确定度：平均值的标准差 σ_x̄ = t·s/√n（t 按 t_{0.683} 因子表取值）。

    教材：不确定度的 A 类评定就用 σ_x̄ 表示，即 ΔX_A = σ_x̄ = t·s(x_i)/√n。
    """
    n = len(data)
    if n < 2:
        return 0.0
    return t_factor(n) * std_dev(data) / math.sqrt(n)


def type_b(instrument_error: float, distribution: str = "uniform") -> float:
    """B类不确定度。

    distribution:
        'uniform' → C = sqrt(3)  (默认，均匀分布)
        'normal'  → C = 3        (正态分布，置信概率99.73%)
        'triangular' → C = sqrt(6)
    """
    c_map = {"uniform": math.sqrt(3), "normal": 3.0, "triangular": math.sqrt(6)}
    c = c_map.get(distribution)
    if c is None:
        raise ValueError(f"未知分布类型: {distribution}")
    return instrument_error / c


def combine(*uncertainties: float) -> float:
    """合成不确定度：sqrt(sum(u_i^2))。"""
    return math.sqrt(sum(u * u for u in uncertainties))


def outlier_test(data: list[float], max_rounds: int = 10) -> dict:
    r"""3σ 准则（拉依达准则）坏值检验 —— **迭代剔除**，返回检验结论。

    教材口径（物理实验/rag/total.md:373-410）：
    「求出 x̄ 和 σ，作出区间 x̄±3σ，则测量列中数据不在此区间内的值都是坏值，应剔除掉」；
    σ 用「测量列的标准差 × t 分布因子」（:403），判据 |x_i − x̄| ≥ 3σ（:405，含等号）；
    剔除后**重新计算 x̄、σ、3σ 再检验**（:407「经检查，再无坏值」），故这里迭代到无坏值为止。

    返回 dict：
        kept       剔除后保留的数据（原顺序）
        bad        被剔除的 [(原序号 1-based, 数值), ...]（按剔除先后）
        n_all/n_kept
        mean/std   剔除后保留数据的平均值与标准差
        sigma      剔除后的 σ = s × t(n_kept)
        sigma3     3σ（检验判据）
        rounds     迭代轮数（0 表示一次就通过）
    """
    kept = [(i + 1, float(x)) for i, x in enumerate(data)]
    bad = []
    rounds = 0
    while len(kept) >= 3 and rounds < max_rounds:
        vals = [x for _, x in kept]
        avg = mean(vals)
        s = std_dev(vals)
        sigma = s * t_factor(len(vals))
        s3 = 3 * sigma
        # 判据用 >= （教材 :405 为 ⩾）；同时要求确实偏离，避免 s=0 时把全体剔除
        out = [(idx, x) for idx, x in kept if abs(x - avg) >= s3 and abs(x - avg) > 0]
        if not out:
            break
        rounds += 1
        out_ids = {idx for idx, _ in out}
        bad.extend(out)
        kept = [(idx, x) for idx, x in kept if idx not in out_ids]

    vals = [x for _, x in kept]
    avg = mean(vals) if vals else 0.0
    s = std_dev(vals) if len(vals) > 1 else 0.0
    sigma = s * t_factor(len(vals)) if vals else 0.0
    return {
        "kept": vals,
        "bad": bad,
        "n_all": len(data),
        "n_kept": len(vals),
        "mean": avg,
        "std": s,
        "sigma": sigma,
        "sigma3": 3 * sigma,
        "rounds": rounds,
    }


def outlier_note(res: dict, unit: str = "", digits: int = 3, symbol: str = "σ",
                 scale: float = 1.0) -> str:
    """把 outlier_test 的结果写成报告里的一句话（措辞全局统一）。

    symbol：判据符号，默认 σ；个别实验用 δ 表示同一含义（角度量）时可传入保持一致。
    scale ：显示前的换算系数（如角度实验把度换算成分时传 60）。
    """
    if not res["bad"]:
        return "经 3%s 检验，各偏差均小于 3%s，无坏值。" % (symbol, symbol)
    seq = "、".join("第 %d 次" % i for i, _ in res["bad"])
    txt = ("经 3%s 检验，%s测量偏差超过 3%s，为坏值，已剔除；剔除后重新计算："
           "n = %d，%s = %.*f%s。" % (symbol, seq, symbol, res["n_kept"], symbol,
                                      digits, res["sigma"] * scale, unit))
    if res["rounds"] > 1:
        txt += "复检后无坏值。"
    return txt


def propagate_numeric(func, params: dict) -> tuple[float, float]:
    """数值法不确定度传递。

    对 func(**params) 在每个参数上做有限差分求偏导，
    返回 (函数值, 合成不确定度)。

    params 格式: {'x': (value, uncertainty), 'y': (value, uncertainty), ...}

    示例:
        def f(x, y): return x * y
        val, u = propagate_numeric(f, {'x': (3.0, 0.1), 'y': (4.0, 0.2)})
    """
    param_names = list(params.keys())
    values = {k: v[0] for k, v in params.items()}
    uncertainties = {k: v[1] for k, v in params.items()}

    f0 = func(**values)

    variance = 0.0
    h = 1e-8  # 有限差分步长
    for name in param_names:
        v = values[name]
        h_actual = max(abs(v) * h, h)
        perturbed = dict(values)
        perturbed[name] = v + h_actual
        f_plus = func(**perturbed)
        perturbed[name] = v - h_actual
        f_minus = func(**perturbed)
        partial = (f_plus - f_minus) / (2 * h_actual)
        variance += (partial * uncertainties[name]) ** 2

    return f0, math.sqrt(variance)
