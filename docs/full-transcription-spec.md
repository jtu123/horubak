# 전체 영상 한국어 전사 설계

## 목표와 범위

사용자의 한도 통일 요청에 따라 한국어 전사도 원본 등록과 같은 최대 4GiB·36,000초를 지원한다. 기존 짧은 영상용 동기 전사 API의 HTTP 업로드 한도를 크게 올리지 않는다. 웹의 기본 전사 경로는 확정된 서버 원본을 참조하는 비동기 작업으로 바꾼다. README는 수정하지 않으며 커밋·푸시·배포는 별도 승인 후 진행한다.

## 구조

- 기존 재개 가능한 원본 업로드와 비공개 GCS 원본을 공유한다. 브라우저와 Python API는 원본 전체를 메모리로 읽거나 HTTP 본문으로 중계하지 않는다.
- 전사 상태·불변 결과는 `stt-jobs/{jobId}/`에, 큐는 `queues/transcription.json`에 저장한다. Cloudflare DB에는 소유자·프로젝트·원본 revision·uploadId·source JSON·job 상태 등 작은 작업 등록 정보만 저장한다. 긴 전사 본문을 기존 750KiB 단일 DB 행으로 복제하지 않는다.
- 같은 Cloud Run Job 이미지·계정·리소스를 사용하고, 실행별 args만 `full_stt_dispatch.py`로 override한다. 기존 추적 dispatcher와 결과는 변경하지 않는다.
- `full_tracking_job.Lease(store, 'stt:'+jobId)`로 모델 처리 잠금을 공유한다. 모델 추론 동시 1개를 유지한다. 종류별 큐 runner가 동시에 시작해 잠금을 기다리는 컨테이너는 생길 수 있으며, 전체 컨테이너 동시 개수까지 1개라는 보장은 하지 않는다.
- 300초 소유 구간에 앞뒤 2초 오디오 여유를 두고 16kHz mono PCM만 유한 크기로 추출한다. 오디오 시작 시각과 원본 시각을 정렬하고, 단어의 중심 시각을 기준으로 소유 구간에 배정해 경계 중복을 방지한다. 오디오 트랙 없음은 명시적 오류이고, 무음 구간의 빈 전사는 정상이다.
- 체크포인트는 원본 generation·지문·모델/언어/설정과 결합한다. 불변 결과 저장 후 manifest를 CAS로 커밋한 구간만 진행률에 반영한다. 취소·실패·SIGTERM·timeout은 FFmpeg·Whisper 하위 프로세스까지 종료·회수한다.
- 웹은 원본 업로드 bytes와 전사 처리 초·구간 수를 분리해 표시한다. 종료/탭 이동은 조회만 중단하고, 명시적 중단 버튼만 서버 작업을 취소한다. 결과는 시간창 단위로 조회·표시한다.

## 공통 계약

`FullTranscriptionJob`은 `{id,state,source,processedSeconds,duration,chunkSeconds:300,completedChunks,totalChunks,segmentCount,sourceSha256,error,createdAt,updatedAt}`이다. `source`와 상태 값은 기존 전체 추적의 계약을 따른다. `sampleFps`는 없다. 오류는 `{code,message}` 또는 null이다.

`TranscriptWindow`는 `{jobId,index,start,end,source,sourceSha256,segments}`이다. segments는 `{segmentIndex,startSeconds,endSeconds,text}`이며 원본 절대 시각·안정적인 index를 사용한다. 창 응답은 512KiB 이하로 제한하고 전사 본문은 최대 2,000자/항목, 창당 최대 2,000개로 제한한다. 원본 전체 전사 개수를 임의로 10,000개에 잘라 저장하지 않는다.

웹 API:

```text
POST /api/transcripts/projects/:id/jobs                  -> 202 {job}
GET  /api/transcripts/projects/:id/jobs/latest           -> {job:null|FullTranscriptionJob}
GET  /api/transcripts/projects/:id/jobs/:jobId           -> {job}
POST /api/transcripts/projects/:id/jobs/:jobId/cancel    -> {job}
POST /api/transcripts/projects/:id/jobs/:jobId/resume    -> 202 {job}
GET  /api/transcripts/projects/:id/jobs/:jobId/window?start=0
     -> {job,sourceRevision,state:'pending'|'ready',window:null|TranscriptWindow}
POST /api/transcripts/projects/:id/context-check?start=0&end=60
     body: {expectedJobId,expectedSourceSha256} (새 비동기 전사)
```

Python 내부 인증 API는 `/api/transcripts/full/jobs/{create,status,dispatch,cancel,resume,window,context}`에 POST한다. create 입력은 `{jobId,source}`, window 입력은 `{jobId,start}`, context 입력은 `{jobId,start,end}`, 나머지는 `{jobId}`다. create/status/cancel/resume은 Job 자체를 반환하고 window는 `{state,window}`를 반환한다. context는 기존 맥락 검토 결과와 같은 형식이다.

서버는 클라이언트의 임의 source JSON·저장소 URL을 신뢰하지 않고 기존 원본 업로드 테이블에서 source를 조회한다. 모든 요청 전후에 사용자·프로젝트·revision·uploadId·generation을 다시 검사한다. 전사 작업도 활성 상태인 동안 원본 교체를 차단한다. 기존 전사 GET/analyze API는 호환 유지한다. 맥락 검토는 새 전사 작업이 있으면 완료된 최신 동일 원본 작업의 필요한 창과 앞뒤 발화만 읽고, 없으면 기존 DB 전사를 사용한다. 맥락 입력 시간 상한은 36,000초로 전사 HTTP 한도와 분리한다.

맥락 요청은 화면이 읽은 전사의 jobId·sourceSha256을 전달하고 서버는 최신 완료 작업과 요청 전후 일치하는지 검사한다. 다른 탭에서 새 전사가 생성되면 이전 전사의 근거와 새 검토 결과를 섞지 않고 재조회를 요구한다. 생성·재개 응답 대기 중 취소된 예약은 늦은 응답이 도착해도 다시 실행하지 않는다.

## 완료 기준과 검증

- 정확히 4GiB·10시간 입력 수락 및 초과 거부. 클라우드 HTTP에 큰 파일 본문이 전달되지 않음.
- 원본 generation/소유자·job/window가 다른 지연 응답 차단, 활성 전사 중 원본 교체 거부.
- 300초 경계·오디오 offset·무음·오디오 없음·부분 마지막 구간·재개 후 시간/ID/중복 검증.
- 취소·timeout·실행 종료 후 체크포인트 복구와 다른 실행의 잠금·결과 보존.
- 750KiB를 넘는 전체 전사도 창별 조회하며 기존 DB 제한에 걸리지 않음. 1시간 이후 맥락 검토 가능.
- 프런트·백엔드·Python 관련 회귀 테스트 및 타입 검사·빌드, 실제 미디어 도구를 사용한 bounded 오디오 처리 검증. 실제 10시간 파일의 처리 시간은 별도 성능 측정이며 보장하지 않는다.

## 공식 근거

- [Cloud Run 실행별 args override](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run#ContainerOverride)
- [faster-whisper 전사·단어 시간 정보](https://github.com/SYSTRAN/faster-whisper)
