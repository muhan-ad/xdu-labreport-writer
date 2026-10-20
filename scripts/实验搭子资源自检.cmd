@echo off
setlocal
chcp 65001 >nul
set "LAB_RESOURCE_CHECK_SELF=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:LAB_RESOURCE_CHECK_SELF,[Text.Encoding]::UTF8);$body=($raw -split '(?m)^# POWERSHELL_START\r?$',2)[1];if(!$body){throw 'Diagnostic script is incomplete'};& ([ScriptBlock]::Create($body))"
if errorlevel 1 echo Check failed. Please send a screenshot of this window.
pause
exit /b
# POWERSHELL_START
param([string]$InstallPath='', [string]$UserDataPath='', [string]$OutputDirectory='', [switch]$NoDiscovery)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$report=New-Object 'Collections.Generic.List[string]'
$candidates=@{}
$expected= '["薄透镜焦距的测量（凹透镜）\\generate.py","薄透镜焦距的测量（凹透镜）\\schema.json","薄透镜焦距的测量（凸透镜）\\generate.py","薄透镜焦距的测量（凸透镜）\\schema.json","低电阻的测量\\generate.py","低电阻的测量\\schema.json","电表的改装与校准\\generate.py","电表的改装与校准\\schema.json","电容与高电阻的测量\\generate.py","电容与高电阻的测量\\schema.json","电子偏转特性的测量\\generate.py","电子偏转特性的测量\\schema.json","电子元件伏安特性的测量\\generate.py","电子元件伏安特性的测量\\schema.json","刚体转动惯量的测量\\generate.py","刚体转动惯量的测量\\schema.json","光的偏振特性测量\\generate.py","光的偏振特性测量\\schema.json","光的偏振特性测量（第二学期）\\generate.py","光的偏振特性测量（第二学期）\\schema.json","光栅光谱的测量\\generate.py","光栅光谱的测量\\schema.json","霍尔效应实验\\generate.py","霍尔效应实验\\schema.json","激光波长的测量\\generate.py","激光波长的测量\\schema.json","静电场的模拟\\generate.py","静电场的模拟\\schema.json","拉伸法测量钢丝杨氏弹性模量\\generate.py","拉伸法测量钢丝杨氏弹性模量\\schema.json","理想气体状态方程\\generate.py","理想气体状态方程\\schema.json","灵敏电流计特性的测量\\generate.py","灵敏电流计特性的测量\\schema.json","扭摆法测量钢丝切变模量\\generate.py","扭摆法测量钢丝切变模量\\schema.json","劈尖干涉\\generate.py","劈尖干涉\\schema.json","平凸透镜曲率半径的测量\\generate.py","平凸透镜曲率半径的测量\\schema.json","三棱镜顶角的测量\\generate.py","三棱镜顶角的测量\\schema.json","声速的测量（空气）\\generate.py","声速的测量（空气）\\schema.json","声速的测量（水中）\\generate.py","声速的测量（水中）\\schema.json","衍射光强分布的测量\\generate.py","衍射光强分布的测量\\schema.json","长度与体积的测量\\generate.py","长度与体积的测量\\schema.json","直螺线管磁场分布的测量\\generate.py","直螺线管磁场分布的测量\\schema.json","重力加速度的测量\\generate.py","重力加速度的测量\\schema.json","RLC电路的稳态特性研究实验\\generate.py","RLC电路的稳态特性研究实验\\schema.json","common\\__init__.py","common\\calculation_context.py","common\\constants.py","common\\content_policy.py","common\\custom_plot.py","common\\data_io.py","common\\data_validation.py","common\\docx_omml.py","common\\docx_report.py","common\\latex_formatter.py","common\\official_charts.py","common\\plot_utils.py","common\\polarization.py","common\\regression.py","common\\report_style.py","common\\uncertainty.py","common\\variants.py"]' | ConvertFrom-Json
function Add-Line([string]$text){$report.Add($text)}
function Add-Install([string]$value,[string]$source){
 if([string]::IsNullOrWhiteSpace($value)){return}
 try{
  $p=[Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
  if(![IO.Path]::IsPathRooted($p)){return}
  if([IO.Path]::GetExtension($p) -ieq '.exe'){$p=Split-Path -Parent $p}
  if((Split-Path -Leaf $p) -eq 'resources'){$p=Split-Path -Parent $p}
  $p=[IO.Path]::GetFullPath($p).TrimEnd('\','/')
  if(!$candidates.ContainsKey($p)){$candidates[$p]=$source}
 }catch{}
}
function Check-FullManifest([string]$resources){
 $file=Join-Path $resources 'resource-integrity.json'
 if(!(Test-Path -LiteralPath $file -PathType Leaf)){Add-Line '完整资源校验清单缺失：resource-integrity.json；上面仅为基础文件检查，不能确认完整资源。';return}
 try{
  if((Get-Item -LiteralPath $file).Length -gt 20MB){throw 'manifest too large'}
  $manifest=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $roots=@('app.asar','物理实验','python-runtime','skills','course-selection','shared');$seen=@{}
  if($manifest.schema -ne 1 -or $manifest.algorithm -ne 'sha256' -or $manifest.appVersion -ne '2.1.5' -or !$manifest.files.Count -or $manifest.files.Count -gt 50000){throw 'invalid manifest'}
  foreach($entry in $manifest.files){
   $name=[string]$entry.path
   if(!$name -or $name -match '\\|:|^/|(^|/)(\.|\.\.)(/|$)|//' -or $roots -cnotcontains ($name.Split('/')[0]) -or $seen.ContainsKey($name) -or $entry.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $entry.size -lt 0){throw 'invalid manifest entry'}
   $seen[$name]=$true
  }
  foreach($root in $roots){if(!@($seen.Keys | Where-Object {$_ -ceq $root -or $_.StartsWith($root+'/')}).Count){throw 'incomplete manifest'}}
 }catch{Add-Line '完整资源校验清单无效或版本不一致，不能确认资源完整。';return}
 $missing=New-Object 'Collections.Generic.List[string]';$changed=New-Object 'Collections.Generic.List[string]';$unreadable=New-Object 'Collections.Generic.List[string]'
 Write-Host ('正在核对 '+$manifest.files.Count+' 个资源文件，请稍候…')
 foreach($entry in $manifest.files){
  $target=Join-Path $resources $entry.path
  if(!(Test-Path -LiteralPath $target -PathType Leaf)){$missing.Add($entry.path);continue}
  try{
   $ancestor=$resources
   foreach($part in $entry.path.Split('/')){$ancestor=Join-Path $ancestor $part;if(((Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'linked resource'}}
   $before=Get-Item -LiteralPath $target -ErrorAction Stop
   if($before.Length -ne $entry.size){$changed.Add($entry.path);continue}
   $hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
   $after=Get-Item -LiteralPath $target -ErrorAction Stop
   if($before.Length -ne $after.Length -or $before.LastWriteTimeUtc -ne $after.LastWriteTimeUtc){$unreadable.Add($entry.path)}elseif($hash -cne $entry.sha256){$changed.Add($entry.path)}
  }catch{$unreadable.Add($entry.path)}
 }
 if(!$missing.Count -and !$changed.Count -and !$unreadable.Count){Add-Line ('【资源完整】已核对 '+$manifest.files.Count+' 个文件的大小与 SHA-256。');return}
 Add-Line ('【资源不完整】缺失 '+$missing.Count+' 项，内容不一致 '+$changed.Count+' 项，无法读取 '+$unreadable.Count+' 项。')
 foreach($name in $missing){Add-Line ('缺失资源：'+$name)}
 foreach($name in $changed){Add-Line ('内容不一致：'+$name)}
 foreach($name in $unreadable){Add-Line ('无法读取：'+$name)}
}
Add-Line '实验搭子：实验资源只读自检（按 2.1.5 资源清单）'
Add-Line ('检查时间：'+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line '本脚本不联网、不修改安装和用户数据，不读取密码、成绩、测量数据或报告内容。'
Add-Line ''
if(!$UserDataPath){$UserDataPath=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'labreport-writer'}
Add-Install $InstallPath '手动指定'
if(!$NoDiscovery){
 try{Get-CimInstance Win32_Process -Filter "Name = '实验搭子.exe'" -ErrorAction Stop | ForEach-Object {Add-Install $_.ExecutablePath ('运行进程 PID '+$_.ProcessId)}}catch{Add-Line '提示：未能枚举运行进程，继续检查快捷方式和安装记录。'}
 foreach($base in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'))){
  if(!$base -or !(Test-Path -LiteralPath $base)){continue}
  try{Get-ChildItem -LiteralPath $base -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '实验搭子|labreport'} | ForEach-Object {
   $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
   Add-Install $shortcut.TargetPath ('快捷方式：'+$_.FullName)
  }}catch{}
 }
 foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')){
  try{Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object {Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue} | Where-Object {$_.DisplayName -match '实验搭子|labreport'} | ForEach-Object {
   Add-Install $_.InstallLocation 'Windows 安装记录'
   if($_.DisplayIcon -match '^"?(.+?\.exe)"?(?:,\d+)?$'){Add-Install $matches[1] 'Windows 安装图标记录'}
  }}catch{}
 }
 $selfDir=Split-Path -Parent $env:LAB_RESOURCE_CHECK_SELF
 if($selfDir){foreach($dir in @($selfDir,(Join-Path $selfDir 'dist\win-unpacked'))){if(Test-Path -LiteralPath (Join-Path $dir '实验搭子.exe')){Add-Install $dir '检查脚本所在目录'}}}
}
$log=Join-Path $UserDataPath 'logs\app.log'
Add-Line ('用户数据目录：'+$UserDataPath)
if(Test-Path -LiteralPath $log){
 try{
  $starts=@(Get-Content -LiteralPath $log -Tail 2000 -Encoding UTF8 -ErrorAction Stop | Where-Object {$_ -match 'app started.*PROJECT_ROOT=.*EXPERIMENTS_DIR='} | Select-Object -Last 3)
  Add-Line '最近启动路径（仅摘取启动行，不复制整份日志）：'
  foreach($line in $starts){Add-Line $line;if(!$NoDiscovery -and $line -match 'PROJECT_ROOT=(.*?)\s+\|\s+EXPERIMENTS_DIR='){
   $logged=$matches[1].Trim();if((Split-Path -Leaf $logged) -eq 'resources'){Add-Install $logged '最近启动日志'}
  }}
  if(!$starts.Count){Add-Line '未找到可用的启动路径记录。'}
 }catch{Add-Line '启动日志无法读取。'}
}else{Add-Line '启动日志不存在。'}
$userScripts=Join-Path $UserDataPath '实验数据\实验脚本'
if(Test-Path -LiteralPath $userScripts -PathType Container){
 $userDirs=@(Get-ChildItem -LiteralPath $userScripts -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -ne 'common' -and !$_.Name.StartsWith('.')})
 $userReady=@($userDirs | Where-Object {(Test-Path -LiteralPath (Join-Path $_.FullName 'generate.py')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'schema.json'))})
 Add-Line ('用户实验目录：存在；实验目录数 '+$userDirs.Count+'，同时具有入口和配置的目录数 '+$userReady.Count+'。')
}else{Add-Line '用户实验目录：不存在（首次使用时可能正常）。'}
Add-Line ''
if(!$candidates.Count){Add-Line '【未找到安装位置】请先打开实验搭子，再双击运行本脚本；或把本脚本放在实验搭子.exe旁边运行。'}
foreach($install in @($candidates.Keys | Sort-Object)){
 Add-Line ('=== 安装候选：'+$install+' ===');Add-Line ('发现方式：'+$candidates[$install])
 $exe=Join-Path $install '实验搭子.exe';$res=Join-Path $install 'resources';$builtin=Join-Path $res '物理实验\实验脚本'
 Add-Line ('程序文件：'+$(if(Test-Path -LiteralPath $exe -PathType Leaf){'存在'}else{'缺失'}))
 if(Test-Path -LiteralPath $exe -PathType Leaf){try{Add-Line ('程序版本：'+(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion)}catch{}}
 foreach($part in @('app.asar','python-runtime\python.exe')){Add-Line ($part+'：'+$(if(Test-Path -LiteralPath (Join-Path $res $part) -PathType Leaf){'存在'}else{'缺失'}))}
 Check-FullManifest $res
 Add-Line ('内置资源预期位置：'+$builtin)
 if(!(Test-Path -LiteralPath $builtin -PathType Container)){
  Add-Line '【异常：内置资源总目录不存在】符合“内置实验资源缺失”的直接触发条件。'
  if(Test-Path -LiteralPath $userScripts -PathType Container){Add-Line '用户实验目录仍存在，当前代码也可能因强制检查内置目录而阻止操作。请保留用户数据。'}
 }else{
  $missing=@($expected | Where-Object {!(Test-Path -LiteralPath (Join-Path $builtin $_) -PathType Leaf)})
  if(!$missing.Count){Add-Line ('【通过】28 项实验的入口、配置及公共 Python 文件均存在，共 '+$expected.Count+' 个检查项。')}
  else{Add-Line ('【异常：资源文件不完整】按 2.1.5 清单缺少 '+$missing.Count+' 项；旧版本也可能与此清单不同：');foreach($file in $missing){Add-Line ('  缺少：'+$file)}}
 }
 Add-Line ''
}
if($candidates.Count -gt 1){Add-Line '发现多个安装候选。请结合“运行进程”和最近启动路径判断是否打开了旧目录。'}
Add-Line '结果仅说明本机文件和查找路径状态；不能仅凭目录缺失断定是杀毒软件、安装器或用户操作导致。'
Add-Line '请将本 TXT 报告发给开发者。不要删除用户实验数据，不需要提供账号密码。'
if(!$OutputDirectory){$OutputDirectory=[Environment]::GetFolderPath('DesktopDirectory')}
if(!$OutputDirectory){$OutputDirectory=[IO.Path]::GetTempPath()}
$name='实验搭子资源检查-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+$PID+'.txt'
try{[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null;$output=Join-Path $OutputDirectory $name;[IO.File]::WriteAllLines($output,$report,(New-Object Text.UTF8Encoding($true)))}catch{$output=Join-Path ([IO.Path]::GetTempPath()) $name;[IO.File]::WriteAllLines($output,$report,(New-Object Text.UTF8Encoding($true)))}
Write-Host '';Write-Host '检查完成。请将下面的 TXT 文件发给开发者：' -ForegroundColor Green;Write-Host $output;Write-Output $output