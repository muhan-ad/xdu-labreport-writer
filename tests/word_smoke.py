"""Optional Windows/Word integration check; output goes only to the given test directory."""
import importlib.util
import os
from pathlib import Path
import sys
import json
import subprocess
import zipfile
import win32com.client
import win32api
import win32process
import win32event

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "word_report_under_test", root / "物理实验/实验脚本/common/docx_report.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
writer = None
guard = None
victim = None
try:
    writer = module.DocxReportWriter(str(output / "Word回归测试.docx"))
    assert writer._word_handle is not None, "Could not identify automation Word process"
    # Create a separate instance after generation starts, reproducing the former PID-difference bug.
    guard = win32com.client.DispatchEx("Word.Application")
    guard.Visible = False
    guard.DisplayAlerts = False
    guard.Documents.Add()
    guard.ActiveDocument.Content.Text = "independent Word sentinel"
    writer.add_title("应用回归验证")
    writer.add_paragraph("验证报告生成及独立 Word 实例保护。")
    writer.add_math("x=1+2")
    writer.close()
    assert "independent Word sentinel" in guard.ActiveDocument.Content.Text
    with zipfile.ZipFile(output / "Word回归测试.docx") as report:
        assert report.testzip() is None
        xml = report.read("word/document.xml").decode("utf8")
        assert "应用回归验证" in xml
        assert "oMath" in xml
    print("PASS: DOCX and native equation generated; independent Word document survived")
    if len(sys.argv) > 2:
        victim = win32com.client.DispatchEx("Word.Application")
        victim.Visible = False
        victim.DisplayAlerts = False
        victim.Documents.Add()
        hwnd = int(victim.ActiveWindow.Hwnd)
        pid = win32process.GetWindowThreadProcessId(hwnd)[1]
        guard_hwnd = int(guard.ActiveWindow.Hwnd)
        guard_pid = win32process.GetWindowThreadProcessId(guard_hwnd)[1]
        assert guard_pid != pid
        handle = win32api.OpenProcess(0x100000, False, pid)
        try:
            # A wrong PID/HWND pairing must not terminate the independent process.
            subprocess.run([sys.executable, '-B', '-c', sys.argv[2], json.dumps([[guard_pid, hwnd]])], check=True)
            assert "independent Word sentinel" in guard.ActiveDocument.Content.Text
            subprocess.run([sys.executable, '-B', '-c', sys.argv[2], json.dumps([[pid, hwnd]])], check=True)
            assert win32event.WaitForSingleObject(handle, 5000) == 0
            assert "independent Word sentinel" in guard.ActiveDocument.Content.Text
            print("PASS: cancellation terminates only the recorded Word instance; mismatched identity is ignored")
        finally:
            handle.Close()
finally:
    if writer is not None and not writer._closed:
        writer.close()
    if guard is not None:
        try:
            guard.Documents.Close(SaveChanges=0)
            guard.Quit()
        except Exception:
            pass
    if victim is not None:
        try:
            victim.Documents.Close(SaveChanges=0)
            victim.Quit()
        except Exception:
            pass
