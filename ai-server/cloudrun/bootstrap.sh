#!/usr/bin/env bash
# Cloud Shell bootstrap. No inference or provider calls are used as tests.
set +x
set -euo pipefail
umask 077
project=''; bridge_key=''; apply=0
region="${HORUBAK_REGION:-asia-northeast3}"
service="${HORUBAK_SERVICE:-horubak-analysis}"
while (($#)); do
  case "$1" in
    --project) project="${2:?project required}"; shift 2 ;;
    --bridge-public-key) bridge_key="${2:?public key path required}"; shift 2 ;;
    --region) region="${2:?region required}"; shift 2 ;;
    --apply) apply=1; shift ;;
    *) printf 'Unknown bootstrap option\n' >&2; exit 2 ;;
  esac
done
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { printf 'Explicit valid --project is required\n' >&2; exit 2; }
[[ "$region" =~ ^[a-z]+-[a-z]+[0-9]+$ && "$service" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]] || exit 2
[[ -n "$bridge_key" && -f "$bridge_key" ]] || { printf 'Explicit --bridge-public-key file is required\n' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_dir="$(cd -- "$script_dir/.." && pwd -P)"
printf 'Target: %s / %s / %s\n' "$project" "$region" "$service"
printf 'CPU1 memory2Gi, minimum0 maximum1, concurrency1, timeout900s. Cloud Build source deployment.\n'
printf 'Builder: horubak-analysis-build; project role roles/run.builder.\n'
printf 'Runtime: horubak-analysis-runtime; read only the two app secrets.\n'
printf 'Public HTTPS ingress; Python requires bearer authentication for analysis.\n'
if (( ! apply )); then printf 'Plan only; pass --apply to enable APIs, configure app accounts/secrets and deploy.\n'; exit 0; fi
command -v gcloud >/dev/null; command -v openssl >/dev/null; command -v python3 >/dev/null
openssl pkey -pubin -in "$bridge_key" -noout >/dev/null
export CLOUDSDK_CORE_LOG_HTTP=false CLOUDSDK_CORE_VERBOSITY=warning CLOUDSDK_CORE_DISABLE_PROMPTS=1
gc() { gcloud --project "$project" --quiet "$@"; }
number="$(gc projects describe "$project" --format='value(projectNumber)')"
[[ "$number" =~ ^[0-9]+$ ]] || exit 1
if [[ -n "${HORUBAK_EXPECTED_PROJECT_NUMBER:-}" && "$number" != "$HORUBAK_EXPECTED_PROJECT_NUMBER" ]]; then printf 'Project number mismatch\n' >&2; exit 1; fi
gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com logging.googleapis.com storage.googleapis.com
builder="horubak-analysis-build@$project.iam.gserviceaccount.com"
runtime="horubak-analysis-runtime@$project.iam.gserviceaccount.com"
for kind in build runtime; do
  email="horubak-analysis-$kind@$project.iam.gserviceaccount.com"
  found="$(gc iam service-accounts list --filter="email=$email" --format='value(email)')"
  if [[ -z "$found" ]]; then gc iam service-accounts create "horubak-analysis-$kind" --display-name="Horubak analysis $kind" >/dev/null; fi
done
# Official source-build role, scoped to this project and dedicated builder.
gc projects add-iam-policy-binding "$project" --member="serviceAccount:$builder" --role=roles/run.builder --condition=None --format='value(etag)' >/dev/null
token_secret=horubak-analysis-service-token
gemini_secret=horubak-gemini-api-key
for secret in "$token_secret" "$gemini_secret"; do
  found="$(gc secrets list --filter="name:$secret" --format='value(name)' | while IFS= read -r item; do [[ "${item##*/}" == "$secret" ]] && printf '%s\n' "$item" || true; done)"
  if [[ -z "$found" ]]; then gc secrets create "$secret" --replication-policy=automatic --labels=app=horubak,component=analysis >/dev/null; fi
  gc secrets add-iam-policy-binding "$secret" --member="serviceAccount:$runtime" --role=roles/secretmanager.secretAccessor --condition=None --format='value(etag)' >/dev/null
done
latest_version() { gc secrets versions list "$1" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)'; }
token_version="$(latest_version "$token_secret")"
if [[ -z "$token_version" ]]; then
  service_token="$(openssl rand -hex 32)"
  token_version="$(printf '%s' "$service_token" | gc secrets versions add "$token_secret" --data-file=- --format='value(name)')"
  unset service_token
fi
token_version="${token_version##*/}"
[[ "$token_version" =~ ^[1-9][0-9]*$ ]] || { printf 'Token version is unavailable\n' >&2; exit 1; }
service_token="$(gc secrets versions access "$token_version" --secret "$token_secret" --verbosity=error)"
[[ "$service_token" =~ ^[a-f0-9]{64}$ ]] || { unset service_token; printf 'Existing service token has an unexpected format\n' >&2; exit 1; }
trap 'unset service_token' EXIT
printf '%s' "$service_token" | openssl pkeyutl -encrypt -pubin -inkey "$bridge_key" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -out "$script_dir/service-token.rsa"
unset service_token
gemini_version="$(latest_version "$gemini_secret")"; gemini_version="${gemini_version##*/}"
secrets="ANALYSIS_SERVICE_TOKEN=$token_secret:$token_version"
if [[ -n "$gemini_version" ]]; then
  [[ "$gemini_version" =~ ^[1-9][0-9]*$ ]] || exit 1
  secrets+=",GEMINI_API_KEY=$gemini_secret:$gemini_version"
else printf 'Gemini key has no enabled version; Gemini analysis remains pending.\n'; fi
# Capture only deployment metadata, not environment values or secret contents.
existing_service="$(gc run services list --region "$region" --filter="metadata.name=$service" --format='value(metadata.name)')"
if [[ -n "$existing_service" ]]; then
  gc run services describe "$service" --region "$region" --format='json(metadata.name,metadata.labels,status.url,status.latestReadyRevisionName,status.traffic)' >"$script_dir/prior-deployment.json"
  python3 - "$script_dir/prior-deployment.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
if d.get('metadata', {}).get('labels', {}).get('app') != 'horubak':
    raise SystemExit('Existing service has unexpected ownership labels; stopping before deployment')
PY
else
  printf '{"exists":false}\n' >"$script_dir/prior-deployment.json"
fi
gc run deploy "$service" --source "$source_dir" --region "$region" --platform managed \
  --service-account "$runtime" --build-service-account "projects/$project/serviceAccounts/$builder" \
  --min 0 --max 1 --concurrency 1 --timeout 900s --cpu 1 --memory 2Gi --port 8000 \
  --cpu-throttling --no-cpu-boost --execution-environment gen2 --allow-unauthenticated --ingress all --no-use-http2 \
  --labels app=horubak,component=analysis \
  --startup-probe httpGet.path=/health,httpGet.port=8000,timeoutSeconds=3,periodSeconds=10,failureThreshold=24 \
  --liveness-probe httpGet.path=/health,httpGet.port=8000,timeoutSeconds=3,periodSeconds=30,failureThreshold=3 \
  --update-env-vars GEMINI_MODEL=gemini-3.5-flash-lite,WHISPER_MODEL=small,WHISPER_DEVICE=cpu,WHISPER_COMPUTE_TYPE=int8,WHISPER_CPU_THREADS=1,WHISPER_LANGUAGE=ko,WHISPER_LOCAL_FILES_ONLY=true,HF_HUB_OFFLINE=1,MAX_UPLOAD_BYTES=26214400,MAX_DURATION_SECONDS=3600,STT_TIMEOUT_SECONDS=600,FFMPEG_TIMEOUT_SECONDS=90 \
  --update-secrets "$secrets"
gc run services describe "$service" --region "$region" --format='json(status.url,status.latestReadyRevisionName,status.latestCreatedRevisionName,status.traffic)' >"$script_dir/current-deployment.json"
revision="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); s=d["status"]; assert s["latestReadyRevisionName"]==s["latestCreatedRevisionName"]; print(s["latestReadyRevisionName"])' "$script_dir/current-deployment.json")"
gc run revisions describe "$revision" --region "$region" --format='json(status.imageDigest)' >"$script_dir/image-deployment.json"
python3 - "$script_dir" "$project" "$number" "$region" "$service" "$token_secret" "$token_version" "$gemini_secret" "$gemini_version" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]); project, number, region, service, token, tv, gemini, gv = sys.argv[2:]
s = json.loads((p / 'current-deployment.json').read_text())['status']
record = dict(projectId=project, projectNumber=number, region=region, service=service,
              url=s['url'], revision=s['latestReadyRevisionName'], traffic=s.get('traffic', []),
              imageDigest=json.loads((p / 'image-deployment.json').read_text()).get('status', {}).get('imageDigest'),
              tokenSecret=dict(name=token, version=tv), geminiSecret=dict(name=gemini, version=gv or None),
              functionalTests='not run', cloudflareActivated=False)
(p / 'deployment-record.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False))
PY
printf 'Deployment metadata saved. Cloudflare has not been changed.\n'
