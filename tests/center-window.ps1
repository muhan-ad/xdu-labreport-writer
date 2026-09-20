# Center the app window on the primary work area (restore if minimized).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File center-window.ps1
# NOTE: keep this file ASCII-only -- PowerShell 5.1 reads BOM-less UTF-8 as ANSI,
# so non-ASCII comments/strings become mojibake and break parsing.
# The packaged app's process name contains CJK chars, so match by path instead.
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
# packaged build: exe lives under dist\win-unpacked\ ; dev build: electron.exe
$p = Get-Process -ErrorAction SilentlyContinue |
     Where-Object {
       $_.MainWindowHandle -ne 0 -and $_.Path -and
       ($_.Path -like '*\win-unpacked\*' -or $_.ProcessName -eq 'electron')
     } | Select-Object -First 1
if (-not $p) { Write-Output 'no-window'; exit 1 }
$h = $p.MainWindowHandle
[Win32]::ShowWindow($h, 9) | Out-Null          # SW_RESTORE
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
