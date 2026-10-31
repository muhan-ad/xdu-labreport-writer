param([string]$OutputDirectory='artifacts/verification/report-layout/word-before',[int]$Limit=28,[string]$InputDirectory='artifacts/report-tests',[string]$ExperimentId='')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskOutput=[IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
$taskInput=[IO.Path]::GetFullPath((Join-Path $taskRoot $InputDirectory))
if (-not $taskInput.StartsWith((Join-Path $taskRoot 'artifacts')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Input must stay inside project artifacts.' }
if (-not $taskOutput.StartsWith((Join-Path $taskRoot 'artifacts')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay inside project artifacts.' }
if (@(Get-Process WINWORD -ErrorAction SilentlyContinue).Count -gt 0) { throw 'Word is already running; refusing to attach or close an existing instance.' }
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskCatalog=([IO.File]::ReadAllText((Join-Path $taskRoot 'src/data/catalog.json'))|ConvertFrom-Json).experiments | Where-Object {-not $ExperimentId -or $_.id -eq $ExperimentId} | Select-Object -First $Limit
if(-not $taskCatalog){throw 'No matching report selected.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
foreach ($taskExperiment in $taskCatalog) {
 $taskZip=[IO.Compression.ZipFile]::OpenRead((Join-Path $taskInput ($taskExperiment.id+'.docx')))
 try {
  foreach ($taskEntry in $taskZip.Entries) {
   if ($taskEntry.FullName -match '(vbaProject|activeX|embeddings)') { throw 'Active document content is not allowed in the rendering corpus.' }
   if ($taskEntry.FullName.EndsWith('.rels')) {
    $taskReader=[IO.StreamReader]::new($taskEntry.Open())
    try { $taskRels=[xml]$taskReader.ReadToEnd();foreach ($taskRel in $taskRels.GetElementsByTagName('Relationship')) { if ($taskRel.GetAttribute('TargetMode') -eq 'External') { throw 'External document relationship blocked before Word opens the corpus.' } } }
    finally { $taskReader.Dispose() }
   }
  }
 } finally { $taskZip.Dispose() }
}
$taskWord=$null;$taskOwnWord=$false;$taskResults=@();$taskDocument=$null
try {
 $taskWord=New-Object -ComObject Word.Application
 if ($taskWord.Documents.Count -ne 0) { throw 'Automation instance contains existing documents; refusing to use it.' }
 $taskOwnWord=$true;$taskWord.Visible=$false;$taskWord.DisplayAlerts=0;$taskWord.AutomationSecurity=3;$taskWord.ScreenUpdating=$false
 foreach ($taskExperiment in $taskCatalog) {
  $taskPath=Join-Path $taskInput ($taskExperiment.id+'.docx')
  $taskPageDir=Join-Path $taskOutput $taskExperiment.id
  if (Test-Path -LiteralPath $taskPageDir) { throw ('Refusing to overwrite rendered pages: '+$taskPageDir) }
  New-Item -ItemType Directory -Path $taskPageDir | Out-Null
  $taskHash=(Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLower()
  try {
   if ($taskWord.Documents.Count -ne 0) { throw 'An unexpected document appeared in the automation instance; stopping.' }
   $taskDocument=$taskWord.Documents.Open($taskPath,$false,$true,$false)
   $taskDocument.Repaginate();$taskPages=$taskDocument.ComputeStatistics(2)
   $taskPageFiles=@()
   for($taskIndex=1;$taskIndex -le $taskPages;$taskIndex++) {
    $taskPage=$taskDocument.ActiveWindow.Panes.Item(1).Pages.Item($taskIndex)
    $taskBytes=[byte[]]$taskPage.EnhMetaFileBits
    $taskStream=[IO.MemoryStream]::new($taskBytes)
    $taskImage=[Drawing.Imaging.Metafile]::new($taskStream)
    $taskWidth=1600;$taskHeight=[int][Math]::Round($taskImage.Height*$taskWidth/$taskImage.Width)
    $taskBitmap=[Drawing.Bitmap]::new($taskWidth,$taskHeight)
    $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
    $taskPng=Join-Path $taskPageDir ('page-'+$taskIndex.ToString('000')+'.png')
    try {
     $taskGraphics.Clear([Drawing.Color]::White)
     $taskGraphics.DrawImage($taskImage,[Drawing.Rectangle]::new(0,0,$taskWidth,$taskHeight))
     $taskBitmap.Save($taskPng,[Drawing.Imaging.ImageFormat]::Png)
     $taskPageFiles+=$taskPng
    } finally {$taskGraphics.Dispose();$taskBitmap.Dispose();$taskImage.Dispose();$taskStream.Dispose()}
   }
   $taskResults+=@{id=$taskExperiment.id;name=$taskExperiment.name;sourceSha256=$taskHash;pages=$taskPages;pageFiles=$taskPageFiles;renderer='Word Page.EnhMetaFileBits';formulas=$taskDocument.OMaths.Count;status='rendered'}
   Write-Output ($taskExperiment.id+' '+$taskPages+' pages rendered')
  } catch {
   $taskResults+=@{id=$taskExperiment.id;name=$taskExperiment.name;sourceSha256=$taskHash;status='failed';error=$_.Exception.Message}
   Write-Output ($taskExperiment.id+' FAILED '+$_.Exception.Message)
  } finally {
   if ($null -ne $taskDocument) { $taskDocument.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument);$taskDocument=$null }
  }
  if ((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLower() -ne $taskHash) { throw 'Read-only source changed unexpectedly.' }
  [IO.File]::WriteAllText((Join-Path $taskOutput 'word-results.json'),($taskResults|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 }
} finally {
 if ($taskOwnWord -and $null -ne $taskWord -and $taskWord.Documents.Count -eq 0) { $taskWord.Quit([ref]0) }
 if ($null -ne $taskWord) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord) }
 [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
if (@($taskResults|Where-Object status -ne 'rendered').Count -gt 0) { throw 'Some reports could not be rendered; inspect word-results.json.' }

