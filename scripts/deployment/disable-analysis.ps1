#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$WranglerPath,
    [ValidatePattern('^$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')]
    [string]$ExpectedCurrentWorkerVersion = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$analysisAccount = '2eb0b2e89370b1d4f23f4f98fbee4ce6'
$analysisWorker = 'horubak-auth-test'
$analysisSecret = 'ANALYSIS_BASE_URL'

Write-Output "Target: $analysisWorker / account $analysisAccount"
Write-Output "Action: delete the $analysisSecret Worker secret to disable private analysis requests."
Write-Output 'Pages, database contents, Google login secrets and the separate cloud service are retained.'
if (-not $Apply) {
    Write-Output 'Plan only. No network requests or configuration changes were made.'
    Write-Output 'To execute, pass -Apply and -ExpectedCurrentWorkerVersion with the recorded active version.'
    Write-Output 'Wrangler uses its existing authentication. No credential files are read by this script.'
    return
}
if ([string]::IsNullOrEmpty($ExpectedCurrentWorkerVersion)) {
    throw 'An expected active Worker version is required. Record deployment status before applying this action.'
}

$analysisTool = if ($WranglerPath) { $WranglerPath } else { 'wrangler' }
$analysisNode = $null
if (Test-Path -LiteralPath $analysisTool -PathType Leaf) {
    $analysisCommand = (Resolve-Path -LiteralPath $analysisTool).Path
    if ([IO.Path]::GetExtension($analysisCommand) -in @('.js', '.cjs', '.mjs')) {
        $analysisNode = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    }
} else {
    $analysisResolved = Get-Command -Name $analysisTool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $analysisResolved) { throw 'Wrangler was not found. Provide -WranglerPath. No changes were made.' }
    $analysisCommand = $analysisResolved.Source
}

function Invoke-AnalysisWrangler([string[]]$Arguments) {
    $global:LASTEXITCODE = 0
    if ($analysisNode) { & $analysisNode $analysisCommand @Arguments }
    else { & $analysisCommand @Arguments }
    if ($LASTEXITCODE -ne 0) { throw 'Wrangler reported a failure. Inspect deployment status before retrying.' }
}

$analysisPreviousAccount = $env:CLOUDFLARE_ACCOUNT_ID
try {
    $env:CLOUDFLARE_ACCOUNT_ID = $analysisAccount
    try {
        $analysisStatus = ((Invoke-AnalysisWrangler -Arguments @('deployments', 'status', '--name', $analysisWorker, '--json')) -join "`n") | ConvertFrom-Json
        $analysisVersions = @($analysisStatus.versions)
        if ($analysisVersions.Count -ne 1 -or $analysisVersions[0].percentage -ne 100 -or $analysisVersions[0].version_id -ne $ExpectedCurrentWorkerVersion) {
            throw 'Unexpected Worker version or traffic split.'
        }
        $analysisSecrets = @(((Invoke-AnalysisWrangler -Arguments @('secret', 'list', '--name', $analysisWorker, '--format', 'json')) -join "`n") | ConvertFrom-Json)
        if ($analysisSecret -notin @($analysisSecrets | ForEach-Object { $_.name })) {
            throw 'The expected secret does not exist. A plain-text variable or an already-disabled configuration needs separate inspection.'
        }
    } catch {
        throw 'Worker version or analysis-secret metadata did not match the expected configuration. No deletion was attempted.'
    }

    # Wrangler 4.160.1 has no --yes option for secret delete. Its own
    # confirmation remains in place; -Apply authorizes this script's change.
    Invoke-AnalysisWrangler -Arguments @('secret', 'delete', $analysisSecret, '--name', $analysisWorker)

    try {
        $analysisRemaining = @(((Invoke-AnalysisWrangler -Arguments @('secret', 'list', '--name', $analysisWorker, '--format', 'json')) -join "`n") | ConvertFrom-Json)
        if ($analysisSecret -in @($analysisRemaining | ForEach-Object { $_.name })) {
            throw 'Secret deletion was not confirmed.'
        }
        $analysisAfter = ((Invoke-AnalysisWrangler -Arguments @('deployments', 'status', '--name', $analysisWorker, '--json')) -join "`n") | ConvertFrom-Json
        $analysisAfterVersions = @($analysisAfter.versions)
        if ($analysisAfterVersions.Count -ne 1 -or $analysisAfterVersions[0].percentage -ne 100) {
            throw 'The active Worker version could not be recorded.'
        }
        Write-Output "Analysis endpoint secret removed. Active Worker version: $($analysisAfterVersions[0].version_id)"
        Write-Output 'Record this version for rollback-demo.ps1 -ExpectedCurrentWorkerVersion before any full rollback.'
        Write-Output 'Pause or resume the separate analysis cloud service through its provider when appropriate; it was not modified.'
    } catch {
        throw 'Analysis configuration may have changed, but final metadata was not confirmed. Inspect Worker settings and deployment status before retrying.'
    }
} finally {
    if ($null -eq $analysisPreviousAccount) { Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue }
    else { $env:CLOUDFLARE_ACCOUNT_ID = $analysisPreviousAccount }
}
