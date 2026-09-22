# -*- coding: utf-8 -*-
"""自定义画图：运行 AI 生成的 matplotlib 代码，收集图片与图注。

由应用主进程以 `python -B -X utf8 - <代码文件> <输出目录> <数据文件>` 方式启动
（脚本源码经 stdin 注入），运行在隔离目录里，只收集输出目录下的图片。

AI 代码由用户显式启用「自定义画图」后生成，用户已知晓并同意在本机运行；
这里只负责准备运行环境、收集产物，不做任何额外的网络或系统访问。

约定（同时写进绘图 skill，告知 AI）：
- 图片保存到 OUT_DIR，命名 fig1.png、fig2.png…（顺序即报告插图顺序）
- 每张图调用 caption("fig1.png", "图1 ...") 或打印 "PLOT_CAPTION:<文件名><TAB><图注>"
- 只允许写 OUT_DIR 内部；禁止联网与系统调用

最后向 stdout 打印一行 ###PLOT_RESULT### + JSON，供应用解析。
"""

import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import traceback

RESULT_MARKER = "###PLOT_RESULT###"
MAX_IMAGES = 8
CAPTION_RE = re.compile(r"^PLOT_CAPTION:\s*([^\t]+?)\s*\t\s*(.*)$")


def _argv():
    if len(sys.argv) < 4:
        print("用法：python - <代码文件> <输出目录> <数据文件>", file=sys.stderr)
        raise SystemExit(2)
    return sys.argv[1], sys.argv[2], sys.argv[3]


def _natural_key(name):
    """fig2.png 排在 fig10.png 之前。"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _setup_matplotlib():
    import matplotlib
    matplotlib.use("Agg")                       # 无显示环境，必须在 pyplot 之前
    import matplotlib.pyplot as plt
    plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    return plt


def _load_script(code_file, namespace):
    """按模块方式加载 AI 代码（等价于直接运行该脚本文件）。"""
    spec = importlib.util.spec_from_file_location("ai_plot", code_file)
    if spec is None or spec.loader is None:
        raise ImportError("无法加载绘图代码：%s" % code_file)
    module = importlib.util.module_from_spec(spec)
    for key, value in namespace.items():
        setattr(module, key, value)
    sys.modules["ai_plot"] = module
    spec.loader.exec_module(module)
    return module


def main():
    code_file, out_dir, data_file = _argv()
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    try:
        with open(data_file, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}

    plt = _setup_matplotlib()

    def save(fig, name, dpi=150):
        """把图保存到 OUT_DIR（自动补 .png 后缀）。"""
        target = os.path.join(out_dir, name if str(name).lower().endswith(".png") else str(name) + ".png")
        fig.savefig(target, dpi=dpi, bbox_inches="tight", facecolor="white")
        return target

    def caption(name, text):
        """登记某张图的图注（图注可用 $...$ 写公式）。"""
        print("PLOT_CAPTION:%s\t%s" % (name, text))

    namespace = {
        "DATA": data,
        "DATA_FILE": data_file,
        "OUT_DIR": out_dir,
        "plt": plt,
        "save": save,
        "caption": caption,
    }

    buf = io.StringIO()
    failure = None
    try:
        with contextlib.redirect_stdout(buf):
            _load_script(code_file, namespace)
    except BaseException as exc:                  # 语法/运行/中断都要回报给应用
        failure = "%s: %s" % (type(exc).__name__, exc)

    printed = buf.getvalue()
    if printed:
        sys.stdout.write(printed)

    captions = {}
    for line in printed.splitlines():
        m = CAPTION_RE.match(line.strip())
        if m:
            captions[m.group(1)] = m.group(2).strip()

    images = []
    if not failure:
        names = [n for n in os.listdir(out_dir)
                 if n.lower().endswith((".png", ".jpg", ".jpeg"))
                 and os.path.isfile(os.path.join(out_dir, n))]
        names.sort(key=_natural_key)
        for name in names[:MAX_IMAGES]:
            images.append({
                "path": os.path.join(out_dir, name),
                "caption": captions.get(name, ""),
            })

    result = {"ok": failure is None, "images": images}
    if failure:
        result["error"] = failure
        tail = traceback.format_exc()[-1500:]
        result["traceback"] = tail
        print(tail, file=sys.stderr)
    print(RESULT_MARKER + json.dumps(result, ensure_ascii=False))
    return 0 if failure is None else 1


if __name__ == "__main__":
    sys.exit(main())
