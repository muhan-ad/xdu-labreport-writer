param([string]$Serial='',[switch]$VerifyOnly)
. 'E:\tools\app-maker\activate.ps1'
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$record=& node.exe scripts/local-debug-build.mjs resolve
if($LASTEXITCODE -ne 0){throw 'Current build record failed verification; run Build-Android.cmd first'}
$receipt=$record | ConvertFrom-Json
$apk=Join-Path (Get-Location) $receipt.apk
$signer=Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat'
$signature=& $signer verify --print-certs $apk
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
$certificates=@($signature | Select-String '^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$')
if($certificates.Count -ne 1 -or $certificates[0].Matches[0].Groups[1].Value.ToLowerInvariant() -ne $receipt.certificateSha256){throw 'APK signing certificate differs from build record'}
Write-Output ('Verified local debug build '+$receipt.version+' : '+$receipt.apk)
if($VerifyOnly){return}
$devices=& adb.exe devices -l
if($LASTEXITCODE -ne 0){throw 'Cannot read connected devices'}
$online=@($devices | ForEach-Object {if($_ -match '^(\S+)\s+device(?:\s|$)'){$Matches[1]}})
if($Serial){if($online -notcontains $Serial){throw 'Requested device is not ready'}}
elseif($online.Count -eq 1){$Serial=$online[0]}
else{throw 'Specify exactly one connected device to avoid installing to the wrong target'}
$adbTarget=@('-s',$Serial)
& adb.exe @adbTarget install -r $apk
if($LASTEXITCODE -ne 0){throw '安装失败，请确认设备连接并在手机上允许 USB 调试'}
& adb.exe @adbTarget shell am start -n com.labmaker.app/.MainActivity

if($LASTEXITCODE -ne 0){throw 'App installed but could not be opened'}
