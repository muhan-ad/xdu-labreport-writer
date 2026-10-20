param([string]$ElectronPath = $env:LABREPORT_ELECTRON)
$ErrorActionPreference='Stop'
$devRoot=Split-Path -Parent $PSScriptRoot
if (-not $ElectronPath) {
    $devCandidates=@((Join-Path $devRoot 'node_modules\electron\dist\electron.exe'), 'E:\apps\labreport-writer-manager\node_modules\electron\dist\electron.exe')
    $ElectronPath=$devCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $ElectronPath -or -not (Test-Path -LiteralPath $ElectronPath)) { throw '未找到 Electron，请通过 -ElectronPath 指定可信的 Electron 可执行文件。' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:LAB_COURSE_READER_MODE -ErrorAction SilentlyContinue
Start-Process -FilePath $ElectronPath -ArgumentList ('"'+$devRoot+'"') -WorkingDirectory $devRoot -WindowStyle Hidden
Write-Host '已启动源码开发版；主界面学校系统区域可打开“实验选课”。'
