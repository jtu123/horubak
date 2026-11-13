# 관리자·서버 인증 구현

> 팀 공통 DB는 팀원이 GitHub에 올릴 구현을 기준으로 한다. 로컬 인증은 파일 SQLite를 사용한다. `horubak.pages.dev`의 Google 로그인 테스트는 Cloudflare에 별도로 배포한 SQLite 저장소를 사용한다. 팀 DB로 전환할 때 테스트 계정과 프로젝트를 자동 이관하지 않는다.

종류: 영상 편집 소프트웨어의 데스크톱 운영 화면.
기준: 현재 호루박의 토큰·표·버튼·라이트/다크 테마를 유지하고 Taste·Emil의 짧은 문구와 즉각적인 상태 피드백을 적용한다.

## 범위

- 회원가입·로그인·로그아웃·새로고침 복원을 서버 세션으로 처리한다.
- SQLite에 회원, 세션, 사용자별 프로젝트 편집 정보, 관리자 감사 이력을 저장한다. 영상 파일 저장·AI 큐·렌더는 별도 연결 범위다.
- 관리자는 회원 검색·역할 변경·이용 정지/복구, 프로젝트 검색·보관/복원, 작업 이력을 조회한다.
- 역할·소유자 검사는 API에서 수행한다. 첫 회원을 자동으로 관리자로 만들지 않는다. 서버 CLI로 기존 회원을 지정한다.
- 일반 회원과 게스트는 관리자 화면을 사용할 수 없다. 상태/역할 변경 시 서버에서 즉시 권한을 재확인한다.
- 기존 브라우저 계정과 프로젝트는 자동으로 서버에 전송하지 않는다. 샘플 이용은 명시적인 게스트 경로로 유지한다.

## 데이터와 검증

- 비밀번호는 무작위 솔트와 scrypt 해시로 저장한다. 세션 식별자는 HttpOnly 쿠키, 서버에는 식별자 해시를 보관한다.
- 변경 요청에는 세션별 CSRF 토큰과 출처 검사를 적용한다. 로그인·회원가입 시 세션을 교체한다.
- 일반 회원가입으로 관리자 역할을 지정할 수 없다. 자신의 권한 박탈·정지, 마지막 활성 관리자의 제거를 거부한다.
- 프로젝트 편집 정보는 소유자별 저장하고 워크스페이스 버전으로 오래된 저장을 거부한다. 관리자 보관/복원도 버전을 갱신한다.
- 실제 처리 큐·렌더·사용량이 없는 항목은 미연결로 표시한다.
- 로컬 SQLite는 단일 서버와 영속 디스크를 기준으로 한다. 기존 정적 배포 링크는 백엔드 배포까지 자동으로 변경되지 않는다.

## 확인할 사항

실제 HTTP 요청으로 회원가입·로그인·중복/오류·로그아웃·세션 재개, CSRF·출처·호출 제한, 타 사용자 프로젝트 접근, 일반 사용자 관리자 API 거부, 정지 후 세션 무효화, 자기 권한 보호, 보관·복원·저장 충돌·이력 비밀정보 제외를 검증한다. 브라우저에서 관리자/일반 회원 화면, 새로고침, 저장 오류, 두 기기 상태, 라이트/다크 및 데스크톱 폭을 확인한다.

기존 README는 수정하지 않는다. 변경 전 기준 커밋: `c17dc88f2ec0b5c29295863226b241191cd2e04d`.

## 실행과 첫 관리자 지정

Node.js 24 이상을 사용한다. 프로젝트의 두 터미널에서 다음을 실행한다.

```powershell
# 터미널 1: 프로젝트의 backend 디렉터리
pnpm install --frozen-lockfile
pnpm dev

# 터미널 2: 프로젝트의 frontend 디렉터리
pnpm dev
```

개발 주소는 `http://127.0.0.1:5173`이다. 관리자 지정을 요청한 사람에게 직접 로그인하도록 하고, 그 세션의 `GET /api/auth/me` 응답에서 `user.id`를 확인한다. 요청자와 세션의 소유자가 일치하는 것을 확인한 뒤 backend 디렉터리에서 `pnpm admin -- --verified-account <계정-ID>`를 실행한다. 이메일·비밀번호 가입 주소는 소유권이 검증되지 않으므로 주소만 보고 지정하지 않는다. 관리자 화면에서 역할을 변경할 때도 같은 기준을 사용한다. 지정된 회원의 세션은 종료되며 다시 로그인하면 `/admin`을 열 수 있다.

기본 DB 파일은 **backend 디렉터리에서 실행할 때** `backend/data/horubak.sqlite`이다. `DATABASE_PATH`로 영속 디스크 경로를 바꿀 수 있다. `-wal`, `-shm` 파일도 DB 운영 파일이므로 Git에 포함하지 않는다. 백업은 서버 정지 후 DB 파일을 복사하거나 SQLite의 일관된 백업 방식을 사용한다.

서버 계정은 예전 브라우저 데모 계정과 별개다. 이전 `moment.accounts.v1`과 사용자별 로컬 프로젝트는 자동 전송하거나 삭제하지 않는다. 정적 시연 빌드가 필요하면 `VITE_AUTH_MODE=demo`를 명시한다. 이 모드에서는 실제 관리자 페이지를 사용할 수 없다. API 실패가 발생했다고 데모 모드로 자동 전환하지 않는다.

## 소셜 로그인 설정

로그인·회원가입 화면의 네이버, 구글, 애플 버튼은 서버 인증 모드에서 동작한다. 운영에서는 웹과 인증 API가 같은 HTTPS 출처를 사용하도록 배포하고, 서버의 `APP_ORIGIN`에 그 출처를 지정한다. `backend/.env.example`의 값을 참고해 각 제공업체의 자격 증명을 서버에 설정한다.

| 제공업체 | 개발자 설정 | 등록할 콜백 경로 |
|---|---|---|
| 네이버 | 네이버 로그인 애플리케이션에서 이메일을 제공받는 항목으로 설정하고 Client ID와 Secret을 발급한다. 별명은 선택이다. | `/api/auth/social/naver/callback` |
| 구글 | Google Cloud에서 웹 OAuth 클라이언트와 동의 화면을 설정하고 Client ID와 Secret을 발급한다. | `/api/auth/social/google/callback` |
| 애플 | Apple Developer에서 웹용 Services ID와 인증 키를 발급하고 도메인과 반환 URL을 등록한다. Team ID, Key ID, .p8 키를 서버에 설정한다. | `/api/auth/social/apple/callback` |

각 경로 앞에는 실제 `APP_ORIGIN`을 붙인다. 애플은 등록한 HTTPS 도메인에서 `COOKIE_SECURE=true`로 실행해야 한다. 첫 로그인에는 이메일이 필요하고, 이후에는 제공업체의 사용자 ID로 같은 계정을 찾는다. 이미 다른 로그인 방식으로 등록한 이메일은 기존 방식으로 로그인해야 한다. 소셜 가입자의 기본 역할은 일반 회원이다.

## API

공통 오류는 `{ code, message }`이다. 인증·관리자 응답은 `Cache-Control: no-store`다. 변경 요청은 JSON, 정확한 `APP_ORIGIN`, `X-CSRF-Token`을 필요로 한다.

| 경로 | 동작·반환 |
|---|---|
| GET /api/auth/csrf | 익명/로그인 세션의 `{ csrfToken, headerName }` |
| POST /api/auth/signup | `{ name, email, password }` → `{ user, csrfToken }`, 역할은 항상 user |
| POST /api/auth/login | `{ email, password }` → `{ user, csrfToken }`, 세션·CSRF 교체 |
| GET /api/auth/me | 서버에서 확인한 `{ user, csrfToken }` |
| POST /api/auth/session/logout | `{ ownerId }`와 세션을 대조한 후 해당 세션 폐기·쿠키 삭제 |
| GET /api/workspace | 현재 세션의 `{ ownerId, projects, version }`, 보관 프로젝트 제외 |
| PUT /api/workspace/session | `{ ownerId, projects, version }` 저장 → `{ version }`, 계정 또는 버전이 바뀌면 409 |
| GET /api/projects/:id | 소유자만 프로젝트 조회, 다른 소유자의 ID는 404 |
| GET /api/admin/overview | 실제 DB의 회원·프로젝트 수와 연결 상태 |
| GET /api/admin/users | q·status·page·size 검색, 비밀번호/세션 정보 제외 |
| PATCH /api/admin/users/:id | role 또는 status와 5~300자의 reason |
| GET /api/admin/projects | q·archived·page·size 검색 |
| PATCH /api/admin/projects/:ownerId/:id | archived와 reason, 소유자 저장 버전 갱신 |
| GET /api/admin/activity | page·size로 감사 이력 조회 |

관리자 API는 매 요청 DB의 활성 상태와 역할을 검사한다. 회원의 권한 변경·정지 및 CLI 승격은 그 회원의 세션을 모두 폐기한다. 관리자 보관으로 인한 충돌은 사용자가 편집 정보를 백업하고 서버 상태를 다시 불러오는 흐름으로 처리한다.

## 배포 조건

`horubak.pages.dev`의 임시 Google 로그인은 Pages Functions의 `/api/*`에서 서비스 바인딩 `HORUBAK_AUTH`로 Worker `horubak-auth-test`에 요청을 전달한다. Worker의 Durable Object에 테스트 계정, 세션, 프로젝트를 저장한다. Google 테스트 클라이언트의 리디렉션 URI는 `https://horubak.pages.dev/api/auth/social/google/callback`이다. Client ID와 Secret은 Worker 시크릿으로 설정한다.

임시 프런트는 `VITE_AUTH_MODE=server`와 `VITE_AUTH_TEST=true`로 빌드해 `horubak` Pages 프로젝트에 직접 업로드한다. Git에 푸시 없이 적용한 테스트 배포다. 필요 시 Pages 배포 내역에서 이전 배포 `54aac94d-2795-43be-b99c-e8a5d528cf19`로 되돌릴 수 있다. 테스트 종료 후에는 팀 서버에 맞춰 `/api/*` 연결을 교체한다.

임시 Worker를 다시 배포할 때는 `backend`에서 `wrangler deploy --config wrangler.auth-test.toml`로 설정을 선택한다. 임시 Pages 빌드를 직접 배포하는 별도 작업 폴더에서는 `frontend/wrangler.auth-test.toml`을 `wrangler.toml`로 복사해 사용한다. 기본 Git 빌드가 테스트 Worker 바인딩을 선택하지 않도록 두 설정은 테스트용 이름으로 보관한다.

작업공간과 로그아웃의 쓰기 경로가 바뀌었다. 공개 테스트를 잠시 중단할 수 있는 시간에 열린 탭의 편집을 저장하거나 설정에서 백업한 뒤 Worker를 먼저 올리고 Pages를 이어서 배포한다. 구형 경로로 들어온 쓰기는 업데이트 안내와 함께 거부하며, 새 프런트도 구형 Worker의 작업공간을 채택하지 않는다. 배포 직후 새로고침한 탭에서 로그인·프로젝트 조회·저장·로그아웃을 확인한다. 롤백 시 Pages와 Worker를 같은 버전 조합으로 복구한다.

Node 서버에서 `ENABLE_SOURCE_UPLOAD=1`을 설정하면 파일 업로드와 원본 미리보기를 사용할 수 있다. 원본은 `UPLOAD_DIR`에 비공개로 저장되고 같은 계정의 프로젝트에서만 읽을 수 있다. SQLite 파일과 `UPLOAD_DIR`을 함께 보관한다. Pages 임시 Worker에서는 브라우저 미리보기만 제공한다.

기존 chatgpt.site 배포는 정적 프론트엔드다. 실제 회원/관리자 기능을 외부에 제공하려면 별도의 **실행 중인 Node 서버와 영속 디스크**가 필요하다. 해당 정적 배포에 브라우저 저장소를 사용한 가짜 관리자 기능을 추가하지 않는다.

단일 서버 배포 시 `FRONTEND_DIST`로 React 빌드 디렉터리를 지정해 웹과 API를 같은 출처에서 제공할 수 있다. 운영 환경은 HTTPS `APP_ORIGIN`, `NODE_ENV=production`, `COOKIE_SECURE=true`를 요구한다. 신뢰할 수 있는 프록시 한 대를 사용하는 경우에만 `TRUST_PROXY=1`을 설정한다. SQLite는 단일 서버 운영 기준이며, 다중 인스턴스·대규모 동시 쓰기는 외부 DB/공유 세션 저장소로 전환해야 한다. 원본 업로드·영상 접근 권한은 해당 미디어 API를 실제로 연결할 때 추가 검증해야 한다.

이메일 인증·비밀번호 재설정·MFA, 실제 작업 큐·비용·렌더·게시·지원 문의는 이 구현에 포함되지 않는다.

## 검증 기록

- Node HTTP 통합 검사: 11개 통과. 회원가입·중복·해시·CSRF/출처·관리자 CLI·권한/소유자 격리·버전 충돌·정지·역할 변경·로그아웃·세션 만료·DB 재연결·호출 제한·Secure 쿠키를 포함한다.
- 기존 프론트엔드 단위 검사: 64개 통과.
- Chrome 실제 동작: 회원가입, 관리자/일반 회원 분리, 별도 브라우저의 서버 프로젝트 복원, 권한 변경, 보관/복원, 오래된 저장 409와 수동 복구, 정지 후 재로그인 차단, 복구, 검색/빈 상태, 감사 이력, 로그아웃/재로그인 통과.
- 1440/1280 데스크톱 가로 넘침 없음. Taste 캡처 도구로 회원 목록 라이트·프로젝트 목록 다크 화면을 저장하고 확인했다. 스크린샷과 상세 실행 결과는 `.cache/admin-qa/`에 보관한다. 모바일 화면은 요청 범위에서 제외한다.
- 이 기록은 로컬 구현 검증이다. 외부 서버 배포·운영 트래픽·미디어 API·AI 처리 큐의 검증을 의미하지 않는다.

## 팀원 DB 코드 수신 후 연결 순서

1. 팀원의 데이터 모델과 회원/프로젝트 API·세션 방식을 확인한다. 테이블이나 인증 체계를 임의로 덮어쓰지 않는다.
2. `frontend/src/services/api.ts`의 호출·응답 매핑을 실제 API에 맞춘다. 관리자 화면은 이 어댑터를 통해 연결한다.
3. 팀 서버에 필요한 관리자 역할, 이용 상태, 프로젝트 소유자, 보관 상태와 감사 이력을 대조한다. 미구현 API는 필요한 계약으로 전달한다.
4. 임시 SQLite 계층을 팀원 DB/서버 구현으로 교체하고 실제 서버에서 역할·소유자·정지·세션 무효화·저장 충돌·이력을 다시 검증한다. 임시 구현에서 통과한 결과를 팀 DB 검증 결과로 간주하지 않는다.
5. 팀원 코드와 통합 검증을 마친 뒤 GitHub 반영·외부 배포를 진행한다.

설계 참고: [Node scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF 방어](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Express 운영 보안](https://expressjs.com/en/advanced/best-practice-security/).
