param(
    [string]$Dotnet = 'dotnet',
    [string]$Python = 'python',
    [string]$Ffmpeg,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$captureRoot = Join-Path $projectRoot ('artifacts\showcase-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
$buildRoot = Join-Path $captureRoot 'build'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'docs\images' }
& (Join-Path $projectRoot 'native\build.ps1') -Dotnet $Dotnet -OutputDirectory $buildRoot
if ($LASTEXITCODE -ne 0) { throw 'Showcase build failed' }
$process = Start-Process -FilePath (Join-Path $buildRoot 'AgentIsland.Native.exe') -ArgumentList @('--render-showcase', ('--output="' + $captureRoot + '"')) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'Isolated showcase render failed; inspect the local artifacts folder.' }
$encodeArguments = @((Join-Path $PSScriptRoot 'encode-showcase.py'), $captureRoot, $OutputDirectory)
if ($Ffmpeg) { $encodeArguments += @('--ffmpeg', $Ffmpeg) }
& $Python @encodeArguments
if ($LASTEXITCODE -ne 0) { throw 'Showcase encoding failed' }
