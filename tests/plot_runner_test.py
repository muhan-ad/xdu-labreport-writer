# -*- coding: utf-8 -*-
"""绘图运行器（src/main/plot-runner.py）协议测试。

运行器由应用以 `python -B -X utf8 - <代码文件> <输出目录> <数据文件>` 启动
（源码经 stdin 注入）。这里验证四种情形：
- 正常代码：出图并回报图注；
- 语法错误 / 运行错误：回报 ok=false 且带原因；
- 越界产物：输出目录之外的图片不被收集。
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNNER = os.path.join(ROOT, "src", "main", "plot-runner.py")
RESULT_MARKER = "###PLOT_RESULT###"


def safe_join(base, *parts):
    """拼接路径并校验仍在 base 目录内（禁止越界，安全审查要求显式校验）。"""
    root = os.path.realpath(base)
    p = os.path.realpath(os.path.join(root, *parts))
    if os.path.commonpath([p, root]) != root:
        raise ValueError("路径越界：%s" % p)
    return p


def write_fixture(text, folder, suffix):
    """在工作目录里落一个夹具文件（走临时文件 API，并校验结果路径仍在目录内）。"""
    handle = tempfile.NamedTemporaryFile("w", suffix=suffix, prefix="fixture_", dir=folder,
                                         delete=False, encoding="utf-8")
    try:
        handle.write(text)
    finally:
        handle.close()
    path = os.path.realpath(handle.name)
    if os.path.commonpath([path, os.path.realpath(folder)]) != os.path.realpath(folder):
        raise ValueError("路径越界：%s" % path)
    return path


def run_runner(code, work_dir, data=None, timeout=120):
    """按应用的方式跑运行器；返回 (proc, marker, out_dir)。"""
    work = os.path.realpath(work_dir)
    os.makedirs(work, exist_ok=True)
    out_dir = safe_join(work, "out")
    os.makedirs(out_dir, exist_ok=True)
    code_file = write_fixture(code, work, ".py")
    data_file = write_fixture(json.dumps(data or {"sample": 1}, ensure_ascii=False), work, ".json")
    with open(RUNNER, encoding="utf-8") as f:
        runner_src = f.read()
    proc = subprocess.run(
        [sys.executable, "-B", "-X", "utf8", "-", code_file, out_dir, data_file],
        input=runner_src, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    marker = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith(RESULT_MARKER):
            marker = json.loads(line[len(RESULT_MARKER):])
    return proc, marker, out_dir


GOOD_CODE = (
    "import numpy as np\n"
    "x = np.array([1.0, 2.0, 3.0]); y = 2 * x + 1\n"
    "fig, ax = plt.subplots()\n"
    "ax.plot(x, y, 'o-')\n"
    "ax.set_title('中文标题')\n"
    "save(fig, 'fig1.png')\n"
    "caption('fig1.png', '图1 测试曲线')\n"
)


def main():
    problems = []
    work = tempfile.mkdtemp(prefix="plot_runner_")

    proc, marker, _ = run_runner(GOOD_CODE, safe_join(work, "case_ok"))
    if not marker or not marker.get("ok"):
        problems.append("正常代码应成功，实得 %s（stderr 尾部：%s）"
                        % (marker, (proc.stderr or "")[-200:]))
    elif len(marker.get("images") or []) != 1:
        problems.append("应收集 1 张图，实得 %s" % marker.get("images"))
    elif marker["images"][0]["caption"] != "图1 测试曲线":
        problems.append("图注解析错误：%s" % marker["images"][0])
    elif not os.path.exists(marker["images"][0]["path"]):
        problems.append("回报的图片不存在：%s" % marker["images"][0]["path"])

    _, marker, _ = run_runner("def broken(:\n", safe_join(work, "case_syntax"))
    if not marker or marker.get("ok") is not False:
        problems.append("语法错误应回报 ok=false，实得 %s" % marker)
    elif "SyntaxError" not in (marker.get("error") or ""):
        problems.append("语法错误信息缺 SyntaxError：%s" % marker.get("error"))

    _, marker, _ = run_runner("raise ValueError('跑飞了')\n", safe_join(work, "case_runtime"))
    if not marker or marker.get("ok") is not False or "跑飞了" not in (marker.get("error") or ""):
        problems.append("运行错误应回报 ok=false 且带原因，实得 %s" % marker)

    stray_work = safe_join(work, "case_stray")
    os.makedirs(stray_work, exist_ok=True)
    stray = safe_join(stray_work, "stray.png")
    code = ("from PIL import Image\n"
            "Image.new('RGB', (10, 10)).save(%r)\n"
            "fig, ax = plt.subplots()\n"
            "save(fig, 'fig1.png')\n" % stray)
    _, marker, _ = run_runner(code, stray_work)
    if not marker or not marker.get("ok"):
        problems.append("越界用例应成功出图，实得 %s" % marker)
    elif any(os.path.realpath(i["path"]) == os.path.realpath(stray) for i in marker["images"]):
        problems.append("收集了输出目录之外的图片：%s" % [i["path"] for i in marker["images"]])

    print("绘图运行器：正常 / 语法错误 / 运行错误 / 越界产物 4 个用例")
    if problems:
        print("\n验证失败：")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nPASS: 绘图运行器协议（出图、图注、错误回报、产物边界）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
