# 전체 영상 전사 운영 연결

웹의 기본 한국어 전사는 최대 4GiB·10시간 원본을 참조하는 비동기 경로다. 기존 짧은 영상용 동기 multipart API의 HTTP 요청 한도는 그대로 유지한다. 큰 파일의 본문을 Cloudflare/Python API로 중계하는 방식으로 설정을 바꾸지 않는다.

## 기존 구성 재사용

- Cloudflare의 로그인·프로젝트 DB와 비공개 GCS 원본 업로드를 유지한다. `transcript_full_jobs`는 작은 작업 등록 정보를 위한 additive 테이블이며 긴 전사 본문은 GCS `stt-jobs/` 아래 구간별로 저장한다.
- Python 제어 서비스와 기존 `horubak-full-tracking` Job에 같은 새 분석 이미지를 적용한다. Job 정의의 기본 command/args는 기존 추적용 그대로 두며, 전사 실행에만 `args=["full_stt_dispatch.py"]`와 STT runner 환경을 override한다.
- 기존 버킷 접근, Cloud Run Jobs override 실행·조회 권한과 서비스 계정을 사용한다. API 키·서비스 계정 JSON 키를 새로 발급하지 않는다. 전체 전사 자체는 Gemini 호출이 필요하지 않다.
- Docker 빌드에 `full_stt*.py`가 포함돼야 한다. Whisper 모델은 기존 빌드 단계에서 준비하고 런타임 다운로드를 사용하지 않는다. `preloaded-model.json`의 모델 snapshot을 체크포인트에 고정하므로 모델 revision이 바뀐 경우 새 전사를 생성한다. 과거 완료 결과 조회는 유지한다.
- 구간당 오디오는 최대 304초·16kHz mono PCM으로 제한한다. 준비된 PCM을 NumPy 배열로 Whisper에 전달하므로 별도의 PyAV 재디코딩이 필요하지 않다.

기존 `TRACKING_STORAGE_DRIVER`, `TRACKING_GCS_BUCKET`, `TRACKING_JOB_RESOURCE`, `TRACKING_ALLOWED_ORIGINS`와 Secret Manager 참조를 유지한다. 선택적 `FULL_STT_CHUNK_TIMEOUT_SECONDS`는 기본 1,800초이며 30~7,200초 범위다. 이는 한 구간 추론의 제한이고 입력 영상 길이 제한이 아니다. 작업 제한·자원은 기존 Job 정의를 따른다. 실제 10시간 처리 시간은 별도로 측정해야 한다.

## 배포 순서

1. 현재 Pages 배포, 인증 Worker 버전, 분석 서비스의 실제 트래픽 리비전, Job 이미지 digest와 설정을 안전한 메타데이터로 기록한다. 비밀값은 읽지 않는다.
2. 새 이미지를 서비스의 no-traffic 리비전으로 준비하고 health·기존 설정 보존을 확인한다. 같은 digest로 Job 이미지를 갱신한 뒤 서비스 트래픽을 전환한다.
3. 인증 Worker에 신규 전사 라우트와 additive DB 스키마를 반영하고, 웹 자산을 배포한다. 기존 저장소·로그·원본·완료 결과는 보존한다.
4. 기존 서버 원본으로 전사 생성·진행·취소/재개·최종 조회를 확인한다. 첫·마지막 창, 새로고침 후 복원, 원본 재생, 다른 사용자·원본 거부도 확인한다. 긴 결과를 단일 DB 행으로 가져오지 않는다.

이 문서는 배포 절차이며 문서 추가 자체가 운영 반영 완료를 의미하지 않는다. 커밋·푸시·배포는 사용자의 승인 범위에 맞춰 진행한다.

## 롤백

문제 발생 시 기록한 서비스 트래픽·Job 이미지·Worker·Pages 버전으로 필요한 범위만 되돌린다. Worker나 이미지 교체가 이미 실행 중인 Job을 종료하지는 않는다. 해당 전사 작업의 취소와 실행 상태를 먼저 확인하고 관계없는 추적 작업을 일괄 종료하지 않는다.

DB의 신규 테이블, GCS 원본·전사 창·체크포인트와 과거 완료 결과를 삭제하지 않는다. 구 버전 웹에서는 전사 조회가 제공되지 않더라도 결과는 복구 후 다시 사용할 수 있도록 보존한다. 이번 개발 직전 운영 기준은 `.cache/tracking-cloud-scope-release-20261127-artifacts/rollback-runbook-final.md`에 있으며, 실제 배포 직전 최신 상태를 다시 측정한다.

## 검증 범위

테스트에는 4GiB·36,000초의 정확한 입력 경계, 분할 결과 조회, 오디오 offset·무음·오디오 없음, 경계 단어 배정, 체크포인트/모델 지문, 취소·하위 프로세스 종료와 소유권 검사를 포함한다. 실제 151,254,600바이트·262.757007초 표본도 로컬 Whisper small로 처리했다. 이것은 10시간 실제 파일의 처리량 측정이나 클라우드 배포 검증을 대신하지 않는다.
