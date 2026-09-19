# 把应用窗口摆到主屏工作区正中（演示用；最小化时先还原）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File center_window.ps1
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process electron -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) {
  $p = Get-Process -Name '实验搭子' -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
if (-not $p) { Write-Output 'no-window'; exit 1 }
$h = $p.MainWindowHandle
[Win32]::ShowWindow($h, 9) | Out-Null          # SW_RESTORE：最小化时先还原
Start-Sleep -Milliseconds 150
$r = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
Add-Type -AssemblyName System.Windows.Forms
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$x = [int]($wa.X + ($wa.Width - $w) / 2)
$y = [int]($wa.Y + ($wa.Height - $hh) / 2)
[Win32]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0040) | Out-Null   # SWP_SHOWWINDOW
Write-Output ("centered {0}x{1} at {2},{3}" -f $w, $hh, $x, $y)
