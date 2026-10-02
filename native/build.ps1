param([string]$Dotnet = 'dotnet', [switch]$SelfContained, [switch]$ReadyToRun, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$root = Split-Path -Parent $PSScriptRoot
$output = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $root 'dist\native' }
$project = Join-Path $PSScriptRoot 'AgentIsland.Native.csproj'
$self = if ($SelfContained) { 'true' } else { 'false' }
$r2r = if ($ReadyToRun) { 'true' } else { 'false' }
& $Dotnet publish $project -c Release -r win-x64 --self-contained $self -o $output -p:PublishReadyToRun=$r2r -p:PublishSingleFile=false -p:DebugType=None -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
if ($SelfContained) {
    $assets = Get-Content (Join-Path $PSScriptRoot 'obj\project.assets.json') -Raw | ConvertFrom-Json
    $deps = Get-Content (Join-Path $output 'AgentIsland.Native.deps.json') -Raw | ConvertFrom-Json
    foreach ($library in $deps.libraries.PSObject.Properties.Name | Where-Object { $_.StartsWith('runtimepack.') }) {
        $parts = $library.Substring('runtimepack.'.Length).Split('/')
        $package = $parts[0].ToLowerInvariant()
        $source = $null
        foreach ($folder in $assets.packageFolders.PSObject.Properties.Name) {
            $candidate = Join-Path $folder (Join-Path $package $parts[1])
            if (Test-Path -LiteralPath $candidate) { $source = $candidate; break }
        }
        if (-not $source) { throw "Runtime license package not found: $package" }
        $licenseDirectory = Join-Path $output (Join-Path 'licenses' $package)
        New-Item -ItemType Directory -Path $licenseDirectory -Force | Out-Null
        $notices = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -match '^(LICENSE|THIRD-PARTY-NOTICES)' })
        if (-not $notices.Count) { throw "Runtime license missing: $package" }
        foreach ($notice in $notices) { Copy-Item -LiteralPath $notice.FullName -Destination $licenseDirectory }
    }
}
Get-ChildItem -LiteralPath $output -File | Measure-Object -Property Length -Sum | Select-Object Count, Sum
