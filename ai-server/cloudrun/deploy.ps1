#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]+$')]
    [string]$Region = 'asia-northeast3',
    [ValidatePattern('^[a-z][a-z0-9-]{0,47}[a-z0-9]$')]
    [string]$Service = 'horubak-analysis',
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$')]
    [string]$RuntimeServiceAccount,
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9_-]+:[1-9][0-9]*$')]
    [string]$TokenSecretVersion,
    [ValidatePattern('^(|[A-Za-z0-9_-]+:[1-9][0-9]*)$')]
    [string]$GeminiSecretVersion = '',
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$GeminiModel = 'gemini-3.5-flash-lite',
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$analysisSourceDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$analysisSecrets = @("ANALYSIS_SERVICE_TOKEN=$TokenSecretVersion")
if ($GeminiSecretVersion) { $analysisSecrets += "GEMINI_API_KEY=$GeminiSecretVersion" }
$analysisEnvironment = @(
    "GEMINI_MODEL=$GeminiModel", 'WHISPER_MODEL=small', 'WHISPER_DEVICE=cpu',
    'WHISPER_COMPUTE_TYPE=int8', 'WHISPER_CPU_THREADS=1', 'WHISPER_LANGUAGE=ko',
    'WHISPER_LOCAL_FILES_ONLY=true', 'HF_HUB_OFFLINE=1', 'MAX_UPLOAD_BYTES=26214400',
    'MAX_DURATION_SECONDS=3600', 'STT_TIMEOUT_SECONDS=600', 'FFMPEG_TIMEOUT_SECONDS=90'
)
$analysisDeployArguments = @(
    'run', 'deploy', $Service, '--source', $analysisSourceDirectory,
    '--project', $ProjectId, '--region', $Region, '--platform', 'managed',
    '--service-account', $RuntimeServiceAccount,
    '--min', '0', '--max', '1', '--concurrency', '1',
    '--timeout', '900s', '--cpu', '1', '--memory', '2Gi', '--port', '8000',
    '--cpu-throttling', '--no-cpu-boost', '--execution-environment', 'gen2',
    '--allow-unauthenticated', '--ingress', 'all', '--no-use-http2',
    '--startup-probe', 'httpGet.path=/health,httpGet.port=8000,timeoutSeconds=3,periodSeconds=10,failureThreshold=24',
    '--liveness-probe', 'httpGet.path=/health,httpGet.port=8000,timeoutSeconds=3,periodSeconds=30,failureThreshold=3',
    '--update-env-vars', ($analysisEnvironment -join ','),
    '--update-secrets', ($analysisSecrets -join ','), '--quiet'
)

Write-Output "Cloud Run target: $ProjectId / $Region / $Service"
Write-Output 'Profile: minimum 0, maximum 1, concurrency 1, CPU 1, memory 2Gi, request timeout 900s.'
Write-Output 'Public HTTPS ingress uses the Python service bearer token; secrets are referenced by numeric version.'
Write-Output 'Build source contains the Dockerfile and explicitly allowlisted inputs only.'
if (-not $Apply) {
    Write-Output 'Plan only. No cloud APIs, builds, model downloads or deployment changes were made.'
    return
}

$analysisGcloud = (Get-Command gcloud -CommandType Application, ExternalScript -ErrorAction Stop | Select-Object -First 1).Source
& $analysisGcloud @analysisDeployArguments
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run source deployment did not complete successfully.' }
# Deployment metadata only: no analysis endpoint, model or Gemini request.
& $analysisGcloud run services describe $Service --project $ProjectId --region $Region --format 'json(status.latestReadyRevisionName,status.url,status.traffic)'
if ($LASTEXITCODE -ne 0) { throw 'Could not record the Cloud Run deployment metadata.' }
