# Stream to Shorts - Windows setup.
# Downloads the tools the app needs into tools\ (about 700 MB in total, done once):
#   1. ffmpeg (video processing)            https://github.com/BtbN/FFmpeg-Builds
#   2. whisper.cpp (speech recognition)    https://github.com/ggml-org/whisper.cpp
#   3. the speech model ggml-small.bin     https://huggingface.co/ggerganov/whisper.cpp
# Files that are already there are skipped, so it is safe to run again.
# Options:  -NoModel  (skip the speech model)   -Model ggml-medium.bin  (another model)
param([switch]$NoModel, [string]$Model = 'ggml-small.bin')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # much faster downloads in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root 'tools'
$tmp = Join-Path $env:TEMP ('stream-to-shorts-setup-' + [guid]::NewGuid().ToString('N'))
$headers = @{ 'User-Agent' = 'stream-to-shorts-setup' }
New-Item -ItemType Directory -Force -Path $tmp, (Join-Path $tools 'ffmpeg'), (Join-Path $tools 'whisper\models') | Out-Null

function Get-File([string]$Url, [string]$Out) {
  Write-Host "    downloading $(Split-Path $Out -Leaf)..."
  $part = "$Out.part"
  Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing -Headers $headers
  Move-Item -Force $part $Out
}

try {
  # 1. ffmpeg
  $ffmpeg = Join-Path $tools 'ffmpeg\ffmpeg.exe'
  if (Test-Path $ffmpeg) { Write-Host '1/3 ffmpeg: already installed' }
  else {
    Write-Host '1/3 ffmpeg (about 200 MB)'
    $zip = Join-Path $tmp 'ffmpeg.zip'
    Get-File 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' $zip
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'ffmpeg') -Force
    Get-ChildItem (Join-Path $tmp 'ffmpeg') -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' | Copy-Item -Destination (Join-Path $tools 'ffmpeg') -Force
    if (-not (Test-Path $ffmpeg)) { throw 'ffmpeg.exe was not found in the download.' }
  }

  # 2. whisper.cpp: the newest build that has the Windows x64 program
  $whisper = Join-Path $tools 'whisper\whisper-cli.exe'
  if (Test-Path $whisper) { Write-Host '2/3 speech recognition: already installed' }
  else {
    Write-Host '2/3 speech recognition, whisper.cpp (about 10 MB)'
    $releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30' -Headers $headers
    $asset = $releases | ForEach-Object { $_.assets } | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
    if (-not $asset) { throw 'whisper-bin-x64.zip was not found on https://github.com/ggml-org/whisper.cpp/releases. Download it there and copy its files into tools\whisper.' }
    $zip = Join-Path $tmp 'whisper.zip'
    Get-File $asset.browser_download_url $zip
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'whisper') -Force
    $exe = Get-ChildItem (Join-Path $tmp 'whisper') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
    if (-not $exe) { throw 'whisper-cli.exe was not found in the download.' }
    Get-ChildItem $exe.DirectoryName -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Copy-Item -Destination (Join-Path $tools 'whisper') -Force
  }

  # 3. speech model
  $modelFile = Join-Path $tools "whisper\models\$Model"
  if ($NoModel) { Write-Host '3/3 speech model: skipped (-NoModel)' }
  elseif (Test-Path $modelFile) { Write-Host "3/3 speech model: $Model already installed" }
  else {
    Write-Host "3/3 speech model $Model (about 470 MB for ggml-small.bin)"
    Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$Model" $modelFile
  }

  Write-Host ''
  Write-Host 'Setup complete. Start the app with start.bat' -ForegroundColor Green
}
catch {
  Write-Host ''
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Check your internet connection and run setup.bat again (finished parts are kept).'
  exit 1
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
