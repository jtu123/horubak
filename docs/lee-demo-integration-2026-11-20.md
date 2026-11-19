# lee 분석 기능 데모 연동 · 2026-11-20

## 현재 배포

- 데모: https://horubak.pages.dev
- Pages 배포: `99a55ffe-ffa9-4daf-be28-592682773246`
- 인증·프로젝트 API Worker: `horubak-auth-test`, 버전 `c8908528-68f9-4f7f-aa8f-5af71e1dde4e`
- 기준 소스: 데모 `08c936fd540f686f1f01af764abe0bb3abec5060`, lee 참조 `cb0c0c9243c55145d752fc5ee7d29cd13e99bff7`

화면과 API 연결부를 배포했다. **Python 클라우드 서버는 아직 생성하지 않았으며 실제 STT·Gemini 연결은 활성화되지 않았다.** 최종 배포 대상은 Google Cloud Run으로 확정했다. 사용자가 결제 계정을 준비한 뒤 새 프로젝트 `My First Project` / `project-a778c6bf-6bf0-47d2-b9a`(프로젝트 번호 `356591580717`)를 확인했다. Gemini 키 준비는 아직 남아 있다. Render 서비스나 Cloudflare Containers는 생성하지 않았다.

## 구현한 연결

기존 데모의 아이디·Google 로그인, 세션 쿠키, CSRF, 사용자별 프로젝트 저장과 버전 충돌 처리를 유지했다. lee의 localhost Spring/JWT/MySQL 구성을 직접 노출하는 대신 데모의 기존 인증 API가 Python 분석 서버를 호출한다.

- 전사 생성·조회, 원본 초 단위 탐색, 맥락 검토·근거 표시·보정 전후 비교·현재 클립 적용
- 클립 구간·자막·크롭·미리보기, 되돌리기와 서버 편집 저장 유지
- 사용자·프로젝트·원본 변경 시 오래된 요청 결과 무효화
- 사용자·프로젝트별 `project_transcripts` 저장, 원본 메타데이터 버전과 분석 파일 SHA-256 연결
- Python에 영상/음성 multipart 입력, FFmpeg 오디오 추출, Bearer 서비스 인증, 임시 파일 정리, 추론 동시 실행 1건 및 시간 제한 추가
- 설정 미완료나 API 실패는 오류로 표시하며 샘플 성공으로 대체하지 않음

현재 최종 일정표의 39개 항목 번호를 기준으로 SFR-005는 한국어 음성 전사, SFR-009는 맥락 손실 탐지, SFR-010은 원본 근거 기반 구간 보정, SFR-019는 편집 화면/조작 UI다. 이전 문서에서는 예전 번호 체계와 혼동해 SFR-009를 자연어 편집으로 잘못 안내했으며 이 문서에서 정정한다.

| 요구사항 | 이번 데모 반영 | 남은 작업 |
| --- | --- | --- |
| SFR-005 한국어 음성 전사 | 원본 전사 요청·조회·저장·시간 탐색 UI와 인증 API 반영, Python STT 서비스 코드·Docker 설정 준비 | Python 클라우드 서버 빌드·배포 및 연결 |
| SFR-009 맥락 손실 탐지 | 실제 전사 기반 검토 요청·경고·근거 표시 UI와 인증 API 반영, Python/Gemini 분석 코드 준비 | Python 서버와 Gemini 비밀 설정 후 실제 분석 활성화 |
| SFR-010 원본 근거 기반 구간 보정 | 보정 전후 비교·현재 클립 적용·되돌리기·편집 저장 경로 반영 | 클라우드 AI에서 생성한 실제 보정안 공급 |
| SFR-019 편집 화면/조작 UI | 기존 클립 전환·구간·자막·크롭·타임라인 편집기에 전사·맥락 패널 연결해 배포 | 실제 분석 결과까지 이어지는 통합 동작은 아직 확인하지 않음 |

lee 소스에는 자연어 편집 패널과 해석 API가 구현되어 있지 않았다. 이는 현재 번호 기준 SFR-017/018의 별도 범위이며 위 네 기능과 혼용하지 않는다. 이번 변경으로 네 요구사항 전체의 완료를 재인증한 것은 아니다. MP4 렌더·다운로드와 다중 서버 작업 큐는 이번 연결에 포함하지 않았다.

## 클라우드 설정

분석 서버는 `ai-server`를 빌드 소스로 사용해 Google Cloud Run에 배포한다. Cloud Build가 Docker 이미지와 공개 Whisper 모델 파일을 준비한다. 최소 인스턴스 0·최대 1·동시 요청 1·CPU 1·메모리 2GiB·요청 기한 900초 프로필을 준비했다. 현재 모델은 `small` CPU INT8이며 실제 메모리·속도·한국어 품질은 측정하지 않았다.

배포 소스는 `codex/demo-analysis-cloud-20261120` 브랜치에 올렸으며, 최초 업로드 커밋은 `956726240739cfefd4a9e6e5ac3047efc6a02645`, Cloud Run 설정·롤백 준비 커밋은 `00c8396838685d4d5de09530451c88f3abb448fe`다. 후속 Cloud Run 설정과 롤백 도구도 같은 브랜치로 관리한다. 기존 데모 운영 브랜치에 자동 병합하지 않는다. `ai-server/render.yaml`은 이전 선택지의 참고 설정이며 현재 배포 대상이 아니다.

Google Cloud Shell에서 배포 프로젝트 ID와 번호를 읽어 위 프로젝트를 확인했고, Cloud Shell의 기본 gcloud로 배포한다. 소스 업로드는 Docker 빌드 입력과 배포 스크립트, 서버 간 인증 전달에 사용할 공개 RSA 키로 제한한다. 로컬의 암호화된 비밀키, 기존 회원 데이터, API 키는 소스 묶음에 넣지 않는다.

| 위치 | 설정 |
| --- | --- |
| Google Secret Manager → Cloud Run 비밀 환경변수 | `GEMINI_API_KEY`, `ANALYSIS_SERVICE_TOKEN`의 고정 숫자 버전 |
| Python 일반 설정 | `GEMINI_MODEL=gemini-3.5-flash-lite`, CPU INT8 Whisper 설정 |
| Cloudflare Worker 비밀 설정 | `ANALYSIS_BASE_URL`, 같은 `ANALYSIS_SERVICE_TOKEN` |

Gemini 키를 브라우저, `VITE_*`, Git, 채팅에 넣지 않는다. 모델의 실제 계정 권한과 할당량은 아직 확인하지 않았다. Python 헬스 체크는 프로세스 상태만 나타낸다.

최초 배포한 화면·API는 파일 90MiB 한도로 준비했으나, Cloud Run HTTP/1의 32MiB 요청 제한에 맞춰 후속 배포의 파일 한도를 25MiB, multipart 한도를 26MiB로 변경했다. 새 한도의 운영 반영 여부는 후속 배포 ID와 함께 기록한다. 원본 길이 제한 60분, 클립 맥락 검토 30~60초, 전체 전사 요청 15분이다. 서버 내부 기본 제한은 STT 600초, FFmpeg 90초, FFprobe 20초다. 이 시간 안에 처리 가능한 영상 길이는 서버 장비에서 측정하지 않았다. 원본 파일은 분석을 위해 일시 전송하고 서버에 영구 보관하지 않는다.

Cloud Run 최소 인스턴스 0·최대 1은 비용을 제한하는 설정이며 강제 결제 상한은 아니다. 무료 실행량 외에도 Cloud Build·Artifact Registry·Secret Manager·통신 사용료가 생길 수 있다. 가입·결제 계정 등록과 약관 동의는 사용자가 직접 진행한다. Gemini 키는 아직 입력하지 않았으며 실제 호출도 실행하지 않았다.

## 보관 파일과 복구

수정 소스는 작업 폴더의 `.cache/kjh-google-auth`에 있다. 루트 작업 중이던 변경 사항과 README는 수정하지 않았다. 이번 변경의 추적 가능한 패치는 [lee-demo-2026-11-20.patch](releases/lee-demo-2026-11-20.patch)에 보관했다. 패치는 위 기준 커밋에 대한 변경이며 루트의 다른 변경에 그대로 덮어쓰면 안 된다.

복구 묶음은 `.cache/demo-release-2026-11-20`에 있다.

- `baseline-source-08c936f.zip`: 업데이트 전 소스
- `integration-source.zip`: 이번 연동 소스
- `manifest.json`: 파일별 SHA-256, 배포 ID와 검증 범위
- `pages`: 이번 Pages 배포에 사용한 정적 빌드와 Functions 설정

[복구 절차](demo-rollback-2026-11-20.md)와 [복구 스크립트](../scripts/deployment/rollback-demo.ps1)를 준비했다. 기존 회원·프로젝트 테이블은 삭제하거나 초기화하지 않는다. 코드 롤백은 이미 저장된 편집 내용을 과거 시점으로 되돌리는 DB 복구가 아니다.

## 확인 범위

프런트 TypeScript·Vite 빌드, 백엔드 TypeScript 빌드, Worker dry-run 번들 빌드, Python AST 구문 검사를 통과했다. 프런트 JS 번들 530.80kB 경고는 남아 있다. Cloudflare 배포 상태에서 새 운영 Pages와 활성 Worker 버전을 확인했다.

사용자 지시에 따라 추가 기능 테스트, 실제 모델 실행, 실제 Gemini 호출을 진행하지 않았다. Docker 이미지 빌드와 Python 의존성 설치 해석도 아직 실행하지 않았다.
