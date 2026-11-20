# Cloudflare 운영 로그 · 2026-11-20

## 확인한 기존 상태

- 계정: `2eb0b2e89370b1d4f23f4f98fbee4ce6`, Workers **Free**, 현재 플랜 $0.
- API Worker: `horubak-auth-test`, 현재 코드 버전 `28b5b036-8d5d-45ad-a748-5b325abd47aa`에 트래픽 100%.
- 대시보드의 Logs·Traces·Issues는 모두 꺼져 있었고 외부 로그 목적지도 없었다. 비활성 상태의 로그 샘플링 표시값은 100%였다.
- Pages: `horubak`, 운영 배포 `f4ae3fd7-35da-4558-8675-e39d3e765506`.

서비스 DB와 운영 로그는 별개다. 회원·프로젝트·편집·전사 결과와 관리자 `audit_log`는 기존 Durable Object SQLite 데이터이며 이번 설정으로 보관 기간을 바꾸거나 삭제하지 않는다. Cloud Run 실행 로그는 Google Cloud Logging에 남는 기존 구조를 유지한다.

## 적용한 수집 설정

API Worker에 다음 설정을 사용한다. 기존 코드 버전을 100%로 유지한 채 공식 `wrangler versions deploy`가 비버전 설정을 동기화한다. 새 앱 코드를 업로드하거나 비밀값을 다시 입력하지 않는다.

적용 후 대시보드에서 Logs 켜짐, Include Invocation logs 선택, Persist logs to the Workers dashboard 선택, 로그 샘플링 100%를 확인했다. Traces·Issues는 꺼짐, 외부 목적지는 없음으로 유지했다. 코드 버전은 `28b5b036-8d5d-45ad-a748-5b325abd47aa` 그대로이며 새 배포 기록 ID는 `c50285b0-9618-4ffd-ae04-dd21344872e5`다. Pages 운영 배포도 그대로다.

```toml
[observability]
enabled = true
head_sampling_rate = 1
redact_query_string = true

[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
persist = true

[observability.traces]
enabled = false

[observability.issues]
enabled = false
```

요청 처리·상태·실행 시간·오류 및 기존 console 출력을 Cloudflare에서 조회할 수 있게 한다. URL 쿼리를 제거해 OAuth `code`·`state`와 검색값이 자동 URL 메타데이터에 남지 않도록 한다. 이 옵션은 [Cloudflare 공식 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/)에 정의돼 있다. 요청 본문·전사 내용·비밀값을 출력하는 코드는 추가하지 않는다. 경로 ID나 기존 오류 메시지까지 완전히 비식별화하는 설정으로 해석하면 안 된다.

Pages Functions 로그는 [공식 문서상 저장되지 않는 실시간 로그](https://developers.cloudflare.com/pages/functions/debugging-and-logging/#limits)다. `/api/*`를 실제 처리하는 별도 API Worker 로그를 저장하며, Pages·DB 로그 전체를 새 저장소로 옮기지 않는다. 외부 Logpush·R2·Datadog·추가 유료 저장소는 구성하지 않는다.

## 보관 기간과 무료 한도

| 기간 | Free 수집 한도 | 보관 기간 |
| --- | --- | --- |
| 현재, 2026-11-30까지 | 일 200,000 이벤트 | 3일 |
| 공식 변경 예정, 2026-12-01부터 | 일 0.5GB | 7일 |

현재 값은 [Workers Logs 요금 문서](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs), 변경 예정 값은 [Observability 요금 문서](https://developers.cloudflare.com/observability/pricing/) 기준이다. 계정 플랜을 업그레이드하거나 사용자 지정 장기 보관을 구매하지 않는다. 보관 기간은 제공자 플랜 정책이며 DB 데이터의 만료 기간이 아니다.

활성화 이후의 로그가 수집 대상이며, 꺼져 있던 기간의 개별 요청 로그를 소급해서 만드는 설정은 아니다. 쿼리 제거 옵션은 CLI 설정 동기화에서 수락됐으며 실제 OAuth·전사·오류 요청을 만들어 로그 내용을 시험하지는 않았다.

## 설정 복구

[set-cloudflare-logging.ps1](../scripts/deployment/set-cloudflare-logging.ps1)은 기본 실행 시 계획만 출력한다. `-Apply`에만 현재 Worker 버전 하나·트래픽 100%가 예상 버전과 같은지 확인하고, 같은 코드 버전에 로그 설정을 동기화한다. Disable은 로그 수집을 끄며 기존 저장 로그를 삭제하지 않는다.

```powershell
pwsh -File ./scripts/deployment/set-cloudflare-logging.ps1 -Mode Disable
```

실제 변경에는 `-Apply -ExpectedCurrentWorkerVersion <확인한 현재 버전> -WranglerPath <기존 Wrangler 경로>`를 전달한다. API 키나 Wrangler 인증 파일을 직접 읽지 않는다. Worker 코드만 롤백해도 이 비버전 관측 설정은 자동으로 복원되지 않으므로, 수집을 끄려면 Disable을 별도로 실행한다.

기존 [직전 데모 복구](releases/main-demo-2026-11-20.md)와 [최초 연동 전 전체 복구](demo-rollback-2026-11-20.md) 목표·회원·프로젝트·Gemini 설정은 유지한다. 변경 전 설정 파일·Worker 배포 정보·대시보드 증거와 변경 후 메타데이터는 `.cache/cloudflare-logs-20261120`에 보관한다. 추가 기능 테스트·오류 유도·로그 발생용 합성 요청은 실행하지 않는다.
