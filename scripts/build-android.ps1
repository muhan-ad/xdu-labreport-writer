. 'E:\tools\app-maker\activate.ps1'
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& npm.cmd test
if($LASTEXITCODE -ne 0){throw 'Domain tests failed'}
& npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'Web build failed'}
& npx.cmd cap sync android
if($LASTEXITCODE -ne 0){throw 'Capacitor sync failed'}
Push-Location android
try{& .\gradlew.bat --no-daemon testDebugUnitTest assembleDebug;if($LASTEXITCODE -ne 0){throw 'Android build failed'}}finally{Pop-Location}
& node.exe scripts/verify-apk-resources.mjs
if($LASTEXITCODE -ne 0){throw 'Final APK resource verification failed'}
& node.exe scripts/verify-native-plugin-classes.mjs
if($LASTEXITCODE -ne 0){throw 'Native plugin class verification failed'}
$candidate='android\app\build\outputs\apk\debug\app-debug.apk'
$signer=Join-Path $env:ANDROID_HOME 'build-tools\36.0.0\apksigner.bat'
$signature=& $signer verify --print-certs $candidate
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed'}
$certificates=@($signature | Select-String '^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$')
if($certificates.Count -ne 1){throw 'Expected one APK signing certificate'}
$certificate=$certificates[0].Matches[0].Groups[1].Value.ToLowerInvariant()
& node.exe scripts/local-debug-build.mjs register $candidate $certificate
if($LASTEXITCODE -ne 0){throw 'Versioned local build registration failed'}
