param(
    [Parameter(Position = 0)]
    [string]$NotificationJson,
    [string]$Endpoint = 'http://127.0.0.1:17321/hooks/codex'
)

# Codex `notify` passes one JSON argument. Lifecycle command hooks pass JSON on stdin.
# This bridge accepts both forms and intentionally stays silent if Agent Island is closed.
if ([string]::IsNullOrWhiteSpace($NotificationJson)) {
    $NotificationJson = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($NotificationJson)) { exit 0 }

try {
    $null = $NotificationJson | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType 'application/json; charset=utf-8' -Body $NotificationJson -TimeoutSec 5 | Out-Null
}
catch {
    exit 0
}

exit 0
