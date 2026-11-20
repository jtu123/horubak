# 호루박 데모 분석 서버 배포

브라우저는 `horubak.pages.dev/api/transcripts/...`만 사용한다. Cloudflare의 로그인·프로젝트 소유권·CSRF 검사 뒤 Python 서비스로 전달한다. Python에 사용자 쿠키나 브라우저용 API 키를 배포하지 않는다. `ANALYSIS_SERVICE_TOKEN`은 Cloudflare와 이 서버만 공유한다.

## Google Cloud Run 배포 프로필

최종 배포 대상은 Google Cloud Run이다. 공개 Whisper `small`·CPU INT8·스레드 1개를 사용하며, 최소 인스턴스 0개·최대 1개·동시 요청 1개·CPU 1개·메모리 2GiB·요청 기한 900초로 구성한다. 요청 외 CPU는 제한하고 시작 시 CPU 부스트도 끈다. 실제 최대 메모리·처리 시간과 한국어 전사 품질은 측정하지 않았다. 메모리 2GiB는 초기 설정이며 모든 입력에서 충분하다는 완료 판정이 아니다.

`gcloud run deploy --source`가 이 폴더의 Dockerfile로 Cloud Build에서 이미지를 빌드한다. 로컬 Docker는 필요하지 않다. Python 3.12, FFmpeg/FFprobe와 공개 모델 파일을 이미지에 포함한다. 빌드 시 패키지 저장소·Hugging Face, Gemini 연결 후에는 실행 시 Google API HTTPS 통신이 필요하다. Dockerfile은 CPU 실행용이다. GPU 라이브러리는 포함하지 않는다.

`ai-server`를 Docker 빌드 컨텍스트로 사용한다. 컨테이너는 비관리자 사용자로 실행하고 `PORT`(기본 8000)를 수신한다. Uvicorn 프로세스와 인스턴스는 각각 1개로 유지한다. 여러 인스턴스를 만들면 전역 순차 처리는 보장되지 않는다.

`cloudrun/deploy.ps1`은 위 설정으로 실행할 배포 명령을 준비한다. 기본 동작은 계획 표시이며 실제 배포는 `-Apply`에서 수행한다. 대상 Google Cloud 프로젝트 ID, 리전(기본 서울 `asia-northeast3`), 전용 런타임 서비스 계정과 Secret Manager 참조를 명시한다. 비밀 참조는 `secret-name:1`처럼 숫자 버전을 고정해 이전 리비전 복구 시 다른 비밀 버전을 읽지 않도록 한다.

Cloud Run·Cloud Build·Artifact Registry·Secret Manager API와 연결된 결제 계정이 필요하다. 배포 계정에는 소스 배포·빌드·런타임 계정 사용 권한이 있어야 한다. 런타임 서비스 계정에는 사용할 비밀별 Secret Manager Secret Accessor 권한만 부여한다. Cloud Build 계정에 Gemini 키를 전달하지 않는다. API 활성화 권한이 없으면 먼저 프로젝트 소유자 권한이나 대상 계정을 정리해야 하며, 이 문서가 API 활성화 완료를 뜻하지 않는다.

Cloud Run 최소 인스턴스 0은 유휴 시 0개로 축소할 수 있는 설정이며 상시 실행을 보장하지 않는다. 다음 요청의 시작 지연이 있고 임시 파일은 인스턴스 종료 시 사라진다. 공개 모델은 이미지에 포함해 보존한다. 회원·프로젝트·저장된 전사는 기존 Cloudflare 저장소에서 관리한다. 무료 할당량과 별개로 빌드·이미지 저장·비밀·네트워크·요청 사용량에 비용이 생길 수 있다. 인스턴스 제한과 예산 알림은 결제 금액의 강제 상한이 아니다.

Secret Manager에 `ANALYSIS_SERVICE_TOKEN`(무작위 32자 이상), 준비된 경우 `GEMINI_API_KEY`를 저장하고 Cloud Run 리비전의 비밀 환경변수로 연결한다. `GEMINI_MODEL`은 일반 환경변수다. 현재 Gemini 키는 준비되지 않았으므로 서버 배포만으로 Gemini 맥락 검토가 활성화됐다고 표시하지 않는다. Gemini Developer API를 그대로 사용하며 Vertex AI로 바꾸지 않는다. 키를 채팅, Git, 프런트엔드의 `VITE_*` 변수에 넣지 않는다. 예시의 `GEMINI_MODEL=gemini-3.5-flash-lite`는 Google 모델 문서에 있는 고정 ID다. 해당 Google 프로젝트의 실제 이용 권한·할당량은 확인하지 않았으므로 필요하면 이용 가능한 고정 모델 ID로 변경한다. Cloud Run 비용과 Gemini API 비용·할당량은 별개다.

Cloudflare에는 이 서버의 HTTPS `run.app` 주소를 `ANALYSIS_BASE_URL`로, 같은 인증 토큰을 `ANALYSIS_SERVICE_TOKEN` 비밀로 설정한다. Gemini 키는 Python 서버에만 필요하다. Cloudflare가 Google IAM ID 토큰을 발급하는 구성이 아니므로 Cloud Run의 호출 IAM은 `--allow-unauthenticated`로 설정하되, Python의 모든 `/api/*`는 기존 Bearer 서비스 토큰으로 보호한다. `/health`는 공개 프로세스 상태만 반환한다. 브라우저 직접 요청을 위한 CORS 설정은 제공하지 않는다.

Docker 빌드 중 `preload_model.py`가 공개 `small` 모델 파일을 이미지의 `WHISPER_DOWNLOAD_ROOT` 캐시에 내려받는다. 이 단계에서는 모델 추론·음성 전사를 실행하지 않는다. 실행 시 `WHISPER_MODEL=small`, `WHISPER_LOCAL_FILES_ONLY=true`, `HF_HUB_OFFLINE=1`을 사용하므로 첫 요청에서 모델을 내려받지 않는다. 첫 요청의 모델 메모리 로드는 유지한다. 빌드에 실제 포함된 모델 스냅샷 ID는 캐시의 `preloaded-model.json`에 기록한다. 모델 설정은 운영자가 변경할 수 있으나, 이름을 바꾸려면 같은 모델을 포함하도록 Docker 이미지도 다시 빌드해야 한다. 실행 시 다른 모델 이름만 설정하면 로컬 모델 없음 오류로 중단하며 원격 다운로드로 우회하지 않는다. 시작·생존 헬스 체크는 `/health`만 호출하며 모델 로드·다운로드나 Gemini 유료 요청을 실행하지 않는다.

`.gcloudignore`는 Dockerfile·고정 의존성·필요한 Python 파일과 `.dockerignore`만 Cloud Build 소스로 보낸다. `.env`, Git 자격 증명, 개발 캐시와 다른 제공자의 배포 설정을 업로드하지 않는다.

## API와 제한

- `GET /health`는 공개 상태 확인용 `{ "status": "ok" }`만 반환한다.
- 모든 `/api/*`는 `Authorization: Bearer <ANALYSIS_SERVICE_TOKEN>`을 요구한다. 비밀 미설정 시 503, 불일치 시 401이다.
- `POST /api/stt/transcribe`는 multipart `file` 하나를 받는다. 확장자를 신뢰하지 않고 FFprobe로 오디오와 길이를 검사한 뒤 FFmpeg로 첫 오디오 트랙을 추출한다. MP4/MOV/MKV/WebM/WAV/MP3 등 설치된 FFmpeg가 인식하는 파일을 지원한다. URL이나 클라이언트 파일 경로는 받지 않는다.
- Cloud Run HTTP/1 요청 제한은 32MiB다. 현재 Uvicorn과 서버 요청 경로는 HTTP/1이므로 데모 파일 제한을 25MiB, Cloudflare multipart 요청을 26MiB로 맞춘다. Cloud Run 배포 명령이 Python `MAX_UPLOAD_BYTES=26214400`을 설정한다. 단순히 `--use-http2`만 켜서 이 제한을 우회하지 않는다. 원본 길이는 최대 1시간이지만 이는 처리 가능 길이를 입증한 성능 기준이 아니다. 임시 원본과 추출 음성은 Cloud Run 메모리를 사용하는 파일시스템에 저장되며 성공·실패 시 정리한다. 이 서비스에 원본을 영구 보관하지 않는다.
- 전사 프로세스는 기본 600초에 종료한다. FFmpeg는 기본 90초, FFprobe는 20초, Gemini는 기본 60초다. 브라우저의 전체 분석 요청 기한은 업로드·응답을 포함해 15분이다. 전사 중 추가 전사 요청은 503과 `Retry-After: 15`를 반환한다. 모델은 요청별 격리 프로세스에서 지연 로드해 시간 초과 시 네이티브 추론도 종료한다.
- 전사 결과는 기존 `{language,segments:[{start,end,text}]}`에 업로드 파일의 `sourceSha256`을 추가한다. 시간은 원본 초 단위다.
- `/api/highlights/context-check`와 `/api/highlights/recommend`는 lee의 계약을 유지한다. JSON 본문은 4MiB 이하, 자막은 최대 20,000개다. Gemini 설정이 없으면 실제 LLM 검토는 503이며 샘플 성공으로 바꾸지 않는다. 기존 문장 경계 규칙은 독립적으로 동작한다.

요청 본문·전사·토큰을 접근 로그에 남기지 않는다. 컨테이너의 시스템 로그에도 비밀 값이 없도록 관리한다. `/health` 정상은 외부 공급자 호출까지 정상이라는 뜻은 아니다.

이번 준비에서는 기능 테스트, 모델 실행, 실제 Gemini 호출을 실행하지 않았다. 클라우드 이미지 빌드에서는 위 공개 모델 파일 다운로드와 패키지 설치가 필요하다. 실제 빌드·서버 생성·비밀 설정·운영 활성화 여부는 배포 기록에서 별도로 확인한다. 배포 후 별도로 요청하지 않은 추가 기능 검증을 실행하지 않는다.

## 배포와 복구 기록

배포 전에 Cloud Run의 기존 준비 완료 리비전 이름과 트래픽을 기록하고, 배포 후에는 새 `status.latestReadyRevisionName`, `status.url`, 트래픽을 기록한다. 비밀 버전과 이미지 다이제스트를 해당 리비전과 함께 보관한다. 이전 리비전은 삭제하지 않는다.

기존 서버가 있었다면 `gcloud run services update-traffic SERVICE --to-revisions OLD_REVISION=100 --project PROJECT_ID --region REGION`으로 이전 리비전에 트래픽을 돌린다. 첫 배포라 이전 리비전이 없으면 Cloudflare의 기존 API 복구 기준으로 연결을 되돌린다. 사용자·프로젝트·전사 DB는 덮어쓰거나 초기화하지 않는다. Cloud Run 서비스 삭제나 비밀 삭제는 이 복구 명령에 포함하지 않는다.

참고: [소스 배포](https://cloud.google.com/run/docs/deploying-source-code), [gcloud run deploy](https://cloud.google.com/sdk/gcloud/reference/run/deploy), [헬스 체크](https://cloud.google.com/run/docs/configuring/healthchecks), [Cloud Run 제한](https://cloud.google.com/run/quotas), [Secret Manager 연결](https://cloud.google.com/run/docs/configuring/services/secrets), [faster-whisper v1.2.1 모델 다운로드 구현](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py), [Gemini 모델](https://ai.google.dev/gemini-api/docs/models). Google SDK는 lee의 httpx 오류 처리와 호환되는 2.34.0으로 고정했다. 3.x 전환은 별도 변경으로 취급한다.
