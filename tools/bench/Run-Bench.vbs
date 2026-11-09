Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = dir & "\run-llama-bench.ps1"
If Not fso.FileExists(ps1) Then
  sh.Popup "run-llama-bench.ps1 not found next to Run-Bench.vbs", 8, "Nyx bench", 16
  WScript.Quit 1
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
