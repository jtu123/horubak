# lee 분석 기능 데모 연동 · 2026-11-20

## 현재 배포

- 데모: https://horubak.pages.dev
- Pages 운영 배포: `f4ae3fd7-35da-4558-8675-e39d3e765506`
- 인증·프로젝트 API Worker: `horubak-auth-test`, 버전 `28b5b036-8d5d-45ad-a748-5b325abd47aa`, 단일 버전에 트래픽 100%
- 웹 앱 배포 소스: `main`의 `a57b6279c1dc3475e5eca27cb6ffdbbbd55a9639`. 이후 배포 기록·롤백 도구 문서화는 후속 커밋으로 관리한다.
- 이전 데모 소스: `08c936fd540f686f1f01af764abe0bb3abec5060`, lee 참조: `cb0c0c9243c55145d752fc5ee7d29cd13e99bff7`

**화면·API·Cloud Run 분석 서버 배포와 Gemini 비밀 설정을 완료했다.** Cloudflare가 Cloud Run을 호출하는 운영 연결을 활성화했다. 프로젝트는 `project-a778c6bf-6bf0-47d2-b9a`(번호 `356591580717`)이며, 사용자가 제공한 lee의 Gemini 키는 Secret Manager 버전 2로 연결했다. 실제 STT·Gemini 분석 요청은 사용자 지시에 따라 실행하지 않았으므로 결과 품질과 계정 권한·할당량을 검증한 상태는 아니다.

최신 `main` 재배포에는 SFR-011·012 자막·강조 효과 편집과 누락된 자막 기본값 보완도 포함했다. 이전 배포와 비교해 Worker·Python 분석 서버의 실행 코드는 같으므로 Pages만 갱신했다. 빌드와 운영 배포 정보·정적 JS/CSS 제공만 확인했고 추가 기능 테스트는 실행하지 않았다. 재배포 직전 Pages `6d3fb91c-72cf-4d3d-90f7-69f914ab7c11`로 돌아가는 별도 [복구 절차](releases/main-demo-2026-11-20.md)를 추가했으며 기존 전체 복구 기준도 유지한다.

## 구현한 연결

기존 데모의 아이디·Google 로그인, 세션 쿠키, CSRF, 사용자별 프로젝트 저장과 버전 충돌 처리를 유지했다. lee의 localhost Spring/JWT/MySQL 구성을 직접 노출하는 대신 데모의 기존 인증 API가 Python 분석 서버를 호출한다.

- 전사 생성·조회, 원본 초 단위 탐색, 맥락 검토·근거 표시·보정 전후 비교·현재 클립 적용
- 클립 구간·자막·크롭·미리보기, 되돌리기와 서버 편집 저장 유지
- 사용자·프로젝트·원본 변경 시 오래된 요청 결과 무효화
- 사용자·프로젝트별 `project_transcripts` 저장, 원본 메타데이터 버전과 분석 파일 SHA-256 연결
- Python에 영상/음성 multipart 입력, FFmpeg 오디오 추출, Bearer 서비스 인증, 임시 파일 정리, 추론 동시 실행 1건 및 시간 제한 추가
- 설정 미완료나 API 실패는 오류로 표시하며 샘플 성공으로 대체하지 않음

현재 최종 일정표의 39개 항목 번호를 기준으로 SFR-005는 한국어 음성 전사, SFR-009는 맥락 손실 탐지, SFR-010은 원본 근거 기반 구간 보정, SFR-019는 편집 화면/조작 UI다. 이전 문서에서는 예전 번호 체계와 혼동해 SFR-009를 자연어 편집으로 잘못 안내했으며 이 문서에서 정정한다.

| 요구사항 | 이번 데모 배포 반영 | 확인하지 않은 범위 |
| --- | --- | --- |
| SFR-005 한국어 음성 전사 | 원본 전사 요청·조회·저장·시간 탐색 UI와 인증 API, Whisper small CPU INT8 분석 서버 연결 | 실제 한국어 음성 전사와 품질·처리 시간 |
| SFR-009 맥락 손실 탐지 | 전사 기반 검토 요청·경고·근거 표시와 Gemini 키 버전 2 연결 | 실제 Gemini 응답과 모델 이용 권한·할당량 |
| SFR-010 원본 근거 기반 구간 보정 | 원본 발화 근거 기반 보정안의 전후 비교·현재 클립 적용·되돌리기·편집 저장 경로 연결 | 실제 AI 보정안 생성부터 적용까지의 실행 |
| SFR-019 편집 화면/조작 UI | 기존 클립 전환·구간·자막·크롭·타임라인 편집기에 전사·맥락 패널, 25MiB 안내 연결 | 실제 분석 결과를 사용한 통합 조작 |

lee 소스에는 자연어 편집 패널과 해석 API가 구현되어 있지 않았다. 이는 현재 번호 기준 SFR-017/018의 별도 범위이며 위 네 기능과 혼용하지 않는다. 이번 변경으로 네 요구사항 전체의 완료를 재인증한 것은 아니다. MP4 렌더·다운로드와 다중 서버 작업 큐는 이번 연결에 포함하지 않았다.

## 클라우드 설정

분석 서버는 `ai-server`를 소스로 Google Cloud Run 서울 리전에 배포했다. Cloud Build 작업 `d207d850-3da9-4ccf-ac6d-15ea8cfce96d`가 성공했으며 Python 의존성과 공개 Whisper `small` 모델을 이미지에 설치·사전 다운로드했다. 빌드 중 모델 추론은 실행하지 않았다.

| 대상 | 현재 배포 기록 |
| --- | --- |
| 프로젝트 | `project-a778c6bf-6bf0-47d2-b9a` / `356591580717` |
| 리전·서비스 | 서울 `asia-northeast3` / `horubak-analysis` |
| 서버 URL | `https://horubak-analysis-fpkxpig7da-du.a.run.app` |
| 준비 완료 리비전 | `horubak-analysis-00004-j72`, 트래픽 100% |
| 이미지 다이제스트 | `sha256:2f27e803bbec1ce4bed6882abe3d9d08b2f2e811cb5ba188d27f64318e4ebd45` |
| 자원·요청 설정 | 최소 0·최대 1·동시 요청 1·CPU 1·메모리 2GiB·요청 기한 900초 |
| 프로세스 헬스 | `/health`의 `status: ok` 확인 |

현재 모델은 `small` CPU INT8이며 실제 메모리·속도·한국어 품질은 측정하지 않았다. Cloud Run 준비 완료와 프로세스 헬스는 모델 추론·Gemini 응답 성공을 뜻하지 않는다.

초기 배포 소스는 `codex/demo-analysis-cloud-20261120` 브랜치에서 관리했으며, 최초 업로드 커밋은 `956726240739cfefd4a9e6e5ac3047efc6a02645`, Cloud Run 설정·롤백 준비 커밋은 `00c8396838685d4d5de09530451c88f3abb448fe`다. 이후 `kjh`를 거쳐 `main`에 병합했고 원격 `cloudrun`과 로컬 작업 브랜치를 삭제했다. 현재 코드는 `main`에서 관리한다. `ai-server/render.yaml`은 이전 선택지의 참고 설정이며 현재 배포 대상이 아니다.

Google Cloud Shell의 gcloud로 배포했다. 소스 업로드는 Docker 빌드 입력과 배포 스크립트, 서버 간 인증 전달용 공개 RSA 키로 제한했다. 로컬의 암호화된 비밀키, 기존 회원 데이터, API 키는 소스 묶음에 넣지 않았다.

| 위치 | 설정 |
| --- | --- |
| Google Secret Manager → Cloud Run 비밀 환경변수 | `GEMINI_API_KEY` → `horubak-gemini-api-key:2`, `ANALYSIS_SERVICE_TOKEN` → `horubak-analysis-service-token:1` |
| Python 일반 설정 | `GEMINI_MODEL=gemini-3.5-flash-lite`, CPU INT8 Whisper 설정 |
| Cloudflare Worker 비밀 설정 | `ANALYSIS_BASE_URL`, 같은 `ANALYSIS_SERVICE_TOKEN` |

Cloudflare의 `ANALYSIS_BASE_URL`과 `ANALYSIS_SERVICE_TOKEN` 비밀값을 bulk 갱신했고 항목 이름과 활성 Worker 버전을 확인했다. 기존 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` 항목이 유지됨도 이름으로 확인했다. `connect-analysis.ps1`은 배포 메타데이터 조회에 `WRANGLER_LOG=log`를 사용하도록 수정했으며, 비밀 전송에는 오류 수준 로그와 `write_logs=false` 보호를 적용했다.

Gemini 비밀 버전 1은 현재 리비전에서 참조하지 않으며 삭제·폐기하지 않았다. 키를 프런트엔드 코드, `VITE_*`, Git, 채팅에 넣지 않았다. 모델의 실제 계정 권한과 할당량은 확인하지 않았다.

Cloud Run HTTP/1의 32MiB 요청 제한에 맞춰 파일 한도 25MiB, multipart 한도 26MiB를 프런트·API·분석 서버 배포에 반영했다. 원본 길이 제한 60분, 클립 맥락 검토 30~60초, 전체 전사 요청 15분이다. 서버 내부 기본 제한은 STT 600초, FFmpeg 90초, FFprobe 20초다. 이 시간 안에 처리 가능한 영상 길이는 서버 장비에서 측정하지 않았다. 원본 파일은 분석을 위해 일시 전송하고 서버에 영구 보관하지 않는다.

Cloud Run 최소 인스턴스 0·최대 1은 비용을 제한하는 설정이며 강제 결제 상한은 아니다. 무료 실행량 외에도 Cloud Build·Artifact Registry·Secret Manager·통신 사용료가 생길 수 있다. 가입·결제 계정 등록과 약관 동의는 사용자가 직접 진행했다. Gemini 키 연결 후에도 실제 Gemini 호출은 실행하지 않았다.

## 보관 파일과 복구

수정 소스는 작업 폴더의 `.cache/kjh-google-auth`에 있다. 루트에서 진행 중이던 다른 변경 사항과 README는 건드리지 않았다. 첫 연동 시점의 패치는 [lee-demo-2026-11-20.patch](releases/lee-demo-2026-11-20.patch)에 보관했다. 이후 Cloud Run 구성과 최종 배포 도구 변경은 배포 브랜치와 아래 최신 소스 ZIP으로 추적한다. 초기 패치를 최신 전체 소스로 취급하거나 루트의 다른 변경에 그대로 덮어쓰면 안 된다.

기존 복구 묶음 `.cache/demo-release-2026-11-20`은 변경하지 않았다. 다음 파일은 첫 연동 시점의 보관 자료이며 이번 최종 클라우드 배포 소스를 의미하지 않는다.

- `baseline-source-08c936f.zip`: 업데이트 전 소스
- `integration-source.zip`: 첫 연동 시점의 소스
- `manifest.json`: 파일별 SHA-256, 배포 ID와 검증 범위
- `pages`: 첫 연동 시점의 정적 빌드와 Functions 설정

[복구 절차](demo-rollback-2026-11-20.md)와 [복구 스크립트](../scripts/deployment/rollback-demo.ps1)를 준비했다. 기존 회원·프로젝트 테이블은 삭제하거나 초기화하지 않는다. 코드 롤백은 이미 저장된 편집 내용을 과거 시점으로 되돌리는 DB 복구가 아니다.

이전 Cloud Run 연동 배포 기록과 Pages 스테이징은 `.cache/cloudrun-demo-release-20261120`에 보관한다. `cloudrun-integration-source.zip`은 당시 문서·연결 도구를 포함한 소스이고 `sha256.json`에 해시를 기록했다. 최신 main 재배포 자료는 `.cache/main-demo-release-20261120`에 별도 보관한다. 재배포 직전 Pages `6d3fb91c-72cf-4d3d-90f7-69f914ab7c11`로 복구하는 도구를 추가했고, 기존 전체 복구 목표 Pages `516945b0-7122-485c-8b40-293ae0078395`·Worker `a89a827b-4bcd-468f-857e-8755542f5cd5`도 유지한다. 현재 배포를 확인하는 스크립트 guard만 새 Pages 값으로 갱신했다.

## 확인 범위

프런트 TypeScript·Vite 빌드, 백엔드 TypeScript 빌드, Worker 번들 빌드, Python 구문 검사를 통과했다. 최신 main 프런트 JS 번들은 533.91kB이며 500kB 초과 경고는 남아 있다. 기존 Docker Cloud Build, 의존성 설치, 공개 모델 사전 다운로드가 성공했다. Cloud Run 준비 완료 리비전·트래픽·프로세스 헬스와 Cloudflare 운영 Pages·단일 활성 Worker 버전을 확인했다. 이번 Pages 재배포에서 Worker·Cloud Run을 다시 빌드하거나 설정하지 않았다.

사용자 지시에 따라 추가 기능 테스트, 실제 STT 추론, 실제 Gemini 호출은 진행하지 않았다. 전사 품질·성능·모델 이용 권한·할당량과 실제 분석 결과의 편집 적용 과정은 미검증이다. 운영 DB의 새 스냅샷은 만들지 않았고 기존 회원·프로젝트 데이터를 초기화하지 않았다.
