---
name: 科研绘图规范（matplotlib）
description: 自定义画图时注入的绘图规范：可用库、输出与图注约定、中文字体、常见坑与自检清单。
scope: plot
---

# 科研绘图规范（matplotlib）

本规范只在「自定义画图」时注入：你写的代码会在用户的电脑上运行，产出图片后替换实验报告里的内置插图。

## 一、运行环境（不要越界）

- 可用库：`matplotlib`、`numpy`、`scipy`、`pandas`、`PIL`（Pillow）与 Python 标准库。**没有 seaborn、statsmodels、sympy**。
- 必须无界面运行：开头 `import matplotlib` + `matplotlib.use("Agg")`，**禁止 `plt.show()`**。
- 禁止联网、禁止 `subprocess`/`os.system`/`socket`/`ctypes` 等系统与进程接口，禁止读写 `OUT_DIR` 以外的文件。
- 总运行时间控制在 60 秒内；图不要过大（`figsize` 不超过 (10, 7)，dpi 用默认 150）。

## 二、数据与输出约定

- 数据在全局变量 `DATA`（dict，本次实验的测量数据）与 `DATA_FILE`（同一份数据的 JSON 文件路径）里，**不要臆造数据**。
- 图片保存到全局变量 `OUT_DIR`：`save(fig, "fig1.png")`、`save(fig, "fig2.png")`……顺序就是报告里的插图顺序，最多 4 张。
- 每张图配一行图注：`caption("fig1.png", "图1 单缝衍射光强分布")`。图注里可以用 `$...$` 写公式。
- 只输出一个 ```python 代码块，不要解释文字。

## 三、中文与数学符号

- 中文字体已在运行环境里配置（SimHei / Microsoft YaHei），直接用中文标签即可；负号显示已修正。
- 物理量与单位用数学写法：`ax.set_xlabel("$U_{dx}$ / V")`、`ax.set_ylabel("$D$ / mm")`；变量下标用 `$U_{2}$`、`$\varepsilon_{x}$`。
- 单位不要塞进变量名里，写成 `变量 / 单位` 的形式（如 `$t$ / s`）。

## 四、风格（与报告排版一致）

- 尺寸：单图 `figsize=(8, 5.5)`；同图多系列时可 `(9, 6)`。
- 数据点用标记（`o`、`^`、`s`），拟合线用实线并给出图例；颜色区分度高（如 `#2c5f9e`、`#3f8f5b`、`#e07b39`），不要全用默认蓝。
- 打开网格 `ax.grid(True, alpha=0.3, linestyle="--")`，图例放在不压数据的位置（`loc="best"` 或显式指定）。
- 拟合要报结果：在图上标注斜率/相关系数，或在 `ax.legend()` 里带上 `$r=0.9999$`。
- 结束时 `fig.tight_layout()`；多子图用 `plt.subplots(n, 1, figsize=(9, 3.2*n))` 纵向排布，共用横轴时 `sharex=True`。

## 五、常见坑

- 忘记 `matplotlib.use("Agg")` → 无显示环境报错。
- 图例遮挡数据点 → 用 `loc="upper left"`/`"lower right"` 或 `bbox_to_anchor` 移到图外。
- 中文变成方框 → 说明字体名写错，用默认设置即可，不要自己 `font_manager.addfont`。
- 保存后才 `tight_layout()` → 白边过大；先 `tight_layout()` 再 `save`。
- 数据里有负值或 0 → 取对数前先过滤（`x[x > 0]`），避免 `log(0)` 警告。
- 数据点太少（少于 3 个）时不要做最小二乘拟合，直接连线或只画散点。

## 六、自检（写完代码在脑中过一遍）

1. 是否用了 `matplotlib.use("Agg")`，有没有 `plt.show()`？
2. 每张图是否都 `save(...)` 到 `OUT_DIR`，文件名是否是 `fig1.png`、`fig2.png`…？
3. 每张图是否有对应的 `caption(...)`？
4. 是否只用了允许的库？是否只写了 `OUT_DIR` 内的文件？
5. 轴标签是否写了变量与单位，中文是否可能变成方框？

> 本规范参考并改编自开源社区技能 `tvhahn/matplotlib-skill`（MIT）与 `k-dense-ai/scientific-agent-skills`（MIT）的绘图实践，并结合本应用的运行约定重写。
