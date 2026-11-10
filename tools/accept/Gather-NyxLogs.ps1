# Nyx Canvas — μαζεύει έκδοση, logs και ρυθμίσεις AI σε zip, χωρίς κλειδιά και χωρίς παράθυρο cmd.
# Τρέξε με διπλό κλικ στο Run-GatherLogs.vbs ή: powershell -WindowStyle Hidden -File Gather-NyxLogs.ps1
param([string]$OutDir)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }

function Redact-Secrets([string]$Text) {
  if (-not $Text) { return $Text }
  $Text = [regex]::Replace($Text, '(?i)("(?:api[_-]?key|token|secret|password|authorization|auth|bearer|access_token|refresh_token|client_secret|private_key)"\s*:\s*")[^"]*"', '$1***"')
  $Text = [regex]::Replace($Text, '(?i)(?<![A-Za-z0-9_\-])(ghp|gho|github_pat|sk-|xai-|gsk_|Bearer\s+)[A-Za-z0-9_\-\.]+', { param($m) if ($m.Value -match '^(?i)Bearer\s+') { return 'Bearer ***' } else { return ($m.Groups[1].Value + '***') } })
  return $Text
}

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
  $info += 'Συλλογή: ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss') + ' (τοπική ώρα)'
  $info += 'Προφίλ: ' + $UserHome
  $info += 'Λειτουργικό: ' + [Environment]::OSVersion.VersionString
  $info += 'Ρίζες δεδομένων:'
  $roots = $roots | Select-Object -Unique
  foreach ($r in $roots) { $info += '  ' + $r }

  $version = $null
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
        if ($f.Name -eq 'package.json' -and -not $version) {
          try { $pj = $text | ConvertFrom-Json; if ($pj.version) { $version = [string]$pj.version } } catch {}
        }
        $out = Join-Path $destRoot ($f.Directory.Name + '-' + $f.Name)
        [System.IO.File]::WriteAllText($out, (Redact-Secrets $text))
        # Ξεχωριστό αρχείο με τις ρυθμίσεις AI, χωρίς κλειδιά
        if ($f.Name -in @('nyx.json','settings.json','state.json')) {
          try {
            $j = $text | ConvertFrom-Json
            $ai = $null
            if ($j.settings -and $j.settings.ai) { $ai = $j.settings.ai }
            elseif ($j.ai) { $ai = $j.ai }
            if ($ai) {
              $aiJson = (Redact-Secrets ($ai | ConvertTo-Json -Depth 12))
              [System.IO.File]::WriteAllText((Join-Path $destRoot 'ai-settings.json'), $aiJson)
            }
          } catch {}
        }
      }
    }
    $pkg = Get-ChildItem -LiteralPath $root -Filter 'package.json' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pkg) { $info += "package.json στο ${root}: $($pkg.FullName)" }
  }

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
      foreach ($rel in @('resources\app\package.json','resources\app.asar.unpacked\package.json')) {
        $pkg = Join-Path $_.DirectoryName $rel
        if ((Test-Path -LiteralPath $pkg) -and -not $version) {
          try { $pj = Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json; if ($pj.version) { $version = [string]$pj.version } } catch {}
        }
      }
    }
  }

  if ($version) { $info = @('Έκδοση εφαρμογής: ' + $version) + $info } else { $info = @('Έκδοση εφαρμογής: δεν βρέθηκε στο package.json') + $info }
  $info += 'GPU-Voice-Studio models υπάρχει: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\models'))
  $info += 'llama-server.exe υπάρχει: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\third_party\llama\llama-server.exe'))
  $info += 'whisper-server.exe υπάρχει: ' + (Test-Path (Join-Path $UserHome 'GPU-Voice-Studio\third_party\whisper.cpp\build-vulkan\bin\Release\whisper-server.exe'))
  $info += 'OmniVoice-Vulkan models υπάρχει: ' + (Test-Path (Join-Path $UserHome 'OmniVoice-Vulkan\models'))
  $info += 'Τα κλειδιά, τα token και οι κωδικοί έχουν καλυφθεί (***) και δεν μπαίνουν στο zip.'
  [System.IO.File]::WriteAllText((Join-Path $work 'info.txt'), (($info -join "`r`n") + "`r`n"), [System.Text.UTF8Encoding]::new($false))

  $zip = Join-Path $OutDir ("Nyx-logs-" + $stamp + '.zip')
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force
  Remove-Item -LiteralPath $work -Recurse -Force
  try { (New-Object -ComObject Wscript.Shell).Popup("Τα αρχεία καταγραφής αποθηκεύτηκαν εδώ:`n$zip", 8, 'Nyx — αρχεία καταγραφής', 64) | Out-Null } catch {}
  exit 0
} catch {
  $msg = $_.Exception.Message
  try { (New-Object -ComObject Wscript.Shell).Popup("Η συλλογή απέτυχε: $msg", 8, 'Nyx — αρχεία καταγραφής', 16) | Out-Null } catch {}
  exit 10
}
