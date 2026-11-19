#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$WranglerPath,
    [ValidatePattern('^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')]
    [string]$ExpectedCurrentWorkerVersion = '28b5b036-8d5d-45ad-a748-5b325abd47aa'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Immutable production baseline recorded before the 2026-11-20 integration.
$rollbackAccountId = '2eb0b2e89370b1d4f23f4f98fbee4ce6'
$rollbackProject = 'horubak'
$rollbackPagesId = '516945b0-7122-485c-8b40-293ae0078395'
$rollbackWorker = 'horubak-auth-test'
$rollbackWorkerVersion = 'a89a827b-4bcd-468f-857e-8755542f5cd5'
$rollbackExpectedPagesId = '6d3fb91c-72cf-4d3d-90f7-69f914ab7c11'
$rollbackEndpoint = [Uri]"https://api.cloudflare.com/client/v4/accounts/$rollbackAccountId/pages/projects/$rollbackProject/deployments/$rollbackPagesId/rollback"
$rollbackProjectEndpoint = [Uri]"https://api.cloudflare.com/client/v4/accounts/$rollbackAccountId/pages/projects/$rollbackProject"
$rollbackDashboard = "https://dash.cloudflare.com/$rollbackAccountId/pages/view/$rollbackProject"

Write-Output "Pages target: $rollbackPagesId (https://516945b0.horubak.pages.dev)"
Write-Output "Worker target: $rollbackWorker / $rollbackWorkerVersion"
Write-Output "Expected current release: Pages $rollbackExpectedPagesId / Worker $ExpectedCurrentWorkerVersion"
Write-Output 'Order: Pages first, then Worker. Database contents are retained.'

if (-not $Apply) {
    Write-Output 'Plan only. No network requests or deployment changes were made.'
    Write-Output 'To execute later, provide CLOUDFLARE_API_TOKEN in this process and rerun with -Apply.'
    Write-Output 'If Wrangler is not on PATH, also pass -WranglerPath to its executable or JavaScript entrypoint.'
    Write-Output "Browser alternative for the Pages step: $rollbackDashboard"
    return
}

# Do not read Wrangler credential files or attempt to extract browser sessions.
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
    throw "CLOUDFLARE_API_TOKEN is not set. No rollback was attempted. Use the logged-in Pages dashboard if an API token is unavailable: $rollbackDashboard"
}
if ($rollbackEndpoint.Scheme -ne 'https' -or $rollbackEndpoint.Host -ne 'api.cloudflare.com' -or $rollbackEndpoint.AbsolutePath -ne "/client/v4/accounts/$rollbackAccountId/pages/projects/$rollbackProject/deployments/$rollbackPagesId/rollback") {
    throw 'The fixed Cloudflare rollback endpoint did not pass validation.'
}

# Resolve the Worker tool before changing Pages, so a missing CLI causes no
# partial rollback. An explicit JavaScript entrypoint is run with Node directly.
$rollbackTool = if ($WranglerPath) { $WranglerPath } else { 'wrangler' }
$rollbackCommand = $null
$rollbackNode = $null
if (Test-Path -LiteralPath $rollbackTool -PathType Leaf) {
    $rollbackCommand = (Resolve-Path -LiteralPath $rollbackTool).Path
    if ([IO.Path]::GetExtension($rollbackCommand) -in @('.js', '.cjs', '.mjs')) {
        $rollbackNode = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    }
} else {
    $rollbackResolved = Get-Command -Name $rollbackTool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $rollbackResolved) { throw 'Wrangler was not found. No rollback was attempted. Provide -WranglerPath.' }
    $rollbackCommand = $rollbackResolved.Source
}

function Invoke-RollbackWrangler([string[]]$Arguments) {
    $rollbackPreviousAccount = $env:CLOUDFLARE_ACCOUNT_ID
    try {
        $env:CLOUDFLARE_ACCOUNT_ID = $rollbackAccountId
        $global:LASTEXITCODE = 0
        if ($rollbackNode) { & $rollbackNode $rollbackCommand @Arguments }
        else { & $rollbackCommand @Arguments }
        if ($LASTEXITCODE -ne 0) { throw 'Wrangler returned a failure exit code.' }
    } finally {
        if ($null -eq $rollbackPreviousAccount) { Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue }
        else { $env:CLOUDFLARE_ACCOUNT_ID = $rollbackPreviousAccount }
    }
}

# This is a deployment-state check, not an application functionality test.
# Refuse unknown or split-traffic versions before changing either service.
try {
    $rollbackStatusText = Invoke-RollbackWrangler -Arguments @('deployments', 'status', '--name', $rollbackWorker, '--json')
    $rollbackStatus = ($rollbackStatusText -join "`n") | ConvertFrom-Json
    $rollbackActiveVersions = @($rollbackStatus.versions)
    if ($rollbackActiveVersions.Count -ne 1 -or $rollbackActiveVersions[0].percentage -ne 100 -or $rollbackActiveVersions[0].version_id -notin @($ExpectedCurrentWorkerVersion, $rollbackWorkerVersion)) {
        throw 'Unexpected Worker version or traffic split.'
    }
    $rollbackCurrentWorker = [string]$rollbackActiveVersions[0].version_id
} catch {
    throw 'Worker deployment does not match the expected release or baseline. No Pages rollback was attempted. Inspect the active deployment before continuing.'
}

$rollbackHeaders = @{ Authorization = 'Bearer ' + $env:CLOUDFLARE_API_TOKEN }
try {
    $rollbackProjectResult = Invoke-RestMethod -Method Get -Uri $rollbackProjectEndpoint -Headers $rollbackHeaders -MaximumRedirection 0 -TimeoutSec 60
    if ($rollbackProjectResult.success -ne $true) { throw 'Pages project lookup failed.' }
    $rollbackCurrentPages = [string]$rollbackProjectResult.result.canonical_deployment.id
    if ($rollbackCurrentPages -notin @($rollbackExpectedPagesId, $rollbackPagesId)) { throw 'Unexpected Pages production deployment.' }
    if ($rollbackCurrentPages -eq $rollbackPagesId) {
        Write-Output 'Pages is already at the baseline. No Pages change is needed.'
    } else {
        $rollbackResult = Invoke-RestMethod -Method Post -Uri $rollbackEndpoint -Headers $rollbackHeaders -MaximumRedirection 0 -TimeoutSec 60
        if ($rollbackResult.success -ne $true -or $rollbackResult.result.id -ne $rollbackPagesId) { throw 'Cloudflare did not confirm the expected Pages deployment.' }
    }
} catch {
    # Do not print the response: deployment responses can contain environment
    # configuration. If Pages fails, do not attempt the Worker step.
    throw "Pages rollback was not confirmed. Worker rollback was not attempted. Check $rollbackDashboard before retrying."
} finally {
    $rollbackHeaders.Clear()
}

Write-Output "Pages rollback confirmed: $rollbackPagesId"
if ($rollbackCurrentWorker -eq $rollbackWorkerVersion) {
    Write-Output 'Worker is already at the baseline. No Worker change is needed.'
    return
}
try {
    $rollbackArguments = @('rollback', $rollbackWorkerVersion, '--name', $rollbackWorker, '--message', 'Restore pre-integration demo baseline recorded 2026-11-20', '--yes', '--durable-objects-code-update-mode', 'immediate')
    Invoke-RollbackWrangler -Arguments $rollbackArguments
} catch {
    throw 'Pages was rolled back, but the Worker step failed. Keep Pages at the baseline and inspect the Worker deployment before retrying.'
}
Write-Output "Worker rollback command completed for version $rollbackWorkerVersion. Review Cloudflare deployment status before resuming release work."
