# Stream to Shorts - Windows setup.
# Downloads the tools the app needs into tools\ (about 700 MB in total, done once):
#   1. ffmpeg (video processing)            https://github.com/BtbN/FFmpeg-Builds
#   2. whisper.cpp (speech recognition)    https://github.com/ggml-org/whisper.cpp
#   3. the speech model ggml-small.bin     https://huggingface.co/ggerganov/whisper.cpp
# Files that are already there are skipped, so it is safe to run again.
# Every download comes from the official HTTPS address above and is checked with SHA-256 before use:
#   - whisper.cpp and the speech models against checksums written in this file (pinned versions);
#   - ffmpeg (a stable release build) against the checksum file published with the same release.
# A download that doesn't match is deleted and the setup stops.
# Options:  -NoModel  (skip the speech model)   -Model ggml-medium.bin  (another model)
param([switch]$NoModel, [string]$Model = 'ggml-small.bin')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # much faster downloads in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root 'tools'
$tmp = Join-Path $env:TEMP ('stream-to-shorts-setup-' + [guid]::NewGuid().ToString('N'))
$headers = @{ 'User-Agent' = 'stream-to-shorts-setup' }

# whisper.cpp Windows build, pinned (release b5907 of github.com/ggml-org/whisper.cpp).
$WhisperUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5907/whisper-bin-x64.zip'
$WhisperSha256 = 'ecca07b277d943e9b9f4712856a144b857271a6b333104e511e1988e80db582b'
# Speech models (https://huggingface.co/ggerganov/whisper.cpp): SHA-256 of each file.
$ModelSha256 = @{
  'ggml-tiny.bin' = 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
  'ggml-tiny.en.bin' = '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'
  'ggml-tiny-q5_1.bin' = '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7'
  'ggml-tiny-q8_0.bin' = 'c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca'
  'ggml-tiny.en-q5_1.bin' = 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b'
  'ggml-tiny.en-q8_0.bin' = '5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94'
  'ggml-base.bin' = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
  'ggml-base.en.bin' = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'
  'ggml-base-q5_1.bin' = '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898'
  'ggml-base-q8_0.bin' = 'c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9'
  'ggml-base.en-q5_1.bin' = '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f'
  'ggml-base.en-q8_0.bin' = 'a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e'
  'ggml-small.bin' = '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  'ggml-small.en.bin' = 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d'
  'ggml-small-q5_1.bin' = 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
  'ggml-small-q8_0.bin' = '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f'
  'ggml-small.en-q5_1.bin' = 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30'
  'ggml-small.en-q8_0.bin' = '67a179f608ea6114bd3fdb9060e762b588a3fb3bd00c4387971be4d177958067'
  'ggml-medium.bin' = '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'
  'ggml-medium.en.bin' = 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356'
  'ggml-medium-q5_0.bin' = '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f'
  'ggml-medium-q8_0.bin' = '42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502'
  'ggml-medium.en-q5_0.bin' = '76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0'
  'ggml-medium.en-q8_0.bin' = '43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c'
  'ggml-large-v1.bin' = '7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d'
  'ggml-large-v2.bin' = '9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487'
  'ggml-large-v2-q5_0.bin' = '3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2'
  'ggml-large-v2-q8_0.bin' = 'fef54e6d898246a65c8285bfa83bd1807e27fadf54d5d4e81754c47634737e8c'
  'ggml-large-v3.bin' = '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
  'ggml-large-v3-q5_0.bin' = 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1'
  'ggml-large-v3-turbo.bin' = '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
  'ggml-large-v3-turbo-q5_0.bin' = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
  'ggml-large-v3-turbo-q8_0.bin' = '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1'
}
New-Item -ItemType Directory -Force -Path $tmp, (Join-Path $tools 'ffmpeg'), (Join-Path $tools 'whisper\models') | Out-Null

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# Download over HTTPS to a .part file, check its SHA-256, then move it into place.
function Get-File([string]$Url, [string]$Out, [string]$Sha256) {
  if ($Url -notmatch '^https://(github\.com|huggingface\.co)/') { throw "Refusing to download from an unexpected address: $Url" }
  if ($Sha256 -notmatch '^[0-9a-f]{64}$') { throw "No valid checksum for $(Split-Path $Out -Leaf)" }
  Write-Host "    downloading $(Split-Path $Out -Leaf)..."
  $part = "$Out.part"
  Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing -Headers $headers
  $got = Get-Sha256 $part
  if ($got -ne $Sha256) {
    Remove-Item -LiteralPath $part -Force
    throw "The download of $(Split-Path $Out -Leaf) is damaged or not the official file (SHA-256 $got, expected $Sha256)."
  }
  Write-Host '    checksum OK'
  Move-Item -Force $part $Out
}

try {
  # 1. ffmpeg
  $ffmpeg = Join-Path $tools 'ffmpeg\ffmpeg.exe'
  if (Test-Path $ffmpeg) { Write-Host '1/3 ffmpeg: already installed' }
  else {
    Write-Host '1/3 ffmpeg (about 200 MB)'
    # The newest stable release build (ffmpeg-nX.Y-latest-win64-gpl-X.Y.zip, not the development
    # "master" build), checked against checksums.sha256 published in the same release.
    $base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
    $sums = Join-Path $tmp 'checksums.sha256'
    Invoke-WebRequest -Uri "$base/checksums.sha256" -OutFile $sums -UseBasicParsing -Headers $headers
    $line = Get-Content $sums | Where-Object { $_ -match '^([0-9a-f]{64})\s+\*?(ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-\d+\.\d+\.zip)$' } |
      Sort-Object { [int]($_ -replace '^.*ffmpeg-n(\d+)\.(\d+)-.*$', '$1') * 1000 + [int]($_ -replace '^.*ffmpeg-n(\d+)\.(\d+)-.*$', '$2') } | Select-Object -Last 1
    if (-not $line) { throw 'No stable ffmpeg build was found in the release checksums.' }
    $sha, $name = ($line -split '\s+\*?')[0, 1]
    $zip = Join-Path $tmp 'ffmpeg.zip'
    Get-File "$base/$name" $zip $sha
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'ffmpeg') -Force
    Get-ChildItem (Join-Path $tmp 'ffmpeg') -Recurse -Include 'ffmpeg.exe', 'ffprobe.exe' | Copy-Item -Destination (Join-Path $tools 'ffmpeg') -Force
    if (-not (Test-Path $ffmpeg)) { throw 'ffmpeg.exe was not found in the download.' }
  }

  # 2. whisper.cpp: the newest build that has the Windows x64 program
  $whisper = Join-Path $tools 'whisper\whisper-cli.exe'
  if (Test-Path $whisper) { Write-Host '2/3 speech recognition: already installed' }
  else {
    Write-Host '2/3 speech recognition, whisper.cpp (about 10 MB)'
    $zip = Join-Path $tmp 'whisper.zip'
    Get-File $WhisperUrl $zip $WhisperSha256
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'whisper') -Force
    $exe = Get-ChildItem (Join-Path $tmp 'whisper') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
    if (-not $exe) { throw 'whisper-cli.exe was not found in the download.' }
    Get-ChildItem $exe.DirectoryName -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Copy-Item -Destination (Join-Path $tools 'whisper') -Force
  }

  # 3. speech model
  $modelFile = Join-Path $tools "whisper\models\$Model"
  if ($NoModel) { Write-Host '3/3 speech model: skipped (-NoModel)' }
  elseif (-not $ModelSha256.ContainsKey($Model)) { throw "Unknown speech model '$Model'. Use one of: $(($ModelSha256.Keys | Sort-Object) -join ', ')" }
  elseif ((Test-Path $modelFile) -and (Get-Sha256 $modelFile) -eq $ModelSha256[$Model]) { Write-Host "3/3 speech model: $Model already installed (checksum OK)" }
  else {
    if (Test-Path $modelFile) { Write-Host "3/3 speech model: $Model is damaged, downloading it again"; Remove-Item -LiteralPath $modelFile -Force }
    else { Write-Host "3/3 speech model $Model (about 470 MB for ggml-small.bin)" }
    Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$Model" $modelFile $ModelSha256[$Model]
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
