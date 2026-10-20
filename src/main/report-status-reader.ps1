$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.DataWriter,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapTransform,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
function Await($Operation,[Type]$Type){$task=$script:asTask.MakeGenericMethod($Type).Invoke($null,@($Operation));$task.Wait();return $task.Result}
$engines=@()
foreach($tag in @('en-US','zh-CN')){
 $language=New-Object Windows.Globalization.Language($tag)
 if([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($language)){$engines+=,@{Engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language);Tag=$tag}}
}
while($null -ne ($line=[Console]::ReadLine())){
 $stream=$null;$bitmap=$null;$request=$null
 try{
  $request=$line | ConvertFrom-Json
  $bytes=[Convert]::FromBase64String([string]$request.image)
  if($bytes.Length -gt 100000 -or $engines.Count -eq 0){throw 'Unsupported image'}
  # A strip of repeated real glyphs lets Windows detect tiny standalone numbers.
  # No synthetic score text is introduced; every copy is the original school image.
  $imageStream=New-Object System.IO.MemoryStream(,$bytes)
  $original=$null;$strip=$null;$graphics=$null;$encoded=$null
  try{
   $original=[System.Drawing.Image]::FromStream($imageStream)
   if($original.Width -gt 800 -or $original.Height -gt 200){throw 'Unsupported dimensions'}
   if($request.threshold -eq 120){
    for($y=0;$y -lt $original.Height;$y++){for($x=0;$x -lt $original.Width;$x++){
     $pixel=$original.GetPixel($x,$y);$gray=(299*$pixel.R+587*$pixel.G+114*$pixel.B)/1000
     $ink=$pixel.A -gt 128 -and $gray -lt 120
     $original.SetPixel($x,$y, $(if($ink){[System.Drawing.Color]::Black}else{[System.Drawing.Color]::White}))
    }}
   }
   $left=$original.Width;$top=$original.Height;$right=-1;$bottom=-1
   for($y=0;$y -lt $original.Height;$y++){for($x=0;$x -lt $original.Width;$x++){$pixel=$original.GetPixel($x,$y);if($pixel.A -gt 128 -and ($pixel.R -lt 190 -or $pixel.G -lt 190 -or $pixel.B -lt 190)){$left=[Math]::Min($left,$x);$right=[Math]::Max($right,$x);$top=[Math]::Min($top,$y);$bottom=[Math]::Max($bottom,$y)}}}
   if($right -lt $left){throw 'Empty image'}
   $crop=New-Object System.Drawing.Rectangle($left,$top,($right-$left+1),($bottom-$top+1))
   $step=$crop.Width+24
   $strip=New-Object System.Drawing.Bitmap(($step*4+20)),($crop.Height+20)
   $graphics=[System.Drawing.Graphics]::FromImage($strip);$graphics.Clear([System.Drawing.Color]::White)
   for($i=0;$i -lt 4;$i++){$dest=New-Object System.Drawing.Rectangle((10+$i*$step),10,$crop.Width,$crop.Height);$graphics.DrawImage($original,$dest,$crop,[System.Drawing.GraphicsUnit]::Pixel)}
   $encoded=New-Object System.IO.MemoryStream;$strip.Save($encoded,[System.Drawing.Imaging.ImageFormat]::Png);$bytes=$encoded.ToArray()
  }finally{if($graphics){$graphics.Dispose()};if($strip){$strip.Dispose()};if($original){$original.Dispose()};if($encoded){$encoded.Dispose()};$imageStream.Dispose()}
  $stream=New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer=New-Object Windows.Storage.Streams.DataWriter($stream)
  $writer.WriteBytes($bytes);$null=Await ($writer.StoreAsync()) ([uint32]);$null=$writer.DetachStream();$writer.Dispose();$stream.Seek(0)
  $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  if($decoder.PixelWidth -gt 3300 -or $decoder.PixelHeight -gt 220){throw 'Unsupported dimensions'}
  $transform=New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth=[uint32]($decoder.PixelWidth*4);$transform.ScaledHeight=[uint32]($decoder.PixelHeight*4)
  $bitmap=Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,$transform,[Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,[Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $results=@();$scoreResults=@()
  foreach($entry in $engines){$recognized=Await ($entry.Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]);$text=([string]$recognized.Text).Trim();$results+=,$text;if($entry.Tag -eq 'en-US'){$scoreResults+=,$text}}
  $response=@{id=$request.id;texts=$results;scoreTexts=$scoreResults}
 }catch{$response=@{id=$request.id;texts=@()}}
 finally{if($null -ne $bitmap){$bitmap.Dispose()};if($null -ne $stream){$stream.Dispose()}}
 [Console]::WriteLine(($response | ConvertTo-Json -Compress -Depth 4))
}
