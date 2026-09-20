# -*- coding: utf-8 -*-
"""Word 实物验收（可选，需要本机安装 Microsoft Word）：生成一份报告，
用 Word 打开并断言公式是原生公式、无线性残留、正文无 LaTeX 命令。

报告生成本身**不需要** Word；本脚本只用于人工/CI 在有 Word 的机器上做最终验收，
无 win32com 或 Word 时自动跳过（退出码 0），不影响 `npm run verify`。

用法：python tests/word_report_test.py [实验名]
"""
import glob
import importlib.util
import io
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "物理实验", "实验脚本")

try:
    import win32com.client
except ImportError:
    print("SKIP: 无 win32com（未安装 Word 环境），Word 实物验收未执行")
    sys.exit(0)


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    # 默认用「薄透镜焦距的测量（凸透镜）」——该实验原名「薄透镜焦距的测量」，
    # 改名后旧名已不存在，这里跟着更新（旧名会让测试直接 FAIL）。
    exp = sys.argv[1] if len(sys.argv) > 1 else "薄透镜焦距的测量（凸透镜）"
    start_ts = time.time()
    exp_dir = os.path.join(SCRIPTS, exp)
    if not os.path.isdir(exp_dir):
        print("FAIL: 找不到实验目录 %s" % exp)
        return 1

    r = subprocess.run([sys.executable, "-B", "-X", "utf8", "generate.py"], cwd=exp_dir,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("FAIL: 生成失败\n" + (r.stderr or "")[-400:])
        return 1
    # 取本次生成后最新的一份报告（generate.py 会覆盖同名文件，不能靠"新增文件"判定）
    candidate = [f for f in glob.glob(os.path.join(exp_dir, "*.docx"))
                 if not os.path.basename(f).startswith("~$") and ".~saving" not in f]
    if not candidate:
        print("FAIL: 未产出 docx")
        return 1
    report = max(candidate, key=os.path.getmtime)
    if os.path.getmtime(report) < start_ts - 1:
        print("FAIL: 报告未被本次生成更新（可能是旧文件）")
        return 1
    new = [report]
    print("报告：%s" % report)

    problems = []
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = False
    # 复制到临时目录再打开：避免锁定实验目录里的报告
    tmp = tempfile.mkdtemp(prefix="word_check_")
    tmp_report = os.path.join(tmp, os.path.basename(report))
    import shutil
    shutil.copy2(report, tmp_report)
    try:
        try:
            doc = word.Documents.Open(os.path.abspath(tmp_report), ReadOnly=True)
        except Exception as exc:
            print("FAIL: Word 无法打开文档（可能结构损坏）：%s" % exc)
            return 1
        try:
            n = doc.OMaths.Count
            residue = [i for i in range(1, n + 1) if "\\" in doc.OMaths(i).Range.Text]
            body = doc.Content.Text
            body_cmd = re.findall(r"\\[a-zA-Z]{2,}", body)
            print("公式对象数：%d" % n)
            print("线性残留公式：%d" % len(residue))
            print("正文 LaTeX 命令：%d %s" % (len(body_cmd), body_cmd[:5]))
            if n == 0:
                problems.append("Word 未识别出任何公式对象")
            if residue:
                problems.append("公式仍有线性残留（BuildUp 时代的失败特征）：索引 %s" % residue[:5])
            if body_cmd:
                problems.append("正文残留 LaTeX 命令：%s" % body_cmd[:5])
            # 版式越界：逐行取行尾水平位置（正文区右界 505pt；中文标点悬挂约 12pt）
            sel = word.Selection
            wide = []
            for i in range(1, doc.Paragraphs.Count + 1):
                r = doc.Paragraphs(i).Range
                if not r.Text.strip():
                    continue
                sel.SetRange(r.Start, r.Start)
                prev = -1
                for _ in range(40):
                    sel.EndOf(Unit=5, Extend=0)          # wdLine
                    end = sel.End
                    if end == prev or end >= r.End:
                        break
                    try:
                        x = float(sel.Information(5))     # 相对页面的水平位置
                    except Exception:
                        x = -1
                    if x > 518:
                        wide.append((i, round(x, 1)))
                    prev = end
                    sel.Collapse(0); sel.MoveRight(Unit=1, Count=1)
                    try:
                        if sel.Information(5) < 89:
                            break
                    except Exception:
                        break
            print("越界行（行尾 > 518pt）：%d %s" % (len(wide), wide[:5]))
            if wide:
                problems.append("有 %d 行超出正文区：%s" % (len(wide), wide[:5]))
        finally:
            doc.Close(False)
    finally:
        word.Quit()
        shutil.rmtree(tmp, ignore_errors=True)

    for f in new:
        try:
            os.remove(f)
        except Exception:
            pass

    if problems:
        for p in problems:
            print("FAIL:", p)
        return 1
    print("PASS: Word 实物验收通过（公式为原生公式、无残留）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
