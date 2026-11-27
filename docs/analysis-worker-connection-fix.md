# 분석 서버 연결 HTTP 502 수정

## 문제와 변경

Cloudflare Workers에서 지원하지 않는 `redirect: 'error'`를 공통 분석 호출에 사용해 외부 요청 전에 TypeError가 발생했다. 이 예외는 HTTP502 / `ANALYSIS_UNREACHABLE`로 처리되어 Cloud Run에 요청 기록이 없었다. Node는 이 옵션을 지원하므로 기존 Node 테스트만으로는 차이를 발견하지 못했다.

`backend/src/analysis.ts`는 `redirect: 'manual'`로 요청하고 3xx를 거부한다. 리디렉션 대상에 서비스 인증 헤더를 전달하지 않는다. 브라우저에서 수행하는 GCS 업로드의 Fetch 설정은 별도이므로 변경하지 않았다.

- [Cloudflare Request API](https://developers.cloudflare.com/workers/runtime-apis/request/#parameters)

인증401/403, 리디렉션, 실제 전송 실패, 시간 초과, 잘못된 응답을 구분한다. 기존 제공자의409/503 오류 코드와 Retry-After는 보존한다. 잘못된 분석 서버 URL 설정은 원문 대신503 설정 오류로 처리한다.

## 안전한 진단

실패 시 `analysis_request_failed` 경고에 서버 생성 `requestId`, 고정 오류 코드, 공개 HTTP 상태, 확인된 업스트림 상태, 허용된 예외 이름만 기록한다. 같은 requestId를 API 오류 응답에도 제공한다. 요청 본문·파일명·토큰·쿠키·주소·서명 URL·원본 예외 메시지는 기록하지 않는다.

## 관리자 인증 연결 확인

- 기존 공개 `/api/health`의 설정 플래그·로그인·DB 확인 동작은 유지한다.
- 관리자 화면의 **분석 서버 연결 확인**은 버튼을 눌렀을 때만 실행한다.
- 새 Worker/Node API: `GET /api/admin/analysis/connectivity`, 로그인한 관리자만 접근.
- 이 API는 서비스 Bearer로 Python `GET /api/health`를 호출한다. Python의 기존 공개 `/health`는 그대로 유지한다.
- Python `/api/health`는 기존 ServiceBoundary의 서비스 인증을 통과해야 하며 상태만 반환한다. 모델 추론·Gemini 호출·원본 업로드·GCS·Jobs 처리를 하지 않는다.
- 인증된 정상 응답에만 `status: verified`, `scope: authenticated-service`, `checkedAt`을 반환한다. 관리자 화면은 이 확인을 저장소·실제 추적 실행 성공으로 표시하지 않는다.
- 네트워크 응답이 정상이어도 상태 형식이 잘못되면 안전한 오류와 진단 ID를 반환한다.

## 회귀 검증

- Node의 실제 localhost HTTP 서버로 POST·인증 헤더·리디렉션 차단·오류 분류·민감정보 비노출을 확인한다.
- 고정한 Wrangler/Miniflare 개발 의존성으로 실제 workerd와 Durable Object → Node HTTP/Express 경로를 검증한다. 정상 응답과302/307,401/403,시간 초과를 다룬다.
- 관리자 권한·무추론 인증 경로·기존 공개 health 유지와 프런트의 응답 범위 검증을 확인한다.

```powershell
# backend
pnpm test
pnpm exec tsc --noEmit

# frontend
pnpm test
pnpm build

# ai-server의 준비된 Python 환경
python -m pytest tests/test_service_health.py -q
```

Workers 테스트는 로컬 런타임 프로세스와 임시 HTTP 서버를 사용한다. 운영 서버·실제 비밀키·영상·Gemini는 필요 없다. 테스트 종료 시 임시 서버와 workerd를 정리한다.

### 2026-11-27 로컬 확인 결과

- backend 기본 `pnpm test`:56개 통과(실제 Workers 테스트7개 포함), 실패·건너뜀0.
- frontend 전체 Vitest:137개 통과.
- Python 신규 서비스 상태 API 집중 테스트:3개 통과. 이번 변경에서 AI 전체 테스트를 다시 실행한 것은 아니다.
- backend TypeScript/빌드, frontend TypeScript/프로덕션 빌드, diff whitespace 검사 통과. 기존500kB 초과 프런트 번들 경고는 유지된다.
- Workers의 manual 설정을 일부러 error로 바꾼 회귀 확인에서7개 모두 실패했고 원본 바이트·지문을 정확히 복원했다.
- 격리된 로컬 메모리 DB와 무추론 시험 응답을 사용한 브라우저에서 관리자 버튼의 미확인→확인중→인증연결확인됨, 확인 시각과 별도 저장소 검증 문구, console error/warn0을 확인했다. 시험 서버는 종료했다.
- 독립 코드 리뷰에서 진단 ID 누락1건을 보완했고 추가 차단 문제는 발견하지 못했다.

위 결과는 로컬 수정 검증이다. 운영 데모에는 아직 반영하지 않았으며 실제 첨부 영상의 재업로드·추적 완료·클라우드 재생을 검증한 결과로 사용하지 않는다.

## 배포 시 주의

실제 파일 업로드 오류 수정은 API Worker의 공통 전송 변경에 해당한다. 새 관리자 인증 연결 확인 기능을 함께 제공하려면 Python의 새 `/api/health` 경로도 먼저 배포해야 한다. 기존 Python에 새 관리자 화면만 연결하면 연결 확인 버튼은404로 실패한다.

커밋·푸시·병합·배포는 사용자 승인 범위에 맞춰 진행한다. 이전 Pages/Worker 버전과 Cloud Run 리비전을 기록하고 DB·원본·결과·서비스 비밀값을 보존한다. 배포 후 승인된 영상으로 업로드 완료, 전체5개 구간 처리, 원본 지문, 처음·중간·마지막 결과, 새로고침 후 복원, 클라우드 원본 재생을 확인한다. 로컬 회귀 통과를 운영 영상 처리 완료로 보고하지 않는다.
