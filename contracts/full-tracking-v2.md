# 전체 영상 추적 v2 계약

2026-11-27 사용자 승인 범위: 원본 파일 4 GiB 이하·10시간(36,000초) 이하, 원본 전체 추적. 커밋은 사용자 승인 후, 운영 배포는 별도. 이전 25 MiB/120초 HTTP 분석은 호환용이며 새 UI의 전체 분석 경로가 아니다.

## 공통 데이터

모든 시간은 원본 초, 상자는 표시 방향 기준 정규화 xywh. 식별자는 서버 생성 UUID, 저장 객체는 서버가 생성한 경로만 허용한다. 대용량 파일은 브라우저 전체 arrayBuffer/Blob 재구성이나 Cloud Run /tmp 전체 다운로드를 금지한다.

```ts
type FullSource = {
  uploadId: string; filename: string; size: number; duration: number;
  width: number; height: number; objectKey: string; generation: string;
  checksum: string; // GCS CRC32C 또는 로컬 crc32-<8hex>; 전체 source SHA256과 구분한다.
};
type FullJob = {
  id: string; state: 'queued'|'running'|'cancelling'|'cancelled'|'interrupted'|'failed'|'completed';
  source: FullSource; processedSeconds: number; duration: number; sampleFps: number;
  chunkSeconds: number; completedChunks: number; totalChunks: number;
  sourceSha256: string|null; error: {code:string;message:string}|null;
  createdAt: string; updatedAt: string;
};
type UploadSession = { uploadId:string; uploadUrl:string; chunkBytes:number; expiresAt:string };
```

FullSource는 DB의 프로젝트 owner/id/revision과 연결한다. 객체 generation이 고정되므로 브라우저 파일 해시 없이 서버 저장 원본으로 재생·분석한다. 전체 SHA256은 작업에서 제한된 버퍼로 계산해 결과에 기록한다. 만료된 uploadUrl은 갱신/재시도하고 노출·로그·localStorage 저장하지 않는다.

## 브라우저 → 인증 API

접두사 `/api/tracking/projects/:id`. 모든 조회는 세션·프로젝트 소유권, 변경은 CSRF 검사. 구버전 원본·프로젝트 보관/삭제·사용자 상태 변화는 반영하지 않는다.

- `GET /source` → `{source:FullSource|null, upload:UploadSession|null}`. 준비 원본과 진행 중 업로드 복원.
- `POST /source` JSON `{filename,size,contentType}` → UploadSession. 등록한 프로젝트 원본 이름/크기와 일치, 최대4GiB. 기존 분석 작업 실행 중 원본 교체 거부.
- 브라우저는 uploadUrl에 8MiB 단위 `PUT`, `Content-Range: bytes start-end/size`. `308`+`Range`로 이어 올리며 마지막200/201 후 완료 API 호출. 상태 조회는 빈 PUT `bytes */size`. 파일은 `file.slice`로 전송. 인증 쿠키/CSRF/서버 토큰을 저장소로 전달하지 않는다.
- `POST /source/:uploadId/complete` → `{source:FullSource}`. 서버가 실제 객체 크기·메타데이터·영상 트랙·길이≤10시간·해상도≤16,777,216픽셀을 검사한 뒤 generation 고정. 이때 서버 원본 재생이 가능해진다.
- `GET /jobs/latest` → `{job:FullJob|null}`.
- `POST /jobs` JSON `{}` → 202 `{job:FullJob}`. 준비된 원본 전체0..duration, 기본2fps, 내부60초씩. 같은 원본의 실행 중 작업 중복 등록은 기존 작업 반환.
- `GET /jobs/:jobId` → `{job:FullJob}`. 새로고침/다른 브라우저에서도 복원.
- `POST /jobs/:jobId/cancel` → `{job:FullJob}`. 실제 워커 정리 전에는 cancelling. queued도 실제 실행/정리를 확인한다.
- `POST /jobs/:jobId/resume` → 202 `{job:FullJob}`. 실패·중단·취소 작업만, 고정 원본·설정 유지, 마지막 커밋 체크포인트부터 재개. completed는 중복 실행하지 않는다.
- `GET /jobs/:jobId/window?start=seconds` → `{job:FullJob, state:'missing'|'ready', result:TrackingResult|null, selections:Selection[]}`. 요청 시점이 포함된 저장60초 결과만 반환. TrackingResult는 기존 schemaVersion1/analysisId=job.id/sourceRevision=등록revision/createdAt=job.createdAt, source.duration은전체길이. 한 창 최대1440개 트랙·1440관측·1.5MiB. 장면 범위/관측/공백은 창 범위로 잘라 전송하되 전역 scene/track ID는 유지한다.
- `PUT /jobs/:jobId/selection` JSON `{windowStart,sourceRevision,sceneId,trackId:string|null}` → `{selections:Selection[]}`. 해당 창의 실제 트랙과 장면을 검증하고 job/scene별 저장. 상태·원본이 다른 이전 결과는 거부.
- `GET /api/projects/:id/source?version=uploadId`: 소유권 검사 후 요청한 단일 업로드 버전과 현재 준비 원본이 일치할 때만 임시 재생 URL로 redirect한다. 구버전·잘못된 형식·중복/객체형 version·현재 원본 없음은 `409 SOURCE_CHANGED`이며 다른 원본이나 Node 경로로 넘기지 않는다. URL 발급 중 원본이 바뀌어도 거부한다. version을 생략한 기존 요청은 현재 클라우드 원본을 재생하고, 없으면 기존 Node 원본 경로로 넘긴다. 버킷은 비공개 유지.

## Node/Cloudflare → Python 제어 API

기존 ANALYSIS_SERVICE_TOKEN bearer 인증. 호출 JSON과 응답은 작게 제한한다. `ownerId/projectId/uploadId/jobId`는 UUID. origin은 운영 APP_ORIGIN 또는 명시한 로컬 origin. 외부 임의 URL/버킷/객체 경로를 받지 않는다.

- `POST /api/full-tracking/uploads/init` `{ownerId,projectId,uploadId,filename,size,contentType,origin}` → `{uploadUrl,chunkBytes,expiresAt}`.
- `POST /api/full-tracking/uploads/complete` 위 init과 동일 식별/원본필드 → FullSource.
- `POST /api/full-tracking/source/playback` `{source:FullSource}` → `{url,expiresAt}`.
- `POST /api/full-tracking/jobs/create` `{jobId,source:FullSource}` → FullJob. 존재하면 동일 원본일 때만 멱등 반환.
- `POST /api/full-tracking/jobs/dispatch` `{jobId}` → `{executionId}`. local은 실제 자식 실행, gcs는 Cloud Run Jobs REST 실행. 운영 설정 없으면503, 샘플 성공 금지.
- `POST /api/full-tracking/jobs/status` `{jobId}` → FullJob.
- `POST /api/full-tracking/jobs/cancel` `{jobId}` → FullJob. 영속 취소 명령, 비협조/죽은 실행은 실행 상태 확인·정리 후 표시.
- `POST /api/full-tracking/jobs/resume` `{jobId}` → FullJob. 체크포인트 유지하고 dispatch.
- `POST /api/full-tracking/jobs/window` `{jobId,start}` → `{result:TrackingEngineResult|null}`. 실제 커밋된 창만.

## Python 저장소/워커 내부 경계

원본·작업 상태·체크포인트·분할 결과는 동일 비공개 저장소(local 테스트 드라이버/GCS). Node는 원본 연결·작업 소유자·선택·요약만 DB에 저장. Cloudflare도 공통 createApp/schema 사용.

`full_tracking_store.py`는 root 소유. 아래 인터페이스를 제공한다.

```python
class Conflict(Exception): pass
class Store:
    def read_json(self, key): ... # 존재: (dict, version문자열), 없음: (None, None)
    def write_json(self, key, value, expected=None): ... # expected=None unconditional, '0' create-only, 나머지 CAS. version 반환
    def source_url(self, source): ... # context manager -> (localhost Range/seek URL, metadata dict). 원본 전체다운로드 없음
    def source_sha256(self, source, heartbeat): ... # 스트리밍 SHA256, heartbeat 주기 호출
def create_store(): ... # 환경으로 local/GCS, 설정없음은 명시적실패
```

워커 소유 모듈 `full_tracking_job.py` 제공 함수:

```python
def create_job(store, job_id, source): ... # FullJob; plan.json/state.json 생성
def job_status(store, job_id): ... # FullJob
def cancel_job(store, job_id): ... # command.json 기록
def resume_job(store, job_id): ... # 영속체크포인트유지, 취소해제/queued. 별도dispatch
def read_window(store, job_id, start): ... # engine result|null
def run_job(store, job_id, external_guard=None): ... # 실제 전체분석. runner lease 확인 함수를 주입할 수 있음
```

실제 배치 실행 진입점은 `python full_tracking_dispatch.py`이다. `queues/tracking.json`의 CAS 대기열에 최대20건을 보관하고, 하나의 runner가 순서대로 `run_job()`을 호출한다. 작업마다 별도 대기 인스턴스를 실행하지 않는다.

작업 키는 `jobs/{jobId}/plan.json`, `state.json`, `command.json`, `checkpoint.json`, `chunks/{index}-{hash}.json`, 분석 lease는 `locks/tracking.json`이다. 짧은 청크마다 커밋; 같은청크중복커밋 금지. lease CAS의 runId/만료/heartbeat로 별도 Job 실행까지 동시1개 보장. lease를 잃으면 즉시 FFmpeg 정리. 전체 범위의 연속 커밋을 확인해야 completed; 검출0도 처리된 창으로 기록한다. 추적 활성상태·전역ID·장면·histogram을 체크포인트로 전달하고 내부 경계에서는 finish하지 않는다. 프레임은 제한된 버퍼로 순차 처리, PNG전체추출 금지. SIGTERM/취소/시간초과 때 자식 전체 종료·회수.

## 검증 경계

로컬 테스트는 실제 파일/DB/HTTP/모델/자식 워커를 사용한다. GCS·Jobs API 어댑터는 SDK·REST 호출 경계의 mock으로 검증하며 실제 클라우드 미배포를 명시한다. 10분 실제 모델 전체 처리 및 2분 이후/끝구간 확인, 10시간 경계와 한도 초과, 청크경계 ID유지, 재시작·취소·재개·중복실행·타사용자 거부를 검증한다. 현재 실행 결과와 남은 운영 검증은 [전체 영상 검증 기록](../docs/sfr-013-full-video-verification.md)을 기준으로 한다. README·원래작업폴더·운영데모·롤백자료 변경/커밋 금지.
