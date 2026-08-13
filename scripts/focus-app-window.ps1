param(
    [string]$ProcessIds = '',
    [string]$ProcessNames = ''
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AgentIslandWindowFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
}
'@

$candidateIds = [System.Collections.Generic.List[int]]::new()
foreach ($rawId in ($ProcessIds -split ',')) {
    $parsed = 0
    if ([int]::TryParse($rawId.Trim(), [ref]$parsed) -and $parsed -gt 0) { $candidateIds.Add($parsed) }
}

# A CLI Agent usually lives below Windows Terminal or a shell. Walk up its parent chain.
foreach ($seedId in @($candidateIds)) {
    $currentId = $seedId
    for ($depth = 0; $depth -lt 8; $depth++) {
        $record = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId"
        if ($null -eq $record -or $record.ParentProcessId -le 0) { break }
        $currentId = [int]$record.ParentProcessId
        if (-not $candidateIds.Contains($currentId)) { $candidateIds.Add($currentId) }
    }
}

$candidateProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
foreach ($processId in $candidateIds) {
    $process = Get-Process -Id $processId
    if ($null -ne $process) { $candidateProcesses.Add($process) }
}

foreach ($processName in ($ProcessNames -split ',' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
    foreach ($process in (Get-Process -Name $processName.Trim() | Sort-Object StartTime -Descending)) {
        if (-not ($candidateProcesses | Where-Object { $_.Id -eq $process.Id })) { $candidateProcesses.Add($process) }
    }
}

$shell = New-Object -ComObject WScript.Shell
foreach ($process in $candidateProcesses) {
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { continue }
    $handle = $process.MainWindowHandle
    $null = [AgentIslandWindowFocus]::ShowWindowAsync($handle, 9)
    $activated = $shell.AppActivate($process.Id)

    if ([AgentIslandWindowFocus]::GetForegroundWindow() -ne $handle) {
        $foreground = [AgentIslandWindowFocus]::GetForegroundWindow()
        $foregroundProcessId = [uint32]0
        $targetProcessId = [uint32]0
        $foregroundThread = if ($foreground -ne [IntPtr]::Zero) { [AgentIslandWindowFocus]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId) } else { 0 }
        $targetThread = [AgentIslandWindowFocus]::GetWindowThreadProcessId($handle, [ref]$targetProcessId)
        $currentThread = [AgentIslandWindowFocus]::GetCurrentThreadId()

        if ($foregroundThread -gt 0) { $null = [AgentIslandWindowFocus]::AttachThreadInput($currentThread, $foregroundThread, $true) }
        if ($targetThread -gt 0 -and $targetThread -ne $currentThread) { $null = [AgentIslandWindowFocus]::AttachThreadInput($currentThread, $targetThread, $true) }
        $null = [AgentIslandWindowFocus]::BringWindowToTop($handle)
        $null = [AgentIslandWindowFocus]::SetActiveWindow($handle)
        $null = [AgentIslandWindowFocus]::SetForegroundWindow($handle)
        $null = [AgentIslandWindowFocus]::SetFocus($handle)
        [AgentIslandWindowFocus]::SwitchToThisWindow($handle, $true)
        if ($targetThread -gt 0 -and $targetThread -ne $currentThread) { $null = [AgentIslandWindowFocus]::AttachThreadInput($currentThread, $targetThread, $false) }
        if ($foregroundThread -gt 0) { $null = [AgentIslandWindowFocus]::AttachThreadInput($currentThread, $foregroundThread, $false) }
        Start-Sleep -Milliseconds 60
        $activated = [AgentIslandWindowFocus]::GetForegroundWindow() -eq $handle
    }
    if ($activated) {
        @{ ok = $true; processId = $process.Id; processName = $process.ProcessName; verifiedForeground = $true } | ConvertTo-Json -Compress
        exit 0
    }
}

@{ ok = $false; error = 'No focusable application window was found.' } | ConvertTo-Json -Compress
exit 2
