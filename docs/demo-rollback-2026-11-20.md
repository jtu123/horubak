# 호루박 데모 복구 기준 · 2026-11-20

이 문서는 `lee` 기능 연동 전 운영 버전으로 돌아가기 위한 준비 자료다. 복구 스크립트 작성·보강 과정에서는 실제 롤백을 실행하지 않았다. 추가 검증 범위는 PowerShell 구문과 Cloudflare 배포 상태 확인이며, 기능 테스트는 추가하지 않았다.

| 대상 | 고정 복구 기준 |
| --- | --- |
| 사이트 | [horubak.pages.dev](https://horubak.pages.dev) |
| Cloudflare 계정 | `2eb0b2e89370b1d4f23f4f98fbee4ce6` |
| Pages 프로젝트 | `horubak` |
| Pages 운영 배포 | `516945b0-7122-485c-8b40-293ae0078395` |
| 고정 배포 주소 | [516945b0.horubak.pages.dev](https://516945b0.horubak.pages.dev) |
| 배포 브랜치 | `horubak/cloudflare-demo` |
| 기준 소스 커밋 | `08c936fd540f686f1f01af764abe0bb3abec5060` |
| 인증 Worker | `horubak-auth-test` |
| Worker 운영 버전 | `a89a827b-4bcd-468f-857e-8755542f5cd5` |

이번 최종 배포의 Pages ID는 `6d3fb91c-72cf-4d3d-90f7-69f914ab7c11`, Worker 버전은 `28b5b036-8d5d-45ad-a748-5b325abd47aa`이며 단일 Worker 버전에 트래픽 100%가 연결돼 있다. 복구 스크립트의 현재 배포 guard를 이 값으로 갱신했다. 위 표의 이전 Pages·Worker 복구 목표는 변경하지 않았다. 스크립트는 이번 배포 또는 이미 복구된 기준 버전만 허용하며, 이후 다른 버전이 운영 중이면 중단한다.

복구는 **Pages 화면을 먼저 되돌리고, 확인된 뒤 인증 Worker를 되돌리는 순서**로 진행한다. 새 화면이 이전 API를 호출하는 조합을 피하기 위한 순서다. 두 플랫폼의 변경은 하나의 트랜잭션이 아니므로 Pages 성공 후 Worker 실패 시 부분 복구 상태로 중단한다.

## 준비된 스크립트

[rollback-demo.ps1](../scripts/deployment/rollback-demo.ps1)은 기본 실행 시 대상과 순서만 표시한다. 네트워크 요청이나 운영 변경을 하지 않는다.

```powershell
pwsh -File ./scripts/deployment/rollback-demo.ps1
```

실제 복구는 `-Apply`를 명시할 때만 수행한다. Pages API용 `CLOUDFLARE_API_TOKEN`이 현재 프로세스 환경에 있어야 하고, 토큰에는 대상 계정의 Pages Write 및 Worker 복구에 필요한 권한이 있어야 한다. 토큰 값은 채팅·스크립트·Git에 넣지 않는다. 스크립트는 브라우저 세션이나 Wrangler 자격 증명 파일에서 토큰을 추출하지 않는다.

```powershell
pwsh -File ./scripts/deployment/rollback-demo.ps1 -Apply
```

Wrangler가 PATH에 없다면 설치된 실행 파일이나 JavaScript 진입점의 절대 경로를 넘긴다. JavaScript 파일은 Node로 직접 실행한다. 새 패키지를 자동 설치하지 않는다. 이번 준비에 사용한 CLI 기준은 Wrangler `4.160.1`이다.

```powershell
pwsh -File ./scripts/deployment/rollback-demo.ps1 -Apply -WranglerPath 'C:/absolute/path/to/wrangler/bin/wrangler.js'
```

스크립트는 변경 전 `wrangler deployments status --json`으로 활성 Worker 버전이 하나이고 트래픽이 100%이며 예상 버전과 맞는지 확인한다. Pages는 공식 프로젝트 조회 API의 `canonical_deployment.id`를 확인한다. 상태 조회는 기능 테스트를 실행하지 않는다. 이미 기준 버전이면 해당 서비스의 변경을 건너뛴다.

스크립트는 고정된 Cloudflare HTTPS API로 Pages 복구 요청을 보낸다. 응답의 `success`와 배포 ID를 확인하지 못하면 Worker 단계로 진행하지 않는다. Wrangler 도구도 Pages 변경 전에 확인한다. API 응답 본문이나 토큰은 출력하지 않는다. `-Apply`는 명시적 실행 선택이므로 Worker 명령에는 `--yes --durable-objects-code-update-mode immediate`를 전달한다. 후자는 Durable Object 코드도 즉시 복구 버전으로 전환하기 위한 옵션이다.

`-ExpectedCurrentWorkerVersion`은 기본값이 이번 새 Worker 버전이다. 이후 배포에 대해 바꾸려면 활성 버전과 영향 범위를 먼저 확인해야 한다. Pages의 허용 배포 ID는 스크립트에 고정돼 있으므로 이 매개변수만 바꿔서 이후 배포를 복구 대상으로 삼을 수는 없다.

## API 토큰 없이 복구하는 방법

기존 로그인 상태로 [Cloudflare Pages 배포 목록](https://dash.cloudflare.com/2eb0b2e89370b1d4f23f4f98fbee4ce6/pages/view/horubak)에 들어가 위 Pages 배포 ID를 찾아 운영 롤백을 실행한다. **Cloudflare가 Pages 복구를 확인한 뒤에만** 다음 Worker 명령을 실행한다. 이 경로는 스크립트 자동 실행과 별개이며, 필요한 Wrangler 로그인 권한을 그대로 사용한다.

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '2eb0b2e89370b1d4f23f4f98fbee4ce6'
wrangler deployments status --name horubak-auth-test --json
wrangler rollback a89a827b-4bcd-468f-857e-8755542f5cd5 --name horubak-auth-test --message 'Restore pre-integration demo baseline recorded 2026-11-20' --yes --durable-objects-code-update-mode immediate
```

수동 명령은 스크립트의 버전 검사를 대신 실행해 주지 않는다. 상태 조회 결과에서 활성 버전 하나에 100% 트래픽이 연결됐고 이번 새 버전 ID와 일치하는지 먼저 확인해야 한다. 이미 복구 기준이면 Worker 명령을 실행할 필요가 없다.

Wrangler `4.160.1`에는 `pages rollback` 명령이 없으므로 Pages에는 공식 API나 대시보드를 사용한다. Worker에는 버전 ID를 지정한 `rollback` 명령을 사용한다. [Pages 공식 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/), [Wrangler 공식 명령](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback).

## 클라우드 분석만 일시 중단

Google Cloud Run 분석 연결을 활성화했다. 프로젝트는 `project-a778c6bf-6bf0-47d2-b9a`(번호 `356591580717`), 서울 `asia-northeast3` 리전의 `horubak-analysis`이며 URL은 `https://horubak-analysis-fpkxpig7da-du.a.run.app`이다. Cloudflare 인증 Worker는 HTTPS 주소와 서버 간 Bearer 토큰으로 이 서버를 호출한다. Cloudflare Containers 바인딩은 사용하지 않는다.

[connect-analysis.ps1](../scripts/deployment/connect-analysis.ps1)은 Cloud Run 주소만 허용하는 연결 준비 도구다. 기본 실행에서는 암호화된 파일을 읽거나 네트워크를 호출하지 않는다. 실제 연결은 `-Apply`와 예상 Worker 버전을 지정할 때 수행하며, 보호된 비밀값을 Wrangler 표준입력으로 전달한다. Render 전용 주소나 임시 Containers 바인딩을 이 경로에 사용하지 않는다.

STT·Gemini 연결에 문제가 생기면 [disable-analysis.ps1](../scripts/deployment/disable-analysis.ps1)로 Worker의 `ANALYSIS_BASE_URL` 비밀값만 제거해 분석 요청을 중단할 수 있다. 화면·회원·프로젝트·기존 Google 로그인 설정은 유지한다. 이후 분석 API는 서버 미연결 오류를 표시한다. 기본 실행은 계획만 출력하며 네트워크에 접속하지 않는다.

```powershell
pwsh -File ./scripts/deployment/disable-analysis.ps1
```

실제 중단 전에는 활성 Worker 버전을 기록하고 그 값을 `-ExpectedCurrentWorkerVersion`에 전달한다. 스크립트는 예상 버전 하나에 트래픽 100%가 연결됐는지와 대상 비밀값의 이름만 확인한 뒤 변경한다. 비밀값 내용이나 인증 파일을 읽지 않는다.

```powershell
pwsh -File ./scripts/deployment/disable-analysis.ps1 -Apply -ExpectedCurrentWorkerVersion '<recorded-worker-version>' -WranglerPath 'C:/absolute/path/to/wrangler/bin/wrangler.js'
```

Wrangler `4.160.1`의 `secret delete`에는 `--yes` 옵션이 없으므로 대화형 실행에서는 Wrangler의 삭제 확인이 표시될 수 있다. 삭제 이후에는 비밀값 이름이 사라졌는지와 새 활성 Worker 버전만 확인한다. 이것은 분석 기능을 실행하는 테스트가 아니다.

**분석 연결 활성화와 중단은 Worker의 새 버전을 만들 수 있다.** 현재 연결에 따른 Worker 버전은 위의 `28b5b036-8d5d-45ad-a748-5b325abd47aa`다. 이후 중단 작업을 실제 실행하면 새 활성 버전을 배포 기록에 남기고 전체 복구 스크립트의 예상 Worker 버전도 갱신하거나 `-ExpectedCurrentWorkerVersion`으로 지정해야 한다. 이전 Pages·Worker 복구 목표는 유지한다.

별도 Python 클라우드 서비스와 Gemini 비밀값은 삭제하지 않는다. 분석 요청을 끊어도 이미지 저장·비밀 보관 등 클라우드 사용료가 생길 수 있다. 현재 Cloud Run은 최소 0·최대 1·동시 요청 1·CPU 1·메모리 2GiB·요청 기한 900초다. 최소 0은 강제 요금 상한이 아니다. 다시 연결하려면 보관된 HTTPS 주소를 Cloudflare의 `ANALYSIS_BASE_URL` 비밀값으로 등록하고 새 Worker 버전을 기록한다.

현재 준비 완료 리비전은 `horubak-analysis-00004-j72`이며 트래픽 100%다. 이미지 다이제스트는 `sha256:2f27e803bbec1ce4bed6882abe3d9d08b2f2e811cb5ba188d27f64318e4ebd45`, Docker Cloud Build 작업은 `d207d850-3da9-4ccf-ac6d-15ea8cfce96d`다. `/health`의 `status: ok`는 프로세스 상태만 확인한다. **기능 동작이 검증된 이전 Cloud Run 리비전은 없다.** 이전 리비전을 임의로 정상 복구본으로 삼지 않고, 문제가 생기면 먼저 Cloudflare의 분석 URL을 제거해 분석 요청을 중단한다. Cloud Run의 공개 HTTPS 접근은 허용되지만 Python의 모든 `/api/*`에는 서버 간 Bearer 인증이 필요하다.

현재 Cloud Run 비밀 참조는 `horubak-analysis-service-token:1`과 `horubak-gemini-api-key:2`다. Gemini 버전 1은 현재 참조하지 않으며 삭제·폐기하지 않았다. 롤백을 이유로 버전 1을 자동 사용하거나 비밀값을 다시 만들지 않는다. 기존 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` 항목은 이름으로 보존을 확인했다. 비밀값 내용은 이 문서·로그·Git에 넣지 않는다.

Cloudflare 연결 도구는 메타데이터 조회 시 `WRANGLER_LOG=log`, 비밀 전송 시 오류 수준 로그와 `write_logs=false` 보호를 적용해 연결했다. 실제 STT·Gemini 분석 호출과 추가 기능 테스트는 사용자 지시로 실행하지 않았다. 따라서 모델 품질·성능·키 권한·할당량을 확인한 복구본으로 표시하지 않는다.

## 데이터와 소스의 복구 범위

이번 분석 연동의 DB 변경은 `project_transcripts` 테이블을 추가하는 방식이다. 이전 코드로 복구할 때 추가 테이블은 그대로 둔다. 테이블 삭제, 사용자·프로젝트 초기화, SQLite 파일 덮어쓰기는 실행하지 않는다.

**코드 롤백은 이미 저장된 편집 내용이나 프로젝트 변경을 과거 시점으로 되돌리지 않는다.** 이 준비에는 현재 운영 DB의 새 스냅샷이 포함되지 않았다. 11월 13일에 만들어진 기존 DB 백업이 있더라도 11월 20일의 최신 복구본으로 취급할 수 없다. 데이터 자체의 시점 복구가 필요해지면 먼저 별도 백업·영향 범위를 확인해야 한다.

분석 서버의 새 클라우드 서비스와 Gemini 비밀값도 이 스크립트의 삭제 대상이 아니다. 이전 Worker로 복구한 뒤 별도 서버가 남아 있다면 비용과 사용 여부를 확인해 운영 상태를 결정한다. 기존 Google 로그인 등의 비밀값을 임의로 교체하지 않는다.

기존 소스 ZIP과 SHA-256 목록은 `.cache/demo-release-2026-11-20`에 보관돼 있으며 이 묶음은 변경하지 않았다. `baseline-source-08c936f.zip`은 이전 소스, `integration-source.zip`은 첫 연동 시점의 소스로 이번 최종 클라우드 배포 소스를 의미하지 않는다. 최신 배포 자료는 `.cache/cloudrun-demo-release-20261120`에 별도 보관하며, `manifest.json`·`worker-deployment.json`·`pages/staging-manifest.json`으로 추적한다. 배포 소스 커밋은 `6e9ea825afa5e6df40cdb4849f343b094db26aa2`이고 문서 정리는 후속 커밋으로 관리한다.

소스 보관은 운영 DB·로그인 비밀값 백업을 의미하지 않는다. 새 DB 스냅샷은 만들지 않았고 회원·프로젝트 데이터를 초기화하지 않았다. 복구 명령 실행 후에는 Pages 배포 대상과 Worker 활성 버전이 위 기준에 맞는지 Cloudflare 배포 상태에서 확인한다.
