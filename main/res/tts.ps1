# Nyx v2.4 - Windows voices: lists / speaks with SAPI5 (System.Speech) AND OneCore (Windows.Media.SpeechSynthesis).
# Greek voices like "Microsoft Stefanos" are usually OneCore-only, so System.Speech alone falls back to an English voice
# that spells Greek letter by letter. Always renders to a WAV file (Nyx plays it), prints one JSON line.
# env: NYX_TTS_MODE=list|speak, NYX_TTS_TEXT, NYX_TTS_LANG (el), NYX_TTS_VOICE (name|''), NYX_TTS_SRC (sapi|onecore|''),
#      NYX_TTS_RATE (-10..10), NYX_TTS_PITCH (-10..10), NYX_TTS_OUT (wav path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$mode = $env:NYX_TTS_MODE; $lang = ($env:NYX_TTS_LANG + '').ToLower(); if (-not $lang) { $lang = 'el' }
$rate = [int]$env:NYX_TTS_RATE; $pitch = [int]$env:NYX_TTS_PITCH
$voices = @()
$sapi = $null
try { Add-Type -AssemblyName System.Speech; $sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $sapi.GetInstalledVoices()) { if ($v.Enabled) { $voices += [pscustomobject]@{ name = $v.VoiceInfo.Name; lang = $v.VoiceInfo.Culture.Name; gender = '' + $v.VoiceInfo.Gender; src = 'sapi' } } } } catch {}
$oc = $null
try {
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) { $voices += [pscustomobject]@{ name = $v.DisplayName; lang = $v.Language; gender = '' + $v.Gender; src = 'onecore'; id = $v.Id } }
  $oc = $true
} catch {}
if ($mode -eq 'list') { ConvertTo-Json -Compress -InputObject @{ voices = @($voices) }; exit 0 }

$text = $env:NYX_TTS_TEXT; $want = $env:NYX_TTS_VOICE; $src = $env:NYX_TTS_SRC; $out = $env:NYX_TTS_OUT
$pick = $null
if ($want) { $pick = $voices | Where-Object { $_.name -eq $want -and (-not $src -or $_.src -eq $src) } | Select-Object -First 1 }
if (-not $pick) { $pick = $voices | Where-Object { $_.lang.ToLower().StartsWith($lang) -and $_.src -eq 'sapi' } | Select-Object -First 1 }
if (-not $pick) { $pick = $voices | Where-Object { $_.lang.ToLower().StartsWith($lang) } | Select-Object -First 1 }
if (-not $pick) { ConvertTo-Json -Compress -InputObject @{ ok = $false; error = 'NOVOICE'; lang = $lang; voices = @($voices) }; exit 3 }

if ($pick.src -eq 'sapi') {
  $sapi.SelectVoice($pick.name); $sapi.Rate = [Math]::Max(-10, [Math]::Min(10, $rate)); $sapi.SetOutputToWaveFile($out)
  if ($pitch -ne 0) {
    $esc = [System.Security.SecurityElement]::Escape($text); $pp = ('{0:+0;-0}%' -f ($pitch * 5))
    $sapi.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$($pick.lang)'><prosody pitch='$pp'>$esc</prosody></speak>")
  } else { $sapi.Speak($text) }
  $sapi.SetOutputToNull(); $sapi.Dispose()
} else {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $s.Voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $pick.id } | Select-Object -First 1
  try { $s.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(3.0, 1.0 + $rate / 10.0)); $s.Options.AudioPitch = [Math]::Max(0.0, [Math]::Min(2.0, 1.0 + $pitch / 10.0)) } catch {}
  $t = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($s.SynthesizeTextToStreamAsync($text)))
  [void]$t.Wait(-1); $st = $t.Result
  $rs = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st); $fs = [System.IO.File]::Create($out); $rs.CopyTo($fs); $fs.Close(); $rs.Close()
}
ConvertTo-Json -Compress -InputObject @{ ok = $true; voice = $pick.name; culture = $pick.lang; src = $pick.src }
