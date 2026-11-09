# Nyx llama-bench runner v2.6.5
# Run via Run-Bench.vbs (hidden window). Do not edit the GPU-Voice-Studio exe.
# Official locked tag: b12230 (commit a4d4f2f). b11936 is a reference line only ("allo build").
param(
  [string]$NyxRoot,
  [string]$Model,
  [string]$GvsLlamaDir,
  [string]$Tag = 'b12230',
  [string]$Commit = 'a4d4f2fd4ec85ec6a0a9ece4870416c1b6cc24f5',
  [string]$VulkanSha256 = '1ae697ed5c08d6f260add738e222f3bce525d79836286575d6a335972d772076',
  [string]$RocmSha256 = '6c5261623a6a6fdcadbfe338914f1fe16e1594ce402d90190197445b2e92240f',
  [switch]$SkipDownload,
  [switch]$MeasureVram
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }
$script:RunnerExit = 1
$script:LogFile = $null
$script:StartedAt = Get-Date

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "[{0}] [{1}] {2}" -f $stamp, $Level, $Message
  Write-Host $line
  if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
}

function Save-Utf8 {
  param([string]$Path, [string]$Text)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-SafeExit {
  param([int]$Code, [string]$Message)
  if ($Message) {
    if ($Code -eq 0) { Write-Log $Message 'INFO' } else { Write-Log $Message 'ERROR' }
  }
  $script:RunnerExit = $Code
  exit $Code
}

try {
  if (-not $NyxRoot) {
    if ($PSScriptRoot -and ((Split-Path $PSScriptRoot -Leaf) -eq 'bench')) {
      $NyxRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\')).Path
    } elseif ($PSScriptRoot) {
      $NyxRoot = $PSScriptRoot
    } else {
      $NyxRoot = (Get-Location).Path
    }
  }
  $NyxRoot = $NyxRoot.TrimEnd('\')
  $UserHome = $env:USERPROFILE
  if (-not $UserHome) { $UserHome = $env:HOME }
  if (-not $Model) { $Model = Join-Path $UserHome 'GPU-Voice-Studio\models\gemma-4-12B-it-Q4_0.gguf' }
  if (-not $GvsLlamaDir) { $GvsLlamaDir = Join-Path $UserHome 'GPU-Voice-Studio\third_party\llama' }

  $BenchRoot = Join-Path $NyxRoot 'bench'
  $LogDir = Join-Path $BenchRoot 'logs'
  $DlDir = Join-Path $BenchRoot 'official'
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  New-Item -ItemType Directory -Path $DlDir -Force | Out-Null
  $stampName = Get-Date -Format 'yyyyMMdd-HHmmss'
  $script:LogFile = Join-Path $LogDir ("runner-{0}.log" -f $stampName)
  $SheetPath = Join-Path $LogDir ("results-{0}.tsv" -f $stampName)
  $JsonPath = Join-Path $LogDir ("results-{0}.json" -f $stampName)
  Save-Utf8 $script:LogFile ''
  Write-Log ("Nyx llama-bench runner v2.6.5 | NyxRoot={0}" -f $NyxRoot)
  Write-Log ("UserProfile={0} | MeasureVram={1}" -f $UserHome, [bool]$MeasureVram)
  Write-Log ("Locked official tag={0} commit={1}" -f $Tag, $Commit)
  Write-Log ("Model={0}" -f $Model)
  Write-Log "Do not touch the GPU-Voice-Studio exe. b11936 is a reference line only."

  if (-not (Test-Path -LiteralPath $Model)) {
    Invoke-SafeExit 1 ("MISSING MODEL: {0}  Put Gemma 4 12B Q4_0 there, or pass -Model." -f $Model)
  }

  function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }

  function Get-HipBlasDir {
    $tried = @()
    $candidates = @()
    if ($script:RocmBinDir) { $candidates += $script:RocmBinDir }
    if ($env:HIP_PATH) { $candidates += (Join-Path $env:HIP_PATH 'bin') }
    $base = 'C:\Program Files\AMD\ROCm'
    if (Test-Path -LiteralPath $base) {
      Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Sort-Object { $_.Name } -Descending |
        ForEach-Object { $candidates += (Join-Path $_.FullName 'bin') }
    }
    foreach ($dir in $candidates) {
      if (-not $dir) { continue }
      $dll = Join-Path $dir 'hipblas.dll'
      $tried += $dll
      if (Test-Path -LiteralPath $dll) {
        Write-Log ("hipblas.dll found: {0}" -f $dll)
        return $dir
      }
    }
    Write-Log ("hipblas.dll NOT found. Tried: {0}" -f ($tried -join ' | ')) 'ERROR'
    Write-Log "The official win-rocm zip and the AMD driver do not ship hipblas.dll. Install AMD HIP SDK and add its bin to PATH for this process only." 'ERROR'
    return $null
  }

  function Invoke-LoggedProcess {
    param(
      [string]$File,
      [string[]]$Arguments,
      [string]$WorkDir,
      [string]$OutLog,
      [string]$ErrLog,
      [string]$PrependPath,
      [int]$TimeoutSec = 0
    )
    if (-not $WorkDir) { $WorkDir = (Split-Path -Parent $File) }
    if (-not (Test-Path -LiteralPath $WorkDir)) { $WorkDir = $NyxRoot }
    $outDir = Split-Path -Parent $OutLog
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    if (Test-Path -LiteralPath $OutLog) { Remove-Item -LiteralPath $OutLog -Force }
    if (Test-Path -LiteralPath $ErrLog) { Remove-Item -LiteralPath $ErrLog -Force }
    New-Item -ItemType File -Path $OutLog -Force | Out-Null
    New-Item -ItemType File -Path $ErrLog -Force | Out-Null

    $oldPath = $env:PATH
    if ($PrependPath) { $env:PATH = $PrependPath.TrimEnd('\') + ';' + $env:PATH }
    $proc = $null
    try {
      # Start-Process exit codes are on the process object, not $LASTEXITCODE.
      # Never treat a non-zero child exit as a terminating PowerShell error.
      $ea = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        $proc = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $WorkDir `
          -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog `
          -WindowStyle Hidden -PassThru
      } finally {
        $ErrorActionPreference = $ea
      }
      if (-not $proc) {
        return @{ Code = 5; Out = ''; Err = 'Start-Process returned no process object (Windows may report this as access denied / exit 5).' }
      }
      if ($TimeoutSec -gt 0) {
        $ok = $proc.WaitForExit($TimeoutSec * 1000)
        if (-not $ok) {
          try { $proc.Kill() } catch {}
          return @{ Code = 124; Out = (Get-Content -LiteralPath $OutLog -Raw -ErrorAction SilentlyContinue); Err = "Timed out after $TimeoutSec sec" }
        }
      } else {
        $proc.WaitForExit()
      }
      $stdout = ''
      $stderr = ''
      # Give the redirected files a moment to flush
      Start-Sleep -Milliseconds 200
      if (Test-Path -LiteralPath $OutLog) { $stdout = [System.IO.File]::ReadAllText($OutLog) }
      if (Test-Path -LiteralPath $ErrLog) { $stderr = [System.IO.File]::ReadAllText($ErrLog) }
      return @{ Code = [int]$proc.ExitCode; Out = $stdout; Err = $stderr }
    } catch {
      $msg = $_.Exception.Message
      $code = 5
      if ($_.Exception -is [System.ComponentModel.Win32Exception]) { $code = $_.Exception.NativeErrorCode }
      return @{ Code = $code; Out = ''; Err = ("Start-Process failed: {0} (native/exit {1})" -f $msg, $code) }
    } finally {
      $env:PATH = $oldPath
    }
  }

  function Get-LastLines([string]$Text, [int]$N = 20) {
    if (-not $Text) { return '' }
    $lines = $Text -split '\r?\n' | Where-Object { $_.Trim() -ne '' }
    if ($lines.Count -le $N) { return ($lines -join "`n") }
    return (($lines | Select-Object -Last $N) -join "`n")
  }

  function Get-ListDevicesText {
    param([string]$Exe, [string]$PrependPath, [string]$Label)
    $helpLog = Join-Path $LogDir ($Label + '-help.txt')
    $helpErr = Join-Path $LogDir ($Label + '-help.err.txt')
    $help = Invoke-LoggedProcess -File $Exe -Arguments @('--help') -OutLog $helpLog -ErrLog $helpErr -PrependPath $PrependPath
    $helpText = (($help.Out, $help.Err) -join "`n")
    $devArgs = $null
    if ($helpText -match '--list-devices') { $devArgs = @('--list-devices') }
    $siblings = @(
      (Join-Path (Split-Path $Exe -Parent) 'llama-cli.exe'),
      (Join-Path (Split-Path $Exe -Parent) 'llama-server.exe')
    )
    if (-not $devArgs) {
      Write-Log ("{0}: llama-bench has no --list-devices; trying llama-cli / llama-server" -f $Label) 'WARN'
      foreach ($sib in $siblings) {
        if (-not (Test-Path -LiteralPath $sib)) { continue }
        $h2 = Invoke-LoggedProcess -File $sib -Arguments @('--help') -OutLog ($helpLog + '.sib') -ErrLog ($helpErr + '.sib') -PrependPath $PrependPath
        $ht = (($h2.Out, $h2.Err) -join "`n")
        if ($ht -match '--list-devices') {
          $r = Invoke-LoggedProcess -File $sib -Arguments @('--list-devices') -OutLog (Join-Path $LogDir ($Label + '-devices.txt')) -ErrLog (Join-Path $LogDir ($Label + '-devices.err.txt')) -PrependPath $PrependPath
          return (($r.Out, $r.Err) -join "`n")
        }
      }
      Write-Log ("{0}: no --list-devices flag on llama-bench, llama-cli or llama-server. Stopping this backend." -f $Label) 'ERROR'
      return $null
    }
    $r = Invoke-LoggedProcess -File $Exe -Arguments $devArgs -OutLog (Join-Path $LogDir ($Label + '-devices.txt')) -ErrLog (Join-Path $LogDir ($Label + '-devices.err.txt')) -PrependPath $PrependPath
    if ($r.Code -ne 0) {
      Write-Log ("{0}: --list-devices exited {1}`n{2}" -f $Label, $r.Code, (Get-LastLines $r.Err)) 'ERROR'
    }
    return (($r.Out, $r.Err) -join "`n")
  }

  function Test-ExpectedDevice {
    param([string]$Text, [string]$Token, [string]$Label)
    if (-not $Text) { return $false }
    $rx = [regex]::new(('(?i)(?<![A-Za-z0-9_]){0}(?![A-Za-z0-9_])' -f [regex]::Escape($Token)))
    if ($rx.IsMatch($Text)) {
      Write-Log ("{0}: found {1} in --list-devices" -f $Label, $Token)
      return $true
    }
    # Some builds print "Vulkan0" as "Vulkan 0" or "GPU0: Vulkan"
    if ($Token -eq 'Vulkan0' -and $Text -match '(?i)Vulkan\s*0') { Write-Log ("{0}: found Vulkan 0" -f $Label); return $true }
    if ($Token -eq 'ROCm0' -and $Text -match '(?i)(ROCm|HIP)\s*0') { Write-Log ("{0}: found ROCm/HIP 0" -f $Label); return $true }
    Write-Log ("{0}: {1} NOT listed. --list-devices output:`n{2}" -f $Label, $Token, (Get-LastLines $Text 40)) 'ERROR'
    return $false
  }

  function Get-MeanTs([string]$Text) {
    $vals = @()
    foreach ($line in ($Text -split '\r?\n')) {
      if ($line -match '(?i)^(?:pp|tg|tg128|pp512|pp8192)\S*\s+.*?(\d+(?:\.\d+)?)\s*(?:\+/?\-|\xB1|±)?\s*(\d+(?:\.\d+)?)?') {
        # llama-bench table: last numeric before t/s is often the average
      }
      if ($line -match '(?i)(\d+(?:\.\d+)?)\s*(?:\xB1|±|\+/-)\s*(\d+(?:\.\d+)?)\s*t/?s') {
        $vals += [double]$Matches[1]
      } elseif ($line -match '(?i)\|\s*(?:pp|tg)[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*(\d+(?:\.\d+)?)\s*\|') {
        $vals += [double]$Matches[1]
      } elseif ($line -match '(?i)(?:avg|average|mean)[^\d]*(\d+(?:\.\d+)?)\s*t/?s') {
        $vals += [double]$Matches[1]
      }
    }
    # Official llama-bench prints a markdown/plain table whose last numeric column is t/s.
    # Fallback: the last number on a line that also contains pp512 / tg128 / n_prompt / n_gen
    if ($vals.Count -eq 0) {
      foreach ($line in ($Text -split '\r?\n')) {
        if ($line -notmatch '(?i)(pp\d+|tg\d+|n_prompt|n_gen|test\s)') { continue }
        if ($line -match '(?i)build|model|cpu|warning|loading') { continue }
        $nums = [regex]::Matches($line, '\d+(?:\.\d+)?')
        if ($nums.Count -ge 1) {
          $cand = [double]$nums[$nums.Count - 1].Value
          if ($cand -gt 1 -and $cand -lt 100000) { $vals += $cand }
        }
      }
    }
    if ($vals.Count -eq 0) { return $null }
    return [math]::Round($vals[$vals.Count - 1], 2)
  }

  function Test-LooksCpuFallback {
    param([string]$Text, [object]$Ts, [string]$Kind)
    if ($Text -match '(?i)(using\s+cpu|backend\s*[:=]\s*cpu|no compatible.*gpu|falling back to cpu|device\s*[:=]\s*cpu)') { return $true }
    if ($Kind -like 'pp512*' -and $Ts -ne $null -and [double]$Ts -lt 200) { return $true }
    return $false
  }

  $script:Results = @()
  function Add-Result {
    param($Backend,$Build,$Test,$Ts,$Note,$Code,$Invalid)
    $row = [pscustomobject]@{
      backend = $Backend; build = $Build; test = $Test; t_s = $Ts
      invalid = [bool]$Invalid; exit_code = $Code; note = $Note
      at = (Get-Date -Format 'dd/MM/yyyy HH:mm:ss')
    }
    $script:Results += $row
    Write-Log ("RESULT {0} {1} {2} = {3} t/s  invalid={4}  {5}" -f $Backend, $Build, $Test, $Ts, $Invalid, $Note)
  }

  $script:VramJob = $null
  function Start-VramSampler {
    if (-not $MeasureVram) { return }
    $out = Join-Path $LogDir ("vram-{0}.csv" -f $stampName)
    try {
      $script:VramJob = Start-Job -ScriptBlock {
        param($Path)
        "stamp,used_mb" | Out-File -FilePath $Path -Encoding ASCII
        while ($true) {
          $mb = $null
          try {
            $c = Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue
            if ($c) {
              $mb = [math]::Round((($c.CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum / 1MB), 1)
            }
          } catch {}
          if ($mb -ne $null) { "{0},{1}" -f (Get-Date -Format 'HH:mm:ss.fff'), $mb | Out-File -FilePath $Path -Append -Encoding ASCII }
          Start-Sleep -Seconds 1
        }
      } -ArgumentList $out
      Write-Log ("VRAM sampler started (optional) -> {0}" -f $out)
    } catch {
      Write-Log ("VRAM sampler could not start: {0}" -f $_.Exception.Message) 'WARN'
      $script:VramJob = $null
    }
  }
  function Stop-VramSampler {
    if ($script:VramJob) {
      try { Stop-Job $script:VramJob -ErrorAction SilentlyContinue; Remove-Job $script:VramJob -Force -ErrorAction SilentlyContinue } catch {}
      $script:VramJob = $null
    }
  }

  function Invoke-OneBench {
    param(
      [string]$Exe,
      [string]$Backend,
      [string]$Build,
      [string]$Label,
      [string]$PrependPath,
      [string]$TestName,
      [string[]]$ExtraArgs,
      [int]$Reps,
      [switch]$Warmup
    )
    $safe = ($Label + '-' + $TestName) -replace '[^A-Za-z0-9_.-]', '_'
    if ($Warmup) {
      Write-Log ("WARMUP {0} {1}" -f $Backend, $TestName)
      $w = Invoke-LoggedProcess -File $Exe -Arguments $ExtraArgs -OutLog (Join-Path $LogDir ($safe + '-warmup.out.txt')) -ErrLog (Join-Path $LogDir ($safe + '-warmup.err.txt')) -PrependPath $PrependPath -TimeoutSec 1800
      if ($w.Code -ne 0) {
        Write-Log ("WARMUP failed (exit {0}); continuing to measured run.`n{1}" -f $w.Code, (Get-LastLines $w.Err)) 'WARN'
      }
    }
    Write-Log ("RUN {0} {1}: {2} {3}" -f $Backend, $TestName, $Exe, ($ExtraArgs -join ' '))
    $r = Invoke-LoggedProcess -File $Exe -Arguments $ExtraArgs -OutLog (Join-Path $LogDir ($safe + '.out.txt')) -ErrLog (Join-Path $LogDir ($safe + '.err.txt')) -PrependPath $PrependPath -TimeoutSec 3600
    $text = (($r.Out, $r.Err) -join "`n")
    if ($r.Code -ne 0) {
      $tail = Get-LastLines $r.Err 30
      $note = "exit {0}. Last stderr:`n{1}" -f $r.Code, $tail
      Write-Log ("{0} {1} FAILED. {2}" -f $Backend, $TestName, $note) 'ERROR'
      Add-Result $Backend $Build $TestName $null $note $r.Code $true
      return $false
    }
    $ts = Get-MeanTs $text
    $cpu = Test-LooksCpuFallback -Text $text -Ts $ts -Kind $TestName
    if ($cpu) {
      $note = "INVALID: looks like a CPU fallback (pp512 < 200 t/s or log shows CPU). Do not compare this row. Check hipblas.dll / --list-devices."
      Write-Log ("{0} {1}: {2} (parsed t/s={3})" -f $Backend, $TestName, $note, $ts) 'ERROR'
      Add-Result $Backend $Build $TestName $ts $note $r.Code $true
      return $false
    }
    if ($ts -eq $null) {
      Add-Result $Backend $Build $TestName $null "Could not parse t/s from llama-bench output. See logs." $r.Code $true
      return $false
    }
    Add-Result $Backend $Build $TestName $ts '' $r.Code $false
    return $true
  }

  function Invoke-BackendSuite {
    param([string]$Exe, [string]$Backend, [string]$Build, [string]$Label, [string]$PrependPath, [string]$DeviceToken)
    if (-not (Test-Path -LiteralPath $Exe)) {
      Write-Log ("SKIP {0}: exe not found at {1}" -f $Label, $Exe) 'WARN'
      return $false
    }
    Write-Log ("=== Backend {0} / {1} === exe={2}" -f $Backend, $Build, $Exe)
    $devText = Get-ListDevicesText -Exe $Exe -PrependPath $PrependPath -Label $Label
    if (-not (Test-ExpectedDevice -Text $devText -Token $DeviceToken -Label $Label)) {
      Add-Result $Backend $Build 'list-devices' $null ("Stopped: {0} not listed. Will not run (avoids silent CPU fallback)." -f $DeviceToken) 3 $true
      return $false
    }
    $common = @('-m', $Model, '-ngl', '99', '-fa', '1')
    $plan = @(
      @{ Name = 'pp512';         Reps = 3; Args = @('-p','512','-n','0','-r','3') },
      @{ Name = 'tg128';         Reps = 3; Args = @('-p','0','-n','128','-r','3') },
      @{ Name = 'tg128@d8192';   Reps = 5; Args = @('-p','0','-n','128','-d','8192','-r','5') },
      @{ Name = 'pp8192';        Reps = 3; Args = @('-p','8192','-n','0','-r','3') }
    )
    $any = $false
    foreach ($t in $plan) {
      $args = $common + $t.Args
      $ok = Invoke-OneBench -Exe $Exe -Backend $Backend -Build $Build -Label $Label -PrependPath $PrependPath -TestName $t.Name -ExtraArgs $args -Reps $t.Reps -Warmup
      if ($ok) { $any = $true }
    }
    return $any
  }

  function Get-OfficialZip {
    param([string]$Name, [string]$Url, [string]$Sha, [string]$DestDir)
    $zip = Join-Path $DlDir $Name
    if (-not (Test-Path -LiteralPath $zip)) {
      if ($SkipDownload) { Invoke-SafeExit 2 ("Missing {0} and -SkipDownload was set." -f $zip) }
      Write-Log ("Downloading {0}" -f $Url)
      $ea = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
      } catch {
        Invoke-SafeExit 2 ("Download failed for {0}: {1}" -f $Url, $_.Exception.Message)
      } finally { $ErrorActionPreference = $ea }
    }
    $got = Get-FileSha256 $zip
    if ($got -ne $Sha.ToLowerInvariant()) {
      Invoke-SafeExit 2 ("SHA256 mismatch for {0}: got {1}, expected {2}. Delete the zip and rerun." -f $Name, $got, $Sha)
    }
    Write-Log ("SHA256 ok {0} = {1}" -f $Name, $got)
    if (-not (Test-Path -LiteralPath (Join-Path $DestDir 'llama-bench.exe'))) {
      if (Test-Path -LiteralPath $DestDir) { Remove-Item -LiteralPath $DestDir -Recurse -Force }
      New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
      Expand-Archive -LiteralPath $zip -DestinationPath $DestDir -Force
      # Some zips nest one folder
      $nested = Get-ChildItem -LiteralPath $DestDir -Filter 'llama-bench.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($nested -and $nested.DirectoryName -ne $DestDir) {
        Get-ChildItem -LiteralPath $nested.DirectoryName | ForEach-Object {
          Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $DestDir $_.Name) -Recurse -Force
        }
      }
    }
    $exe = Join-Path $DestDir 'llama-bench.exe'
    if (-not (Test-Path -LiteralPath $exe)) { Invoke-SafeExit 2 ("llama-bench.exe missing after unzip of {0}" -f $Name) }
    return $exe
  }

  Start-VramSampler
  try {
    $vkUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag/llama-$Tag-bin-win-vulkan-x64.zip"
    $roUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag/llama-$Tag-bin-win-rocm-10.0-x64.zip"
    $vkDir = Join-Path $DlDir "vulkan-$Tag"
    $roDir = Join-Path $DlDir "rocm-$Tag"
    $vkExe = Get-OfficialZip -Name "llama-$Tag-bin-win-vulkan-x64.zip" -Url $vkUrl -Sha $VulkanSha256 -DestDir $vkDir
    $roExe = Get-OfficialZip -Name "llama-$Tag-bin-win-rocm-10.0-x64.zip" -Url $roUrl -Sha $RocmSha256 -DestDir $roDir
    $script:RocmBinDir = Split-Path -Parent $roExe

    $okAny = $false
    if (Invoke-BackendSuite -Exe $vkExe -Backend 'Vulkan' -Build ($Tag + ' official') -Label 'vulkan-official' -PrependPath $null -DeviceToken 'Vulkan0') { $okAny = $true }

    $hip = Get-HipBlasDir
    if (-not $hip) {
      Add-Result 'ROCm' ($Tag + ' official') 'hipblas' $null 'Stopped: hipblas.dll not found. The win-rocm zip does not include it; install AMD HIP SDK (7.2 works with the 10.0 build) or the run would silently fall to the CPU (~34 t/s).' 3 $true
    } else {
      if (Invoke-BackendSuite -Exe $roExe -Backend 'ROCm' -Build ($Tag + ' official') -Label 'rocm-official' -PrependPath $hip -DeviceToken 'ROCm0') { $okAny = $true }
    }

    $gvsBench = Join-Path $GvsLlamaDir 'llama-bench.exe'
    if (Test-Path -LiteralPath $gvsBench) {
      Write-Log ("GVS llama-bench found at {0} (reference line, allo build — do not replace the Voice Studio exe)" -f $gvsBench)
      if (Invoke-BackendSuite -Exe $gvsBench -Backend 'Vulkan' -Build 'b11936 GVS (allo build)' -Label 'vulkan-gvs-b11936' -PrependPath $null -DeviceToken 'Vulkan0') { $okAny = $true }
    } else {
      Write-Log ("GVS llama-bench.exe not found at {0}. Skipping the b11936 reference line (already measured manually on 09/11/2026). The Voice Studio llama-server.exe is not used and is not modified." -f $gvsBench) 'WARN'
      Add-Result 'Vulkan' 'b11936 GVS (allo build)' 'skip' $null 'llama-bench.exe not next to the Voice Studio server. Reference line skipped on purpose.' $null $false
    }

    # Write the sheet
    $header = "backend`tbuild`ttest`tt/s`tinvalid`texit_code`tnote`tat`ttag`tcommit`tmodel`tdriver_note"
    $lines = @($header)
    foreach ($row in $script:Results) {
      $note = [string]$row.note -replace '[\t\r\n]+', ' / '
      $lines += "{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}`t{8}`t{9}`t{10}`t{11}" -f `
        $row.backend, $row.build, $row.test, $row.t_s, $row.invalid, $row.exit_code, $note, $row.at, $Tag, $Commit, $Model, 'VRAM not measured unless -MeasureVram'
    }
    Save-Utf8 $SheetPath (($lines -join "`r`n") + "`r`n")
    $jsonObj = @{
      tag = $Tag; commit = $Commit; model = $Model
      started = $script:StartedAt.ToString('dd/MM/yyyy HH:mm:ss')
      finished = (Get-Date).ToString('dd/MM/yyyy HH:mm:ss')
      measureVram = [bool]$MeasureVram
      flags = '-ngl 99 -fa 1, warmup r=1 then r=3 (r=5 for tg128@d8192)'
      results = $script:Results
    }
    Save-Utf8 $JsonPath (($jsonObj | ConvertTo-Json -Depth 6) + "`n")
    Write-Log ("Wrote {0}" -f $SheetPath)
    Write-Log ("Wrote {0}" -f $JsonPath)
    if (-not $okAny) { Invoke-SafeExit 4 "No backend produced a valid measured row. See the log and the .err.txt files in $LogDir." }
    Invoke-SafeExit 0 ("Done. Send the folder {0} ." -f $LogDir)
  } finally {
    Stop-VramSampler
  }
} catch {
  $msg = $_.Exception.Message
  $line = $_.InvocationInfo.ScriptLineNumber
  if ($script:LogFile) { Write-Log ("UNCAUGHT at line {0}: {1}`n{2}" -f $line, $msg, $_.ScriptStackTrace) 'ERROR' }
  else { Write-Host ("UNCAUGHT at line {0}: {1}" -f $line, $msg) }
  # Never use exit code 5 for our own failures; 5 is reserved so a Windows access-denied is not confused with a script bug.
  $code = 10
  exit $code
}
