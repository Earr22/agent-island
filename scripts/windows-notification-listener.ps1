param(
    [int]$PollMilliseconds = 1200,
    [switch]$RemoveAfterRead,
    [switch]$ClearExisting
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace AgentIsland {
    public static class ClipboardNative {
        [DllImport("user32.dll")]
        public static extern uint GetClipboardSequenceNumber();
    }
}
'@
$null = [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
$listenerType = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications.Management, ContentType = WindowsRuntime]
$notificationKinds = [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime]
$accessStatusType = [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus, Windows.UI.Notifications.Management, ContentType = WindowsRuntime]
$notificationListType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]

function Wait-WinRtOperation {
    param(
        [Parameter(Mandatory = $true)]$Operation,
        [Parameter(Mandatory = $true)][Type]$ResultType
    )

    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.IsGenericMethod -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1).MakeGenericMethod($ResultType)
    $task = $asTask.Invoke($null, @($Operation))
    $null = $task.Wait()
    return $task.Result
}

function Write-JsonLine {
    param([Parameter(Mandatory = $true)]$Value)
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}

function Get-NotificationSnapshot {
    return @(Wait-WinRtOperation -Operation $script:listener.GetNotificationsAsync($notificationKinds::Toast) -ResultType $notificationListType)
}

function Convert-Notification {
    param([Parameter(Mandatory = $true)]$Notification)

    $appName = 'Windows'
    $appUserModelId = ''
    try {
        $candidate = $Notification.AppInfo.DisplayInfo.DisplayName
        if (-not [string]::IsNullOrWhiteSpace($candidate)) { $appName = $candidate }
    } catch {}
    try {
        $candidateId = $Notification.AppInfo.AppUserModelId
        if (-not [string]::IsNullOrWhiteSpace($candidateId)) { $appUserModelId = $candidateId }
    } catch {}

    $texts = @()
    try {
        $binding = $Notification.Notification.Visual.GetBinding('ToastGeneric')
        if ($null -eq $binding) { $binding = $Notification.Notification.Visual.Bindings | Select-Object -First 1 }
        if ($null -ne $binding) {
            $texts = @($binding.GetTextElements() | ForEach-Object { $_.Text } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }
    } catch {}

        $title = if ($texts.Count -gt 0) { [string]$texts[0] } else { "$appName notification" }
    $message = if ($texts.Count -gt 1) { [string]($texts[1..($texts.Count - 1)] -join ' · ') } else { '' }
    $created = try { $Notification.CreationTime.ToString('o') } catch { [DateTimeOffset]::Now.ToString('o') }

    return [ordered]@{
        kind = 'notification'
        id = [uint32]$Notification.Id
        appName = $appName
        appUserModelId = $appUserModelId
        title = $title
        message = $message
        createdAt = $created
    }
}

$listener = $listenerType::Current
$access = $listener.GetAccessStatus()
if ($access -eq $accessStatusType::Unspecified) {
    try {
        $access = Wait-WinRtOperation -Operation $listener.RequestAccessAsync() -ResultType $accessStatusType
    } catch {}
}

Write-JsonLine ([ordered]@{ kind = 'status'; access = [string]$access })
if ($access -ne $accessStatusType::Allowed) { exit 2 }

$seen = [System.Collections.Generic.HashSet[string]]::new()
$clipboardSequence = [AgentIsland.ClipboardNative]::GetClipboardSequenceNumber()
$initial = Get-NotificationSnapshot
foreach ($notification in $initial) {
    $key = "$($notification.Id):$($notification.CreationTime.ToUniversalTime().Ticks)"
    $null = $seen.Add($key)
    if ($ClearExisting) {
        try { $listener.RemoveNotification([uint32]$notification.Id) } catch {}
    }
}

while ($true) {
    try {
        $nextClipboardSequence = [AgentIsland.ClipboardNative]::GetClipboardSequenceNumber()
        if ($nextClipboardSequence -ne $clipboardSequence) {
            $clipboardSequence = $nextClipboardSequence
            Write-JsonLine ([ordered]@{ kind = 'clipboard-changed'; sequence = $clipboardSequence })
        }

        foreach ($notification in (Get-NotificationSnapshot)) {
            $key = "$($notification.Id):$($notification.CreationTime.ToUniversalTime().Ticks)"
            if (-not $seen.Add($key)) { continue }

            Write-JsonLine (Convert-Notification -Notification $notification)
            if ($RemoveAfterRead) {
                try { $listener.RemoveNotification([uint32]$notification.Id) } catch {}
            }
        }

        if ($seen.Count -gt 4096) { $seen.Clear() }
    } catch {
        Write-JsonLine ([ordered]@{ kind = 'error'; message = $_.Exception.Message })
    }
    Start-Sleep -Milliseconds ([Math]::Max(200, $PollMilliseconds))
}
