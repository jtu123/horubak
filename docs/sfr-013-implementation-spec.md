# SFR-013 주요 피사체 추적 구현 명세 v1

> 이전 구간 분석 경로의 기록이다. 현재 전체 영상 구현은 [설계 v2](sfr-013-full-video-spec.md)와 [연결 계약](../contracts/full-tracking-v2.md)을 기준으로 한다.

작성: 2026-11-27. 기준: GitHub main `6cdb4a2299dbd8dc77ba2541dc73f7048b64e8e6` 및 최종 39개 요구사항의 SFR-013. 사용자 요청은 설계와 구현을 함께 승인한 범위이며 커밋·푸시·배포는 포함하지 않는다.

## 목표와 경계

원본 영상의 연속 프레임에서 인물·물체 후보를 검출하고 같은 대상의 시간별 정규화 위치와 트랙 ID를 기록한다. 편집 화면에서 원본 전체 보기로 관측 상자를 확인하고 장면별 주요 대상을 선택·저장한다. SFR-014는 저장된 원본 지문·분석 ID·선택 트랙을 소비할 수 있다. 이번 기능은 자동 크롭·얼굴 신원 인식·장면 사이 재식별·OCR·영속 작업 큐를 구현하지 않는다.

OpenCV Zoo NanoDet 2022nov의 COCO 80개 지원 클래스를 CPU로 검출한다. 모델은 공식 고정 커밋과 SHA-256으로 검증하며 별도 Gemini 키나 외부 영상 전송이 필요하지 않다. 지원 클래스 밖의 물체·작은 대상·가림·교차 이동에서는 검출 실패나 ID 단절이 발생할 수 있으므로 빈 결과와 불확실성을 명시한다. 추적 관측 없이 상자를 꾸며 만들지 않는다.

## 제공 조건

- 파일 1개, 기존 분석 업로드 제한 25 MiB 유지. URL을 분석 서버에서 직접 열지 않는다.
- MP4·MOV·WebM, 원본 1시간 이하·총 16,777,216픽셀 이하를 지원한다. 4K는 포함하며 큰 원본 디코딩은 명시적으로 거부한다. FFmpeg의 단일 메모리 할당도 64 MiB로 제한한다.
- 원본 기준 구간 `0 <= start < end <= duration`, 한 요청 최대 120초, 기본 2fps, 최대 4fps, 최대 240개 프레임.
- 프레임당 검출 최대 12개, 결과 트랙 최대 64개, 관측 총 2,880개, JSON 응답 1.5 MiB 이하.
- 단일 Python 추론 프로세스와 기존 분석 lock을 공유하며 바쁨·시간 초과·모델 없음·손상 영상·검출 없음 상태를 구분한다. 초기 분석은 제한된 동기 HTTP 요청이며 영속 비동기 작업 완료로 표시하지 않는다.
- 원본 파일 SHA-256과 프로젝트 메타데이터 revision을 함께 저장한다. 메타데이터만으로 동일 파일이라고 판단하지 않는다. 재분석 결과에는 새 analysisId를 부여하고 이전 선택을 승계하지 않는다.
- 화면은 실제 분석에 사용한 원본 파일로 상자를 검토한다. 저장 결과를 다시 열 때 파일 지문을 확인할 수 없으면 재연결 안내를 표시하고 검증되지 않은 원본에 상자·선택을 적용하지 않는다.

## API 계약

브라우저 → 기존 인증 API:

1. `POST /api/tracking/projects/:id/analyze?start=...&end=...&sampleFps=2` — multipart `file` 하나. 성공 시 아래 envelope 반환. 파일 바이트는 Python으로 스트리밍하고 실제 분석 결과를 검증해 저장한다.
2. `GET /api/tracking/projects/:id` — `{state: 'missing'|'ready'|'stale', result: TrackingResult|null, selections: Selection[]}`.
3. `PUT /api/tracking/projects/:id/selection` — `{analysisId, sourceRevision, sourceSha256, selections: [{sceneId,trackId}]}`. 현재 결과에 존재하는 트랙만, 한 장면당 한 대상만 허용한다.

Node → Python: `POST /api/tracking/analyze?start=...&end=...&sampleFps=...`, 기존 bearer 인증과 multipart 크기 경계를 재사용한다. Python은 아래 엔진 결과만 반환하고 분석 ID·revision·생성 시각은 Node가 부여한다.

```ts
type Observation = { time: number; bbox: [number, number, number, number]; confidence: number };
type Track = {
  id: string; sceneId: string; classId: number; label: string;
  start: number; end: number; meanConfidence: number;
  observations: Observation[]; gaps: { start: number; end: number }[];
};
type TrackingEngineResult = {
  schemaVersion: 1; sourceSha256: string;
  source: { duration: number; width: number; height: number };
  range: { start: number; end: number; sampleFps: number };
  model: { name: string; version: string; sha256: string };
  scenes: { id: string; start: number; end: number }[];
  tracks: Track[];
  recommendations: { sceneId: string; trackId: string; reason: string }[];
  warnings: { code: string; message: string; start?: number; end?: number }[];
};
type TrackingResult = TrackingEngineResult & { analysisId: string; sourceRevision: string; createdAt: string };
type Selection = { sceneId: string; trackId: string };
```

시간은 원본 초 단위이며 관측은 오름차순이다. bbox는 원본 표시 방향 기준 `[x,y,width,height]` 정규화 좌표이며 화면 밖 상자·NaN·음수 크기를 거부한다. 추천은 수동 선택과 구분하며 저장 선택의 근거를 대체하지 않는다. 장면 전환 시 새 트랙 ID를 사용하고 관측 공백에는 상자를 표시하지 않는다.

분석 요청 시작·저장 직전 사용자/소유자/revision을 다시 검사한다. GET/PUT에도 동일 소유자 검사, 변경에는 기존 CSRF 검증을 적용한다. JSON 크기·프레임/트랙 개수·시간/좌표·ID 참조를 Node 경계에서 검증한다. 에러는 기존 `{code,message}` 형식과 HTTP 401/404/409/413/422/502/503/504를 사용한다.

## 저장과 UI

`project_tracking`은 `(owner_id,project_id)`를 키로 최신 결과·원본 지문·analysisId·sourceRevision·장면별 선택을 보관한다. 기존 사용자·프로젝트·전사 자료를 변경하지 않는 additive 테이블이다. 프로젝트 삭제는 함께 제거하고 원본 변경 시 stale로 반환한다. 대형 관측 배열은 workspace JSON이나 편집 undo에 넣지 않는다.

Cloudflare Worker도 공통 `createApp`과 `DATABASE_SCHEMA`를 사용하므로 동일 라우트와 테이블을 적용한다. 별도 DB 이전은 필요하지 않으며, 이번 작업에서 실제 Cloudflare·Cloud Run 배포나 운영 DB 변경은 수행하지 않는다.

편집기에 피사체 탭과 독립 TrackingPanel을 추가한다. 원본 파일 선택/재연결, 분석 구간, 분석 버튼, 진행·실패·빈 결과 안내, 원본 재생과 시간별 상자, 대상 목록·장면별 선택, 저장·재조회 상태를 제공한다. 원본 contain 좌표를 사용하며 기존 자막·수동 구도 설정은 유지한다. 대상 선택은 자동 크롭 적용으로 표시하지 않는다.

## 구현 순서와 검증

1. 계약/범위 고정 → Python 검출·추적 코어 → 실제 모델 표본 실행.
2. Node 권한·multipart·응답 검증·결과/선택 저장 → 인증 API 시험.
3. UI 패널·원본 상자·선택 저장 연결 → 빌드와 브라우저 확인.

검증은 두 대상 분리, 이동 후 같은 ID 유지, 가림/상실, 장면 전환 ID 분리, 검출 없음, 범위·크기·좌표 오류, 타 사용자 거부, 원본/reanalysis 충돌을 다룬다. 실제 모델과 실제 공개 표본 영상의 관측 결과를 확인하되 표본 한 건의 성공을 모든 영상 품질 보장으로 확대하지 않는다. 기존 frontend/backend 시험과 build를 실행한다. 모델 준비가 안 된 경우 샘플 성공으로 대체하지 않는다.

## 모델 출처

- OpenCV Zoo: https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/object_detection_nanodet
- 체크포인트 SHA-256: `4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186` (3,800,954 bytes)
- 모델 폴더 Apache-2.0 고지와 변경 표시를 함께 보관한다.
