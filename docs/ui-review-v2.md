# 호루박 UI v2 증거 검수

검수일: 2026-11-05. 검수 역할: Evidence Collector / EvidenceQA. 기준은 [UI 설계명세 v2](ui-design-spec-v2.md)와 후속 데스크톱 범위다. [Council 검토](council-ui-review-2026-11-05.md)의 모바일 논의는 현재 구현 요구사항으로 적용하지 않았다.

**최종 판정: 기록된 데스크톱 UI 검수 범위에서 발견한 두 결함은 수정·재검증되었고 미해결 결함은 0건이다.** 테스트21개와 TypeScript·프로덕션 빌드의 최종 통과 결과를 전달받았다. 아래 미실행 범위는 별도로 남긴다. 사용자의 본인 직접 검수나 초보 사용자 사용성 검증을 에이전트 검증으로 대체하지 않는다. 실제 인증·AI 분석·업로드·서버 저장·MP4 렌더링은 연결 전이다.

## 1. 검수 범위와 증거의 구분

명세 원문: “데스크톱 창 너비 1280px 이상만 지원한다. 작은 창은 동일 배치와 가로 스크롤을 사용한다.” “대화상자 종료 후 포커스 복원을 유지한다.” “완료 보고는 UI 구현·에이전트 검증·본인 검수·서버 미연결·초보 사용자 사용성 미검증을 구분한다.”

- 이 검수 담당자가 직접 수행: 코드 정적 감사, Git 변경 범위 확인, 로컬 JSON 집계, 대표 PNG 13장 육안 확인. 브라우저를 조작하거나 구현 파일을 수정하지 않았다.
- root가 수행하고 전달: 내장 브라우저 CUA의 화면·상호작용 검증, 실제 파일 다운로드 내용, 로컬 MP4 재생·재연결, 테스트·빌드 실행 결과. 아래 행동 결과는 해당 실행 기록에 근거하며 이 담당자의 독립 재실행을 의미하지 않는다.
- 사용자 본인 직접 검수: **NOT TESTED**. 초보 사용자 과업 성공률·소요 시간·오해 빈도: **NOT TESTED**.

이 저장소의 브라우저 증거는 실제 CUA 캡처와 실행 기록이다. 자동 캡처 스크립트를 실행한 것처럼 보고하지 않았다.

직접 읽은 파일: `README.md`, `docs/ui-design-spec-v2.md`, `docs/council-ui-review-2026-11-05.md`, `main.tsx`, `App.tsx`, `project-presentation.ts`와 테스트, `Editor.tsx`, `Results.tsx`, `Processing.tsx`, `Login.tsx`, `SignupForm.tsx`, `NewProject.tsx`, `Dashboard.tsx`, `VideoPreview.tsx`, `Modal.tsx`, `WorkspaceShell.tsx`, `CommandPalette.tsx`, `ProjectMenu.tsx`, `PillTabs.tsx`, `ToastShelf.tsx`, `tokens.css`, `app.css`, 가입·메뉴·빠른 실행 관련 CSS. Emil 디자인 지침의 Before/After/Why 형식을 적용했다.

## 2. 시각 증거와 명세 대조

42개 조합 측정값의 Git 보존본은 [레이아웃 검증 JSON](ui-v2-layout-matrix.json)이다. 최종 메인 화면은 [라이트](screenshots/v2/projects-light-1440.png)·[다크](screenshots/v2/projects-dark-1440.png), 편집 화면은 [다크](screenshots/v2/editor-dark-1440.png)로 기록했다. 기존 주소의 선택 구간 252~302초가 유지되는 것도 확인했다.

root는 기존 `127.0.0.1`의 자료와 분리된 `localhost:5173` origin에서 검수했다. `.cache/ui-v2-evidence/layout-matrix.json`을 직접 읽고 집계한 결과는 **42행, 가로 넘침 0, 요청 테마/실제 테마 불일치 0**이다. 화면은 프로젝트·등록·처리·편집·결과·로그인·가입 7개이고, 각 화면은 1280·1440·1920px 및 라이트·다크 6조합이다. 실행 기록의 뷰포트 높이는 각각 800·900·1080px이다. JSON에는 너비와 `client`/`scroll`/`theme` 값이 있고 높이·행동 성공·모든 요소의 가림 여부는 기록하지 않으므로 이 수치만으로 그 항목을 통과 처리하지 않는다.

직접 육안 확인한 PNG:

| 증거 | 확인한 모습 |
| --- | --- |
| `docs/screenshots/v2/baseline-projects-dark.png` | 변경 전 큰 소개·통계·최근 작업 영역과 프로젝트 카드 |
| `docs/screenshots/v2/baseline-editor-dark.png` | 변경 전 둥근 셸, 사이드바 등록 버튼, 내보내기 문구 |
| `.cache/ui-v2-evidence/projects-dark-1440.png` | 고정 사이드바, 제목/등록·최근 작업 한 줄·검색/필터·3열 카드 |
| `.cache/ui-v2-evidence/editor-light-1280.png` | 후보·중앙 미리보기/타임라인·설정 3열, 원본 구간과 샘플 안내 |
| `.cache/ui-v2-evidence/login-light-1280.png` | 소개 영역 없이 중앙 단일 양식과 샘플 시작, 데모 안내 |
| `docs/screenshots/v2/registration-light-1280.png` | 파일 선택·장르·이름 순서, 서버 전송 없음 안내 |
| `docs/screenshots/v2/context-review-1280.png` | 보정 전 9:43–10:24와 보정 후 9:35–10:24, 명시적 적용 버튼 |
| `docs/screenshots/v2/processing-cancelled-1280.png` | 준비 취소·중단 시점·다시 시작, 현재 단계/스피너 없음 |
| `docs/screenshots/v2/results-light-1280.png` | 구간·편집 확인됨·샘플 SRT/편집 JSON·MP4 미연결을 구분 |
| `docs/screenshots/v2/signup-errors-1280.png` | 4개 오류 요약·항목별 오류·이름 필드 포커스 표시 |
| `docs/screenshots/v2/results-notification-safe-1280.png` | 수정 후 알림이 하단 행동부와 떨어져 있고 두 결과 버튼이 노출됨 |
| `docs/screenshots/v2/results-notification-safe-1440.png` | 알림이 상단바 중앙에 있고 경로·상단 행동·결과 CTA와 겹치지 않음 |
| `docs/screenshots/v2/results-notification-safe-1920.png` | 넓은 창에서도 상단 알림과 결과 행동부가 분리됨 |

42개 PNG 전체를 개별 육안 확인했다고 주장하지 않는다. `.cache`는 Git 제외인 로컬 증거다. `docs/screenshots/v2/`는 주요 화면 기록이며 전체 페이지 캡처에는 스크롤 위치와 포커스에 따른 고정 요소 위치가 포함되어 있다.

| Before | After | Why |
| --- | --- | --- |
| 큰 소개·통계 벤토가 목록보다 먼저 보임 | 제목·등록, 최근 작업 한 줄, 검색/장르/정렬/보기, 3열 목록 | 명세의 작업 중심 프로젝트 구성을 직접 확인 |
| 화면마다 다른 큰 반경·셸 형태 | 216px 사이드바와 56px 상단바, 중립 표면과 파란 선택/주요 버튼 | CSS 수치와 대표 화면이 공통 디자인 계약에 맞음 |
| 사이드바에도 등록 CTA가 있음 | 사이드바는 내 프로젝트·즐겨찾기·편집 결과 | 중복 등록 CTA를 줄이라는 명세 반영 |
| 내보내기/완료 표현이 영상 출력으로 읽힐 가능성 | 편집 확인·편집 확인됨, 샘플 SRT/JSON, MP4는 출력 연결 전 | 화면과 `describeProject()`가 편집 상태와 렌더링을 구분 |
| 여러 전역 CSS 레이어를 main에서 가져옴 | `tokens.css`·`app.css`와 각 컴포넌트 소유 CSS | 실제 import와 diff에 근거한 책임 정리. 파일 개수만으로 충돌 감소를 단정하지 않음 |
| 검색·키보드·양식의 연출 지연 가능성 | 검색/팔레트/탭은 직접 상태 변경, 폼 오류는 즉시 포커스 | 코드에서 불필요한 지연·오류 흔들림을 확인하지 못함 |

대표 화면의 기본 배치에서 열이 겹치는 결함은 확인하지 못했다. 결과 다운로드 토스트의 하단 버튼 겹침은 수정 후 PNG 3장과 DOM 측정 기록으로 해소를 확인했다. 이는 표에 열거한 캡처 범위의 판단이며 사용성 개선 수치를 의미하지 않는다.

## 3. 행동 검증 기록

아래는 root가 실제 실행하고 전달한 결과다. 스크린샷만으로 저장·다운로드·재생 성공을 추정하지 않았다.

| 항목 | 전달받은 실행 결과 | 증거 수준/남은 범위 |
| --- | --- | --- |
| 검색·필터 복구 | `창작` 검색+강의 필터 0개 → 강의 제거 1개, 검색 입력으로 포커스 복귀 | 브라우저 실행 기록 |
| 긴 제목·목록·정렬·삭제 취소 | 77자 제목으로 이름 변경, 목록 전환·이름순 정렬 후 `scrollWidth=clientWidth=1265`; 삭제 확인→취소 후 대상 count1 | root의 최종 브라우저 실행 기록. 실제 삭제 완료는 이 기록의 검수 범위가 아님 |
| 프로젝트 메뉴·팔레트 | 메뉴가 viewport 안에 위치, Escape 종료. Ctrl+Shift+K 검색 후 Enter로 즉시 이동 | 브라우저 실행 기록+해당 코드 정적 확인 |
| 후보·보정·undo | 후보2 583–624초 → 보정 575–624초 → undo 583–624초, 재생 정지 | 브라우저 상태 기록+비교 캡처. 원본 초 단위와 명시적 적용 확인 |
| 실제 다운로드 | JSON의 `timeBase: source_seconds`, `rendered: false`; SRT는 0–49초의 3개 발화 | root가 실제 내려받은 내용 확인. 결과 화면만으로 통과 처리하지 않음 |
| 로컬 영상 | 공개 MP4 52.208초 등록, `paused=false`, 재생 오류 없음, 실제 후보 0개 | 브라우저 재생 상태 기록. AI 연결 성공을 뜻하지 않음 |
| 재연결·편집 유지 | 수동 5–40초·확대2·가로51% → 새로고침/원본 재연결 후 유지 | 브라우저 상태 기록. 짧은 새 원본과의 충돌 재현은 별도 기록 없음 |
| 취소·재시작 | heading=준비 취소, spinner=0, current=0. Enter 재시작 후 진행률0 | 실행 기록+취소 캡처. 실제 실패 상태 주입은 미실행 |
| 회원가입 | 필수4개 누락 시 이름 즉시 포커스 → 가상 로컬 계정 생성 → 리로드 세션 복원 | 오류 캡처+실행 기록. 서버 인증 검증이 아님 |
| 로그인 오류·중복 가입 | 오류 뒤 `activeElement.id=login-password`, 올바른 계정 로그인, 중복 가입 안내 후 이메일 포커스 | 오류 뒤 비활성 입력에 포커스하던 문제 수정 후 root 재검증 완료 |
| 계정 | 아바타는 메뉴만 열고 Escape 시 계정 버튼으로 복귀, 로그아웃 확인. 안내 종료도 수정 후 `activeElement`의 aria-label이 `계정 메뉴` | root의 실제 실패 재현·수정·최종 재검증 기록과 코드 확인 |
| 결과 알림 | 1280/1440/1920px에서 CTA·경로·콘텐츠와의 겹침 및 넘침 모두 false | `.cache/ui-v2-evidence/toast-checks.json` 직접 확인+수정 후 PNG 3장 육안 확인 |
| 테마 | 라이트/다크 42조합에서 요청값과 실제값 일치 | JSON 직접 집계. system 모드는 현재 2상태 계약에 없으므로 요구하지 않음 |

## 4. 정적 계약·검사 결과

`git diff --exit-code -- frontend/package.json frontend/pnpm-lock.yaml frontend/src/types.ts frontend/src/store.tsx frontend/src/services/contracts.ts`와 `git diff --numstat -- frontend/src/services`로 변경이 없음을 직접 확인했다. 기존 데이터 타입·저장 키·상태 저장 구현·API 계약·패키지/잠금 파일을 UI 변경이 바꾸지 않았다. `App.tsx`의 기존 라우트가 유지되고, 추가 표시 함수는 영속 필드를 추가하지 않는다. 이 감사에서 확인한 가입·메뉴·팔레트 파일에는 Lucian MIT 출처 주석이 남아 있다.

`describeProject()`는 processing/failed/cancelled 또는 잘못된 시간 구간에서 출력을 허용하지 않는다. SRT는 샘플에만 제공하고 JSON은 유효한 편집 구간을 필요로 한다. `Results.tsx`의 JSON에 `source_seconds`와 `rendered:false`가 보존되어 있다. 편집의 원본 재연결은 길이·이름·출처만 갱신하고 기존 edit는 덮어쓰지 않는다. 새 길이에 맞지 않는 편집은 `rangeError()`를 통해 표시·차단하는 구조다.

`tokens.css`는 명세의 라이트/다크 색상 값을 사용한다. `app.css`의 편집 열은 `260px minmax(400px,1fr) 280px`, 미리보기 높이는 440px/최대480px, 후보/전사 목록 최대560px이다. 1279px 이하에서 셸·로그인 최소폭1280px을 적용하므로 모바일 전용 배치는 없다. reduced-motion의 animation/transition 차단 규칙은 확인했지만 OS 설정을 켠 브라우저의 실제 동작은 미실행이다.

| 검사 | 상태 |
| --- | --- |
| 기존12개+표시/출력9개=21개 테스트 | root의 최종 실행 통과 보고 |
| TypeScript·Vite 프로덕션 빌드 | root의 최종 실행 통과 보고 |
| 빌드 산출물 크기 | `frontend/dist/assets`에서 CSS36,959bytes(36.96KB) / JS352,652bytes(352.65KB)를 직접 확인. root가 보고한 변경 전 CSS148.85KB 대비 감소했으나 크기 감소만으로 성능 향상을 단정하지 않음 |

## 5. 발견 사항과 미실행 범위

### 결과 토스트의 하단 행동 겹침 — 낮음, 해결·재검증 완료

`docs/screenshots/v2/results-light-1280.png`에서 “샘플 자막을 내려받았어요” 토스트가 결과 카드 하단 오른쪽 “내 프로젝트” 버튼 영역을 덮는 장면을 확인했다. 당시 `app.css`의 fixed bottom24px/right24px·폭360px 위치와 결과 행동부가 겹쳤다. 수정 전 버튼 클릭 실패까지 주장하지는 않는다. 상단 위치 변경과 결과 행동부 여백 조정의 두 대안을 전달했고 root는 전자를 적용했다.

최종 `app.css:71`은 알림을 top4px, 작업 영역 중앙, 높이48px로 배치한다. `ToastShelf.tsx`는 최신1개를 표시하고 제목·설명의 전체 내용은 DOM 텍스트와 title에 보존한다. 닫기 버튼·만료 처리도 코드에 남아 있다. 직접 읽은 `toast-checks.json`의 세 폭에서 `actionOverlap`, `breadcrumbOverlap`, `contentOverlap`, `overflow`가 모두 false이며, 수정 후 PNG 3장에서도 결과 버튼이 가려지지 않는다. 캡처의 스크롤 위치에 따라 고정 요소의 전체 페이지 이미지 위치는 달라질 수 있어, viewport 위치는 DOM 수치(top4px/bottom52px)와 함께 판단했다.

| Before | After | Why |
| --- | --- | --- |
| 결과 하단 CTA 위에 고정 토스트가 겹침 | 상단 48px 알림, 최신1개 표시 | 세 폭의 PNG와 DOM 측정에서 CTA·경로·콘텐츠를 가리지 않음 |
| 여러 하단 알림이 겹쳐 표시 | 최신 알림의 제목·설명 및 닫기만 표시, 전체 텍스트/title 보존 | 표시 면적을 제한하면서 피드백 내용과 종료 수단을 유지 |

### 계정 안내 종료 포커스 복원 — 중간, 해결·재검증 완료

초기 `frontend/src/components/lucian/WorkspaceShell.tsx:47`은 계정 메뉴 “사용 안내”에서 `setAccount(false);setHelp(true)`를 함께 호출했다. 포커스된 메뉴 항목이 제거된 다음 `Modal.tsx:6`이 현재 포커스를 저장하는 문제를 정적으로 전달했다. root는 계정 메뉴→사용 안내→Escape 후 `BODY`가 활성 요소가 되는 현상을 실제 재현했다. 계정 버튼을 먼저 포커스하는 최소 수정과 명시적 returnFocusRef의 두 대안 중 전자를 적용했다.

최종 코드는 `accountButton.current?.focus();setAccount(false);setHelp(true)` 순서다. root의 수정 후 재검증에서 안내 종료 후 활성 요소의 aria-label이 `계정 메뉴`임을 확인했다. 이 담당자는 변경 코드를 직접 읽었으며 브라우저 재현은 root의 실행 기록에 근거한다.

| Before | After | Why |
| --- | --- | --- |
| 포커스된 계정 메뉴 항목 제거 후 안내 열기, Escape 후 BODY | 계정 버튼에 먼저 포커스한 뒤 메뉴를 닫고 안내 열기, Escape 후 계정 버튼 | 유지되는 버튼을 Modal의 복원 대상으로 만드는 최소 수정. 실제 복원 결과 확인 |

README는 초기 감사에서 v1 벤토·모바일·12개 테스트·375px 검수 설명이 남아 있었으나 root가 v2 설명으로 교체했다. 갱신 파일을 다시 읽어 데스크톱1280px·42조합·21개 테스트·에이전트/본인 검수 구분·v2 이미지/검수 링크를 직접 확인했다. 문서 불일치는 해소되었다.

**NOT TESTED / 미실행:** 사용자 본인 직접 검수, 초보 사용자 사용성, 화면 읽기 프로그램, OS reduced-motion 실제 설정, 실제 실패 상태와 저장 공간 오류의 브라우저 주입, 새 원본 길이와 기존 편집 충돌의 실제 재현. 모바일 실기기는 지원 범위 밖이다. 모든 실패 모드나 실제 서버 보안이 완료되었다고 판정하지 않는다.

## 6. 최종 상태와 남은 검증

최종 단위 테스트/TypeScript/빌드, 긴 제목·목록·이름순 정렬·삭제 취소, 계정 안내 종료 포커스, 결과 토스트 겹침의 갱신 대기 항목은 해소되었다. 검수에서 확인한 두 결함 모두 수정 후 재검증되었으며 이 문서의 **실행·검토 범위에서 미해결 결함은 0건**이다. 새 코드의 추가 정적/시각 차단 결함은 확인하지 못했다.

사용자 본인 직접 검수 등 5절의 항목은 **NOT TESTED**로 남긴다. 구현 완료·에이전트 검수 완료·사용자 확인은 별개다. 미실행 검증과 서버 연결이 남아 있으므로 서비스 전체의 Production readiness는 **NOT DETERMINED**다. 별도의 수치 품질 점수나 “production ready” 평가는 하지 않는다.
