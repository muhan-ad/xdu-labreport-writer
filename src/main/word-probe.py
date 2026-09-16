# -*- coding: utf-8 -*-
"""Word 环境与系统现场探测（诊断日志用）。只读：注册表查询/进程枚举/COM 冒烟。
任意单项失败输出 null/None 而不中断；整体以一行 JSON 输出到 stdout。"""
import ctypes
import io
import json
import locale
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def hr(root, path, value=""):
    """读注册表值；不存在/异常返回 None。"""
    import winreg
    try:
        k = winreg.OpenKey(root, path)
        try:
            v, _ = winreg.QueryValueEx(k, value)
            return v
        finally:
            winreg.CloseKey(k)
    except OSError:
        return None


def file_version(path):
    import win32api
    info = win32api.GetFileVersionInfo(path, "\\")
    ms, ls = info["FileVersionMS"], info["FileVersionLS"]
    return "%d.%d.%d.%d" % (ms >> 16, ms & 0xFFFF, ls >> 16, ls & 0xFFFF)


def pe_machine(path):
    with open(path, "rb") as f:
        head = f.read(4096)
    if head[:2] != b"MZ":
        return None
    lfanew = head[0x3C] | (head[0x3D] << 8) | (head[0x3E] << 16) | (head[0x3F] << 24)
    if head[lfanew:lfanew + 4] != b"PE\0\0":
        return None
    m = head[lfanew + 4:lfanew + 6]
    if len(m) != 2:
        return None
    machine = m[0] | (m[1] << 8)   # 小端
    return {0x014c: "32 位", 0x8664: "64 位"}.get(machine, hex(machine))


out = {}

# ── Word 注册表存在性（无需启动 Word）──
import winreg
out["installed"] = hr(winreg.HKEY_CLASSES_ROOT, r"Word.Application") is not None
out["curVer"] = hr(winreg.HKEY_CLASSES_ROOT, r"Word.Application", "CurVer")
out["clsidPresent"] = hr(winreg.HKEY_CLASSES_ROOT,
                         r"CLSID\{000209FF-0000-0000-C000-000000000046}") is not None
out["wpsInstalled"] = hr(winreg.HKEY_CLASSES_ROOT, r"WPS.Application") is not None

# ── WINWORD.EXE 路径 / 版本 / 位数 ──
winword = hr(winreg.HKEY_LOCAL_MACHINE,
             r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\winword.exe") \
    or hr(winreg.HKEY_LOCAL_MACHINE,
          r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\winword.exe")
out["exePath"] = winword
if winword:
    try:
        out["version"] = file_version(winword)
    except Exception:
        out["version"] = None
    try:
        out["bitness"] = pe_machine(winword)
    except Exception:
        out["bitness"] = None

# ── 运行中的 WINWORD 进程数（残留/占用线索）──
try:
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq WINWORD.EXE", "/FO", "CSV", "/NH"],
                       capture_output=True, encoding="mbcs", errors="replace", timeout=10)
    out["runningCount"] = sum(1 for ln in r.stdout.splitlines() if "WINWORD" in ln.upper())
except Exception:
    out["runningCount"] = None

# ── 本应用实例数（多开/文件锁冲突诊断）──
try:
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq 实验搭子.exe", "/FO", "CSV", "/NH"],
                       capture_output=True, encoding="mbcs", errors="replace", timeout=10)
    out["appProcessCount"] = sum(1 for ln in r.stdout.splitlines() if "实验搭子" in ln)
except Exception:
    out["appProcessCount"] = None

# ── COM 冒烟：与生成完全相同的路径（DispatchEx → Version → 立即 Quit）──
com = {"ok": False}
try:
    import win32com.client
    w = win32com.client.DispatchEx("Word.Application")
    w.Visible = False
    w.DisplayAlerts = False
    com["ok"] = True
    com["version"] = "%s (Build %s)" % (w.Version, w.Build)
    try:
        com["caption"] = str(getattr(w, "Caption", ""))[:40]
    except Exception:
        pass
    w.Quit()
except Exception as e:
    com["ok"] = False
    com["error"] = str(e)[:150]
out["com"] = com

# ── 系统：代码页 / 区域（GBK 管道乱码诊断）──
try:
    out["acp"] = ctypes.windll.kernel32.GetACP()
    out["lcid"] = hex(ctypes.windll.kernel32.GetUserDefaultLCID())
except Exception:
    out["acp"] = out["lcid"] = None
try:
    out["preferredEncoding"] = locale.getpreferredencoding(False)
except Exception:
    out["preferredEncoding"] = None

out["pythonVersion"] = sys.version.split()[0]

print("###DIAGNOSTIC_PROBE###" + json.dumps(out, ensure_ascii=False))