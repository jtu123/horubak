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

이번 새 배포의 Pages ID는 `99a55ffe-ffa9-4daf-be28-592682773246`, Worker 버전은 `c8908528-68f9-4f7f-aa8f-5af71e1dde4e`이며 Worker에는 트래픽 100%가 연결돼 있다. 복구 스크립트는 이 배포 또는 이미 복구된 기준 버전만 허용한다. 그 이후 다른 버전이 운영 중이면 자동으로 과거 배포를 덮어쓰지 않고 중단한다.

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

최종 분석 서버 대상은 Google Cloud Run이다. Cloudflare 인증 Worker는 Cloud Run의 `*.run.app` HTTPS 주소와 서버 간 Bearer 토큰으로 Python 분석 서버를 호출한다. Cloudflare Containers 서비스 바인딩은 현재 인증 Worker 설정에 추가하지 않는다. 이 문서 갱신 시점에는 Cloud Run 분석 연결을 아직 활성화하지 않았다.

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

**분석 연결 활성화와 중단은 Worker의 새 버전을 만들 수 있다.** 실제 변경 후 활성 버전을 배포 기록에 남기고 전체 복구 스크립트의 예상 Worker 버전도 갱신하거나 `-ExpectedCurrentWorkerVersion`으로 지정해야 한다. 위에 기록한 이전 Pages·Worker 복구 대상은 유지한다. 이 준비 과정에서는 현재 운영 중인 Worker 버전을 변경하지 않았다.

별도 Python 클라우드 서비스와 Gemini 키는 삭제하지 않는다. 분석 요청을 끊어도 클라우드 서버 요금은 계속될 수 있으므로 제공자 화면에서 서버 일시 중지·재개를 별도로 결정한다. 다시 연결하려면 보관된 HTTPS 주소를 Cloudflare의 `ANALYSIS_BASE_URL` 비밀값으로 등록하고 새 Worker 버전을 기록한다.

Cloud Run 자체의 장애 복구가 필요하면 이전 정상 리비전으로 트래픽을 되돌리거나 새 리비전 배포를 중단한다. 최초 배포에는 이전 정상 리비전이 없으므로 Cloudflare의 분석 연결을 해제해 기존 웹 기능을 유지한다. 구체적인 서비스·리비전 ID는 실제 생성 후 기록한다. Cloud Run의 공개 네트워크 접근 허용은 별도 생성 단계에서 확인하며, Python의 `/api/*`는 서버 간 Bearer 인증을 계속 요구한다.

## 데이터와 소스의 복구 범위

이번 분석 연동의 DB 변경은 `project_transcripts` 테이블을 추가하는 방식이다. 이전 코드로 복구할 때 추가 테이블은 그대로 둔다. 테이블 삭제, 사용자·프로젝트 초기화, SQLite 파일 덮어쓰기는 실행하지 않는다.

**코드 롤백은 이미 저장된 편집 내용이나 프로젝트 변경을 과거 시점으로 되돌리지 않는다.** 이 준비에는 현재 운영 DB의 새 스냅샷이 포함되지 않았다. 11월 13일에 만들어진 기존 DB 백업이 있더라도 11월 20일의 최신 복구본으로 취급할 수 없다. 데이터 자체의 시점 복구가 필요해지면 먼저 별도 백업·영향 범위를 확인해야 한다.

분석 서버의 새 클라우드 서비스와 Gemini 비밀값도 이 스크립트의 삭제 대상이 아니다. 이전 Worker로 복구한 뒤 별도 서버가 남아 있다면 비용과 사용 여부를 확인해 운영 상태를 결정한다. 기존 Google 로그인 등의 비밀값을 임의로 교체하지 않는다.

기준 소스 ZIP과 새 작업 소스 ZIP, SHA-256 목록은 작업 폴더의 `.cache/demo-release-2026-11-20`에 보관했다. `baseline-source-08c936f.zip`은 이전 소스, `integration-source.zip`은 새 소스이며 `manifest.json`에 파일별 해시와 배포 ID를 기록했다. ZIP은 코드 보관용이며 운영 DB·로그인 비밀값 백업을 의미하지 않는다. 복구 명령 실행 후에는 Pages 배포 대상과 Worker 활성 버전이 위 기준에 맞는지 Cloudflare 배포 상태에서 확인한다.
