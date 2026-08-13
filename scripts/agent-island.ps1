[CmdletBinding(DefaultParameterSetName = 'Fields')]
param(
    [Parameter(ParameterSetName = 'Json', Mandatory = $true)]
    [string]$Json,

    [Parameter(ParameterSetName = 'Fields')]
    [ValidateSet('codex', 'claude', 'cursor', 'opencode', 'gemini', 'system', 'generic')]
    [string]$Source = 'generic',

    [Parameter(ParameterSetName = 'Fields')]
    [ValidateSet('working', 'progress', 'success', 'error', 'warning', 'notification')]
    [string]$Type = 'notification',

    [Parameter(ParameterSetName = 'Fields', Mandatory = $true)]
    [string]$Title,

    [Parameter(ParameterSetName = 'Fields')]
    [string]$Message = '',

    [Parameter(ParameterSetName = 'Fields')]
    [ValidateRange(0, 100)]
    [int]$Progress,

    [Parameter(ParameterSetName = 'Fields')]
    [int]$Ttl = 6000,

    [string]$Endpoint = 'http://127.0.0.1:17321/v1/events'
)

$ErrorActionPreference = 'Stop'

try {
    if ($PSCmdlet.ParameterSetName -eq 'Json') {
        $body = $Json
    }
    else {
        $payload = [ordered]@{
            source = $Source
            type = $Type
            title = $Title
            message = $Message
            ttl = $Ttl
        }
        if ($PSBoundParameters.ContainsKey('Progress')) {
            $payload.progress = $Progress
        }
        $body = $payload | ConvertTo-Json -Depth 8 -Compress
    }

    Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 5 | Out-Null
}
catch {
    Write-Error "Agent Island is not reachable at $Endpoint. Start the app first. $($_.Exception.Message)"
    exit 1
}
