# 호루박 데모 분석 서버 배포

브라우저는 `horubak.pages.dev/api/transcripts/...`만 사용한다. Cloudflare의 로그인·프로젝트 소유권·CSRF 검사 뒤 Python 서비스로 전달한다. Python에 사용자 쿠키나 브라우저용 API 키를 배포하지 않는다. `ANALYSIS_SERVICE_TOKEN`은 Cloudflare와 이 서버만 공유한다.

## 상시 클라우드 실행

Python 3.12, FFmpeg/FFprobe, CPU INT8 실행에 충분한 메모리(초기 배포 예시는 2GB이며 실제 최대 메모리 사용량은 미측정), 모델 파일을 포함할 이미지 저장 공간이 필요하다. 이미지 빌드 시 패키지 저장소·Hugging Face, 실행 시 Google API HTTPS 통신이 필요하다. Dockerfile은 CPU 실행용이다. GPU 라이브러리는 포함하지 않는다.

`ai-server`를 Docker 빌드 컨텍스트로 사용한다. 컨테이너는 비관리자 사용자로 실행하고 `PORT`(기본 8000)를 수신한다. Uvicorn 프로세스와 인스턴스는 각각 1개로 유지한다. 여러 인스턴스를 만들면 전역 순차 처리는 보장되지 않는다.

Render를 사용할 경우 저장소의 Blueprint 경로를 `ai-server/render.yaml`로 지정할 수 있다. 예시는 싱가포르 리전의 유료 `1c-2g` 플랜(기존 `standard`와 같은 1CPU·2GB 구성)이며 실제 요금·요청 제한은 생성 화면에서 확인한다. 이 파일 자체는 서비스를 생성하거나 결제를 승인하지 않는다. `rootDir`은 저장소에 `ai-server`가 있는 배치를 기준으로 한다. 저장소 자동 배포는 꺼 두고 인스턴스 1개만 생성한다.

클라우드 비밀 설정 화면에 `ANALYSIS_SERVICE_TOKEN`(무작위 32자 이상), `GEMINI_API_KEY`, `GEMINI_MODEL`을 등록한다. 키를 채팅, Git, 프런트엔드의 `VITE_*` 변수에 넣지 않는다. 예시의 `GEMINI_MODEL=gemini-3.5-flash-lite`는 Google 모델 문서에 있는 고정 ID다. 해당 Google 프로젝트의 실제 이용 권한·할당량은 확인하지 않았으므로 필요하면 이용 가능한 고정 모델 ID로 변경한다.

Cloudflare에는 이 서버의 HTTPS 주소를 `ANALYSIS_BASE_URL`로, 같은 인증 토큰을 `ANALYSIS_SERVICE_TOKEN` 비밀로 설정한다. Gemini 키는 Python 서버에만 필요하다. 브라우저 직접 요청을 위한 CORS 설정은 제공하지 않는다.

Docker 빌드 중 `preload_model.py`가 공개 `small` 모델 파일을 이미지의 `WHISPER_DOWNLOAD_ROOT` 캐시에 내려받는다. 이 단계에서는 모델 추론·음성 전사를 실행하지 않는다. 실행 시 `WHISPER_MODEL=small`, `WHISPER_LOCAL_FILES_ONLY=true`, `HF_HUB_OFFLINE=1`을 사용하므로 첫 요청에서 모델을 내려받지 않는다. 첫 요청의 모델 메모리 로드는 유지한다. 빌드에 실제 포함된 모델 스냅샷 ID는 캐시의 `preloaded-model.json`에 기록한다. 모델 버전을 바꾸려면 해당 파일을 포함하도록 이미지를 다시 빌드한다. 실행 시 다른 모델 이름만 설정하면 로컬 모델 없음 오류로 중단하며 원격 다운로드로 우회하지 않는다. 헬스 체크는 모델 로드·다운로드나 Gemini 유료 요청을 실행하지 않는다.

## API와 제한

- `GET /health`는 공개 상태 확인용 `{ "status": "ok" }`만 반환한다.
- 모든 `/api/*`는 `Authorization: Bearer <ANALYSIS_SERVICE_TOKEN>`을 요구한다. 비밀 미설정 시 503, 불일치 시 401이다.
- `POST /api/stt/transcribe`는 multipart `file` 하나를 받는다. 확장자를 신뢰하지 않고 FFprobe로 오디오와 길이를 검사한 뒤 FFmpeg로 첫 오디오 트랙을 추출한다. MP4/MOV/MKV/WebM/WAV/MP3 등 설치된 FFmpeg가 인식하는 파일을 지원한다. URL이나 클라이언트 파일 경로는 받지 않는다.
- 기본 파일 제한은 90MiB, 원본 길이는 1시간이다. Cloudflare 쪽 전체 요청 제한은 95MiB다. 영상과 추출 음성은 요청 전용 임시 폴더에 저장했다가 성공·실패 시 정리한다. 원본은 이 서비스에 영구 보관하지 않는다.
- 전사 프로세스는 기본 600초에 종료한다. FFmpeg는 기본 90초, FFprobe는 20초, Gemini는 기본 60초다. 브라우저의 전체 분석 요청 기한은 업로드·응답을 포함해 15분이다. 전사 중 추가 전사 요청은 503과 `Retry-After: 15`를 반환한다. 모델은 요청별 격리 프로세스에서 지연 로드해 시간 초과 시 네이티브 추론도 종료한다.
- 전사 결과는 기존 `{language,segments:[{start,end,text}]}`에 업로드 파일의 `sourceSha256`을 추가한다. 시간은 원본 초 단위다.
- `/api/highlights/context-check`와 `/api/highlights/recommend`는 lee의 계약을 유지한다. JSON 본문은 4MiB 이하, 자막은 최대 20,000개다. Gemini 설정이 없으면 실제 LLM 검토는 503이며 샘플 성공으로 바꾸지 않는다. 기존 문장 경계 규칙은 독립적으로 동작한다.

요청 본문·전사·토큰을 접근 로그에 남기지 않는다. 컨테이너의 시스템 로그에도 비밀 값이 없도록 관리한다. `/health` 정상은 외부 공급자 호출까지 정상이라는 뜻은 아니다.

이번 준비에서는 기능 테스트, 모델 실행, 실제 Gemini 호출을 실행하지 않았다. 클라우드 이미지 빌드에서는 위 공개 모델 파일 다운로드와 패키지 설치가 필요하다. 실제 빌드·서버 생성·비밀 설정·운영 활성화 여부는 배포 기록에서 별도로 확인한다. 배포 후 별도로 요청하지 않은 추가 기능 검증을 실행하지 않는다.

참고: [Render Blueprint](https://render.com/docs/blueprint-spec), [Render 리전](https://render.com/docs/regions), [faster-whisper v1.2.1 모델 다운로드 구현](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py), [Gemini 모델](https://ai.google.dev/gemini-api/docs/models). Google SDK는 lee의 httpx 오류 처리와 호환되는 2.34.0으로 고정했다. 3.x 전환은 별도 변경으로 취급한다.
