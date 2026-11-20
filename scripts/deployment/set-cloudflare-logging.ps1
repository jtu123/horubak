#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Enable', 'Disable')]
    [string]$Mode = 'Enable',
    [switch]$Apply,
    [string]$WranglerPath,
    [ValidatePattern('^$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')]
    [string]$ExpectedCurrentWorkerVersion = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$loggingAccount = '2eb0b2e89370b1d4f23f4f98fbee4ce6'
$loggingWorker = 'horubak-auth-test'
$loggingPresetName = if ($Mode -eq 'Enable') { 'cloudflare-logs-enabled.toml' } else { 'cloudflare-logs-disabled.toml' }
$loggingPreset = Join-Path $PSScriptRoot $loggingPresetName

Write-Output "Target: $loggingWorker / account $loggingAccount"
Write-Output "Logging mode: $Mode / preset: $loggingPresetName"
Write-Output 'The current Worker code version remains at 100%; only non-versioned observability settings are synchronized.'
Write-Output 'Query strings are redacted. Traces and issues stay disabled. Disabling logging does not delete previous logs.'
if (-not $Apply) {
    Write-Output 'Plan only. No network requests or configuration changes were made.'
    Write-Output 'To execute, pass -Apply and -ExpectedCurrentWorkerVersion with the recorded single active version.'
    Write-Output 'Wrangler uses its existing authentication. No credential files or secret values are read by this script.'
    return
}
if ([string]::IsNullOrEmpty($ExpectedCurrentWorkerVersion)) {
    throw 'An expected active Worker version is required. No configuration change was attempted.'
}
if (-not (Test-Path -LiteralPath $loggingPreset -PathType Leaf)) {
    throw 'The fixed observability preset is missing. No configuration change was attempted.'
}
$loggingPreset = (Resolve-Path -LiteralPath $loggingPreset).Path

$loggingTool = if ($WranglerPath) { $WranglerPath } else { 'wrangler' }
$loggingNode = $null
if (Test-Path -LiteralPath $loggingTool -PathType Leaf) {
    $loggingCommand = (Resolve-Path -LiteralPath $loggingTool).Path
    if ([IO.Path]::GetExtension($loggingCommand) -in @('.js', '.cjs', '.mjs')) {
        $loggingNode = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    }
} else {
    $loggingResolved = Get-Command -Name $loggingTool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $loggingResolved) { throw 'Wrangler was not found. Provide -WranglerPath. No configuration change was attempted.' }
    $loggingCommand = $loggingResolved.Source
}

function Invoke-LoggingWrangler([string[]]$Arguments) {
    $global:LASTEXITCODE = 0
    $loggingOutput = if ($loggingNode) { & $loggingNode $loggingCommand @Arguments 2>&1 } else { & $loggingCommand @Arguments 2>&1 }
    if ($LASTEXITCODE -ne 0) {
        throw 'Wrangler returned a failure. Inspect deployment and observability metadata before retrying.'
    }
    return $loggingOutput
}

function Assert-LoggingWorkerVersion {
    $loggingStatusText = Invoke-LoggingWrangler -Arguments @('deployments', 'status', '--name', $loggingWorker, '--json')
    $loggingStatus = ($loggingStatusText -join "`n") | ConvertFrom-Json -ErrorAction Stop
    $loggingVersions = @($loggingStatus.versions)
    if ($loggingVersions.Count -ne 1 -or $loggingVersions[0].percentage -ne 100 -or $loggingVersions[0].version_id -ne $ExpectedCurrentWorkerVersion) {
        throw 'Unexpected Worker version or traffic split.'
    }
}

$loggingEnvironmentNames = @('CLOUDFLARE_ACCOUNT_ID', 'WRANGLER_LOG', 'WRANGLER_LOG_SANITIZE', 'WRANGLER_WRITE_LOGS', 'WRANGLER_SEND_METRICS')
$loggingPreviousEnvironment = @{}
foreach ($loggingName in $loggingEnvironmentNames) {
    $loggingPreviousEnvironment[$loggingName] = [Environment]::GetEnvironmentVariable($loggingName, 'Process')
}
try {
    $env:CLOUDFLARE_ACCOUNT_ID = $loggingAccount
    # The status --json command emits JSON at the "log" level; "info" suppresses it.
    $env:WRANGLER_LOG = 'log'
    $env:WRANGLER_LOG_SANITIZE = 'true'
    $env:WRANGLER_WRITE_LOGS = 'false'
    $env:WRANGLER_SEND_METRICS = 'false'
    try {
        Assert-LoggingWorkerVersion
    } catch {
        throw 'The active Worker does not match the expected single 100% version. No observability change was attempted.'
    }

    # versions deploy reuses an existing code version. Its non-versioned settings
    # synchronization patches only settings present in this observability preset.
    $loggingVersionSpec = '{0}@100' -f $ExpectedCurrentWorkerVersion
    $loggingArguments = @('versions', 'deploy', $loggingVersionSpec, '--config', $loggingPreset, '--name', $loggingWorker, '--yes', '--message', "Set Cloudflare logging mode to $Mode without changing Worker code")
    try {
        $loggingDeployOutput = Invoke-LoggingWrangler -Arguments $loggingArguments
        $loggingDeployOutput = $null
    } catch {
        throw 'The logging configuration command was not confirmed. Inspect deployment and observability metadata before retrying.'
    }
    try {
        Assert-LoggingWorkerVersion
    } catch {
        throw 'Logging settings may have changed, but the final active Worker version was not confirmed. Inspect metadata before further changes.'
    }
    Write-Output "Cloudflare accepted logging mode $Mode. Active Worker version remains $ExpectedCurrentWorkerVersion at 100%."
    Write-Output 'No Worker code was uploaded. Confirm observability metadata separately; no application functionality test was run.'
} finally {
    foreach ($loggingName in $loggingEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($loggingName, $loggingPreviousEnvironment[$loggingName], 'Process')
    }
}
