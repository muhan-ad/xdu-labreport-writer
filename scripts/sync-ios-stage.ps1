. 'E:\tools\app-maker\activate.ps1'
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& node.exe scripts/sync-ios-version.mjs
if($LASTEXITCODE -ne 0){throw 'iOS 版本同步失败'}
& npm.cmd run sync:ios
if($LASTEXITCODE -ne 0){throw 'iOS 共享资源同步失败'}
& node.exe scripts/verify-ios-stage.mjs
if($LASTEXITCODE -ne 0){throw 'iOS 资源校验失败'}
