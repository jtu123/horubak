#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$AnalysisOrigin,
    [Parameter(Mandatory)] [string]$EncryptedTokenPath,
    [Parameter(Mandatory)] [string]$ProtectedPrivateKeyPath,
    [string]$WranglerPath,
    [ValidatePattern('^$|^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')]
    [string]$ExpectedCurrentWorkerVersion = '',
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$connectAccount = '2eb0b2e89370b1d4f23f4f98fbee4ce6'
$connectWorker = 'horubak-auth-test'
$connectUri = $null
if (-not [Uri]::TryCreate($AnalysisOrigin, [UriKind]::Absolute, [ref]$connectUri) -or
    $connectUri.Scheme -ne 'https' -or $connectUri.Port -ne 443 -or
    $connectUri.Host -notmatch '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.run\.app$' -or
    $connectUri.UserInfo -or $connectUri.Query -or $connectUri.Fragment -or $connectUri.AbsolutePath -ne '/') {
    throw 'Provide a Google Cloud Run HTTPS origin without credentials, a custom port, path, query or fragment.'
}
$connectOrigin = $connectUri.GetLeftPart([UriPartial]::Authority)
Write-Output "Target: $connectWorker / account $connectAccount"
Write-Output "Analysis origin: $connectOrigin"
Write-Output 'Secrets: ANALYSIS_BASE_URL and ANALYSIS_SERVICE_TOKEN. Secret values are not printed.'
if (-not $Apply) {
    Write-Output 'Plan only. No encrypted files were read and no network requests or configuration changes were made.'
    Write-Output 'To activate, pass -Apply and the recorded active Worker version through -ExpectedCurrentWorkerVersion.'
    return
}
if ([string]::IsNullOrEmpty($ExpectedCurrentWorkerVersion)) {
    throw 'An expected active Worker version is required before activation.'
}
if (-not $IsWindows) { throw 'This bridge requires Windows DPAPI for the current user.' }

$connectTool = if ($WranglerPath) { $WranglerPath } else { 'wrangler' }
$connectNode = $null
if (Test-Path -LiteralPath $connectTool -PathType Leaf) {
    $connectCommand = (Resolve-Path -LiteralPath $connectTool).Path
    if ([IO.Path]::GetExtension($connectCommand) -in @('.js', '.cjs', '.mjs')) {
        $connectNode = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    }
} else {
    $connectResolved = Get-Command -Name $connectTool -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connectResolved) { throw 'Wrangler was not found. Provide -WranglerPath. No changes were made.' }
    $connectCommand = $connectResolved.Source
}

$connectEnvironmentNames = @('CLOUDFLARE_ACCOUNT_ID', 'WRANGLER_LOG_SANITIZE', 'WRANGLER_LOG', 'WRANGLER_SEND_METRICS')
$connectPreviousEnvironment = @{}
foreach ($connectName in $connectEnvironmentNames) {
    $connectPreviousEnvironment[$connectName] = [Environment]::GetEnvironmentVariable($connectName, 'Process')
}
$connectProtectedBytes = $null
$connectPrivateBytes = $null
$connectCipherBytes = $null
$connectTokenBytes = $null
$connectToken = $null
$connectPayload = $null
try {
    $env:CLOUDFLARE_ACCOUNT_ID = $connectAccount
    $env:WRANGLER_LOG_SANITIZE = 'true'
    $env:WRANGLER_LOG = 'info'
    $env:WRANGLER_SEND_METRICS = 'false'
    try {
        $connectArguments = @('deployments', 'status', '--name', $connectWorker, '--json')
        $global:LASTEXITCODE = 0
        $connectStatusText = if ($connectNode) { & $connectNode $connectCommand @connectArguments } else { & $connectCommand @connectArguments }
        if ($LASTEXITCODE -ne 0) { throw 'Could not read deployment metadata.' }
        $connectStatus = ($connectStatusText -join "`n") | ConvertFrom-Json
        $connectVersions = @($connectStatus.versions)
        if ($connectVersions.Count -ne 1 -or $connectVersions[0].percentage -ne 100 -or $connectVersions[0].version_id -ne $ExpectedCurrentWorkerVersion) {
            throw 'Unexpected Worker version or traffic split.'
        }
    } catch {
        throw 'The active Worker does not match the expected release. No secrets were read or changed.'
    }
    $env:WRANGLER_LOG = 'error'

    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    if (-not ('Horubak.AnalysisSecretBridge' -as [type])) {
        # Static helper code contains no key or token material. The C# bridge
        # handles ImportPkcs8PrivateKey's span parameter on PowerShell 7.
        Add-Type -TypeDefinition @'
using System;
using System.Security.Cryptography;
using System.Text;
namespace Horubak {
    public static class AnalysisSecretBridge {
        public static byte[] Decrypt(byte[] privateKey, byte[] ciphertext) {
            using (RSA rsa = RSA.Create()) {
                int consumed;
                rsa.ImportPkcs8PrivateKey(privateKey, out consumed);
                if (consumed != privateKey.Length || rsa.KeySize < 2048) {
                    throw new CryptographicException("Invalid private key.");
                }
                byte[] decoded = null;
                try {
                    if (ciphertext.Length != rsa.KeySize / 8) {
                        decoded = Convert.FromBase64String(Encoding.ASCII.GetString(ciphertext));
                    }
                    return rsa.Decrypt(decoded ?? ciphertext, RSAEncryptionPadding.OaepSHA256);
                } finally {
                    if (decoded != null) Array.Clear(decoded, 0, decoded.Length);
                }
            }
        }
    }
}
'@
    }
    try {
        $connectProtectedBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ProtectedPrivateKeyPath).Path)
        $connectPrivateBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($connectProtectedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $connectCipherBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $EncryptedTokenPath).Path)
        $connectTokenBytes = [Horubak.AnalysisSecretBridge]::Decrypt($connectPrivateBytes, $connectCipherBytes)
        if ($connectTokenBytes.Length -lt 32 -or $connectTokenBytes.Length -gt 512 -or @($connectTokenBytes | Where-Object { $_ -lt 33 -or $_ -gt 126 }).Count -gt 0) {
            throw 'Invalid service token.'
        }
        $connectToken = [Text.Encoding]::ASCII.GetString($connectTokenBytes)
        $connectPayload = @{ ANALYSIS_BASE_URL = $connectOrigin; ANALYSIS_SERVICE_TOKEN = $connectToken } | ConvertTo-Json -Compress
    } catch {
        throw 'The protected key or encrypted token could not be decoded. No plaintext secret file was written and no activation was attempted.'
    }

    # Secret values only cross the child process stdin. Wrangler's bulk command
    # accepts stdin JSON, merges only the supplied keys, and has no --yes flag.
    # Sanitized logging is forced above. Suppress child output and raw errors.
    $connectArguments = @('secret', 'bulk', '--name', $connectWorker)
    $global:LASTEXITCODE = 0
    if ($connectNode) { $connectPayload | & $connectNode $connectCommand @connectArguments *> $null }
    else { $connectPayload | & $connectCommand @connectArguments *> $null }
    if ($LASTEXITCODE -ne 0) {
        throw 'Cloudflare secret activation was not confirmed. Inspect deployment metadata before retrying; no secret value is included in this error.'
    }
    Write-Output 'Cloudflare accepted the analysis connection secret update. Record the new active Worker version before release or rollback.'
} finally {
    foreach ($connectBytes in @($connectProtectedBytes, $connectPrivateBytes, $connectCipherBytes, $connectTokenBytes)) {
        if ($null -ne $connectBytes) { [Array]::Clear($connectBytes, 0, $connectBytes.Length) }
    }
    $connectPayload = $null
    $connectToken = $null
    $connectTokenBytes = $null
    $connectPrivateBytes = $null
    foreach ($connectName in $connectEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($connectName, $connectPreviousEnvironment[$connectName], 'Process')
    }
}
