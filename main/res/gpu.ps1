# Nyx v2.5 — GPU snapshot for the Performance panel (read-only, no admin, hidden window).
# VRAM: WMI GPU performance classes (names are not localized, unlike Get-Counter paths).
# Temperature: LibreHardwareMonitor / OpenHardwareMonitor WMI (only when that app is running) — otherwise null.
$ErrorActionPreference = 'SilentlyContinue'
$o = @{ ok = $true; adapters = @(); procs = @(); temp = $null; tempSrc = ''; hot = $null; util = $null }
try {
  $cls = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
  Get-ChildItem $cls | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath
    $mem = $p.'HardwareInformation.qwMemorySize'; if (-not $mem) { $mem = $p.'HardwareInformation.MemorySize' }
    if ($p.DriverDesc -and $mem) { $o.adapters += @{ name = [string]$p.DriverDesc; total = [double]$mem } }
  }
} catch {}
try {
  $am = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory
  $o.dedicated = [double](($am | Measure-Object -Property DedicatedUsage -Sum).Sum)
  $o.shared = [double](($am | Measure-Object -Property SharedUsage -Sum).Sum)
} catch {}
try {
  $pm = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory
  $by = @{}
  foreach ($x in $pm) { if ($x.Name -match 'pid_(\d+)_') { $id = [int]$Matches[1]; if (-not $by[$id]) { $by[$id] = 0 }; $by[$id] += [double]$x.DedicatedUsage } }
  foreach ($k in $by.Keys) { if ($by[$k] -gt 0) { $n = ''; try { $n = (Get-Process -Id $k).ProcessName } catch {}; $o.procs += @{ pid = $k; name = $n; vram = $by[$k] } } }
} catch {}
try {
  $eng = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -match 'engtype_3D|engtype_Compute' }
  $o.util = [math]::Min(100, [double](($eng | Measure-Object -Property UtilizationPercentage -Sum).Sum))
} catch {}
foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
  try {
    $s = Get-CimInstance -Namespace $ns -ClassName Sensor | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match '/gpu' }
    if ($s) {
      $edge = $s | Where-Object { $_.Name -match 'Core|Edge|GPU Temperature' } | Select-Object -First 1; if (-not $edge) { $edge = $s | Select-Object -First 1 }
      $hot = $s | Where-Object { $_.Name -match 'Hot ?Spot|Junction' } | Select-Object -First 1
      $o.temp = [double]$edge.Value; if ($hot) { $o.hot = [double]$hot.Value }; $o.tempSrc = $ns.Split('/')[1]; break
    }
  } catch {}
}
$o | ConvertTo-Json -Depth 4 -Compress
