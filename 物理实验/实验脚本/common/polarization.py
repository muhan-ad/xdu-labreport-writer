"""Second-semester polarization: measured power, harmonic fits and one polar chart.

theta=0 is the crossed-analyzer extinction reference. The 360-degree reading
is kept for the closure check, but not counted twice in the fit or statistics.
"""
import math
import numpy as np

ANGLES_DEG = list(range(0, 361, 15))
ALPHAS_DEG = (0, 30, 45)


def compute(data):
    rows = data.get('power_mw')
    if not isinstance(rows, list) or len(rows) != 25:
        raise ValueError('光功率表需要25行，对应0°～360°，间隔15°')
    for i, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != 3:
            raise ValueError(f'θ={ANGLES_DEG[i]}°需要α=0°、30°、45°三个读数')
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or v < 0 for v in row):
            raise ValueError(f'θ={ANGLES_DEG[i]}°光功率必须为非负有限数值，不能缺失')
    for key, label in [('wavelength_nm', '光源波长'), ('resolution_mw', '光功率计分辨力')]:
        value = data.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0):
            raise ValueError(label + '必须为有限正数；未记录时留空')
    matrix = np.asarray(rows, dtype=float)
    theta = np.deg2rad(ANGLES_DEG[:-1])
    design = np.column_stack([np.ones(24), np.cos(2*theta), np.sin(2*theta)])
    groups = []
    for col, alpha in enumerate(ALPHAS_DEG):
        y = matrix[:-1, col]
        if np.mean(y) <= 0:
            raise ValueError(f'α={alpha}°的平均光功率为零，无法分析；请检查光路及记录')
        a, b, c = np.linalg.lstsq(design, y, rcond=None)[0]
        residual = y - design @ np.array([a, b, c])
        amp = math.hypot(b, c)
        groups.append({'alpha_deg': alpha, 'values': matrix[:, col].tolist(),
                       'mean': float(np.mean(y)), 'minimum': float(np.min(y)), 'maximum': float(np.max(y)),
                       'A': float(a), 'B': float(b), 'C': float(c),
                       'modulation': float(amp/a), 'rmse': float(np.sqrt(np.mean(residual**2))),
                       'closure': float(matrix[-1, col]-matrix[0, col]),
                       'negative_fit': bool(a-amp < -1e-10)})
    return {'angles_deg': ANGLES_DEG[:], 'groups': groups, 'n_unique': 24, 'n_recorded': 25}


def plot(result, output_path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    fonts = {f.name for f in font_manager.fontManager.ttflist}
    font = next((f for f in ['Microsoft YaHei', 'SimHei', 'Noto Sans CJK SC'] if f in fonts), 'DejaVu Sans')
    with plt.rc_context({'font.family': font, 'axes.unicode_minus': False}):
        fig, ax = plt.subplots(figsize=(8, 8.5), subplot_kw={'projection': 'polar'})
        fig.subplots_adjust(top=0.88, bottom=0.19, left=0.1, right=0.9)
        theta = np.deg2rad(result['angles_deg'])
        dense = np.linspace(0, 2*np.pi, 721)
        for g, color in zip(result['groups'], ['#1976b9', '#de7b20', '#229663']):
            alpha = g['alpha_deg']
            ax.plot(theta, g['values'], color=color, marker='o', markersize=3, lw=1.3,
                    label=f'α={alpha}° 实测')
            a = np.deg2rad(alpha)
            # Shape comparison only: scale the ideal curve by the measured mean.
            ideal = g['A']*(1-np.cos(2*a)**2*np.cos(2*dense)-np.sin(2*a)*np.cos(2*a)*np.sin(2*dense))
            ax.plot(dense, ideal, color=color, lw=1, ls='--', alpha=0.7,
                    label=f'α={alpha}° 理论形状')
        ax.set_theta_zero_location('E')
        ax.set_theta_direction(1)
        ax.set_thetagrids(np.arange(0, 360, 30))
        ax.set_rlabel_position(22.5)
        upper = max(max(g['values']) for g in result['groups'])
        ax.set_ylim(0, max(upper, max(2*g['A'] for g in result['groups']))*1.08)
        ax.grid(alpha=0.5)
        ax.set_title('偏振光特性测量（第二学期）\n光功率 P / mW', pad=22, fontsize=13)
        ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.1), ncol=2, frameon=False, fontsize=9)
        fig.text(0.5, 0.025, '虚线按各组平均光功率缩放，仅比较形状；θ=0°为初始消光方向。', ha='center', fontsize=9)
        fig.savefig(output_path, dpi=180, bbox_inches='tight')
        plt.close(fig)


def summary(result):
    return '\n'.join(f"α={g['alpha_deg']}°：平均光功率{g['mean']:.6g} mW，"
                     f"最小值{g['minimum']:.6g} mW，最大值{g['maximum']:.6g} mW，"
                     f"拟合调制度{g['modulation']:.4f}，拟合残差均方根{g['rmse']:.6g} mW，"
                     f"闭合差P(360°)−P(0°)={g['closure']:.6g} mW。"
                     for g in result['groups'])
