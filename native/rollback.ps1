$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$native = Join-Path $root 'dist\native\AgentIsland.Native.exe'
$legacy = Join-Path $root 'dist\win-unpacked\Agent Island.exe'
if (-not (Test-Path -LiteralPath $legacy)) { throw 'Electron rollback executable not found' }
$instances = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $native })
foreach ($instance in $instances) {
    Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $instance.ProcessId -and $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*windows-notification-listener.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
    Stop-Process -Id $instance.ProcessId
}
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ((Get-ItemProperty -LiteralPath $key).'Agent Island' -eq ('"' + $native + '"')) {
    Set-ItemProperty -LiteralPath $key -Name 'Agent Island' -Value ('"' + $legacy + '"')
}
Start-Process -FilePath $legacy -WindowStyle Hidden
Write-Output '已回退到 Electron 版，设置与待办不变。'
