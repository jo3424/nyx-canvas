# Nyx Canvas — gather version, paths and logs into a zip (no windows).
# Run via Run-GatherLogs.vbs or: powershell -WindowStyle Hidden -File Gather-NyxLogs.ps1
param([string]$OutDir)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }
try {
  $UserHome = $env:USERPROFILE
  if (-not $OutDir) { $OutDir = Join-Path $UserHome 'Desktop' }
  if (-not (Test-Path -LiteralPath $OutDir)) { $OutDir = $UserHome }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $work = Join-Path $env:TEMP ("nyx-logs-" + $stamp)
  New-Item -ItemType Directory -Path $work -Force | Out-Null

  $appData = Join-Path $env:APPDATA 'Nyx Canvas'
  $roots = @($appData)
  $locFile = Join-Path $appData 'location.json'
  if (Test-Path -LiteralPath $locFile) {
    Copy-Item $locFile (Join-Path $work 'location.json') -Force
    try {
      $loc = Get-Content -LiteralPath $locFile -Raw | ConvertFrom-Json
      if ($loc.dir) { $roots += [string]$loc.dir }
    } catch {}
  }
  foreach ($p in @(
    (Join-Path $UserHome 'Nyx Canvas'),
    (Join-Path $UserHome 'NyxCanvas'),
    'C:\Nyx Canvas'
  )) { if (Test-Path -LiteralPath $p) { $roots += $p } }

  $info = @()
  $info += 'gathered: ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss')
  $info += 'userprofile: ' + $UserHome
  $info += 'os: ' + [Environment]::OSVersion.VersionString
  $info += 'roots:'
  $roots = $roots | Select-Object -Unique
  foreach ($r in $roots) { $info += '  ' + $r }

  function Redact-Secrets([string]$Text) {
    if (-not $Text) { return $Text }
    $Text = [regex]::Replace($Text, '(?i)("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]+"', '$1***"')
    $Text = [regex]::Replace($Text, '(?i)(ghp|gho|github_pat|sk-|xai-|gsk_)[A-Za-z0-9_\-]+', '$1***')
    return $Text
  }

  $n = 0
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $destRoot = Join-Path $work ('data-' + $n)
    $n++
    New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
    foreach ($rel in @('logs', 'cache', 'backups', 'snapshots')) {
      $src = Join-Path $root $rel
      if (Test-Path -LiteralPath $src) {
        Copy-Item $src (Join-Path $destRoot $rel) -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
    foreach ($name in @('settings.json','state.json','nyx.json','config.json','update-history.json','package.json')) {
      $hits = @(Get-ChildItem -LiteralPath $root -Filter $name -Recurse -ErrorAction SilentlyContinue | Select-Object -First 8)
      foreach ($f in $hits) {
        $text = [System.IO.File]::ReadAllText($f.FullName)
        $out = Join-Path $destRoot ($f.Directory.Name + '-' + $f.Name)
        [System.IO.File]::WriteAllText($out, (Redact-Secrets $text))
      }
    }
    $pkg = Get-ChildItem -LiteralPath $root -Filter 'package.json' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pkg) { $info += "package.json at ${root}: $($pkg.FullName)" }
  }

  # Installed app next to common locations (version only)
  $exeHints = @(
    (Join-Path $UserHome 'Desktop'),
    (Join-Path $UserHome 'Downloads'),
    'C:\Program Files\Nyx Canvas',
    'C:\Program Files (x86)\Nyx Canvas'
  )
  foreach ($h in $exeHints) {
    if (-not (Test-Path -LiteralPath $h)) { continue }
    Get-ChildItem -LiteralPath $h -Filter 'Nyx*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object {
      $info += 'exe: ' + $_.FullName + '  lastWrite=' + $_.LastWriteTime.ToString('dd/MM/yyyy HH:mm')
      $pkg = Join-Path $_.DirectoryName 'resources\app\package.json'
      $pkg2 = Join-Path $_.DirectoryName 'resources\app.asar.unpacked\package.json'
    }
  }

  $info += 'GPU-Voice-Studio models exists: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\models'))
  $info += 'llama-server.exe exists: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\third_party\llama\llama-server.exe'))
  $info += 'whisper-server.exe exists: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\third_party\whisper.cpp\build-vulkan\bin\Release\whisper-server.exe'))
  $info += 'OmniVoice-Vulkan models exists: ' + (Test-Path (Join-Path $UserHome 'OmniVoice-Vulkan\models'))
  [System.IO.File]::WriteAllText((Join-Path $work 'info.txt'), (($info -join "`r`n") + "`r`n"))

  $zip = Join-Path $OutDir ("Nyx-logs-" + $stamp + '.zip')
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force
  Remove-Item -LiteralPath $work -Recurse -Force
  # One short popup so the user can find the zip; the run itself is hidden.
  try { (New-Object -ComObject Wscript.Shell).Popup("Logs zip:`n$zip", 8, 'Nyx logs', 64) | Out-Null } catch {}
  exit 0
} catch {
  $msg = $_.Exception.Message
  try { (New-Object -ComObject Wscript.Shell).Popup("Gather failed: $msg", 8, 'Nyx logs', 16) | Out-Null } catch {}
  exit 10
}
