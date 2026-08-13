[CmdletBinding()]
param(
    [string]$Source = 'generic',
    [Parameter(Mandatory = $true)]
    [string]$Title,
    [string]$Message = '',
    [string[]]$Choices = @('Continue', 'Cancel'),
    [int]$TimeoutSeconds = 600,
    [string]$Endpoint = 'http://127.0.0.1:17321/v1/decisions'
)

$ErrorActionPreference = 'Stop'

$actions = for ($index = 0; $index -lt $Choices.Count; $index++) {
    $label = $Choices[$index]
    [ordered]@{
        id = "choice-$($index + 1)"
        label = $label
        style = if ($index -eq 0) { 'primary' } else { 'secondary' }
    }
}

$payload = [ordered]@{
    source = $Source
    title = $Title
    message = $Message
    actions = $actions
    timeoutMs = $TimeoutSeconds * 1000
    wait = $true
}

try {
    $result = Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType 'application/json; charset=utf-8' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec ($TimeoutSeconds + 5)
    $result | ConvertTo-Json -Depth 8 -Compress
}
catch {
    Write-Error "Agent Island decision request failed. $($_.Exception.Message)"
    exit 1
}
