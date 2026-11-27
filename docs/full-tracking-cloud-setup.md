# 전체 영상 추적: 운영 연결과 롤백 준비

이 문서는 **배포 준비 자료**이다. 이번 구현에서 운영 버킷·IAM·Cloud Run Job을 만들거나 기존 데모를 배포하지 않았다. 커밋도 사용자 승인 전에는 하지 않는다.

## 구성

기존 Cloudflare Pages·Auth Worker·Durable Object DB와 Python Cloud Run 제어 API를 유지한다. 원본·결과·작업 상태에는 비공개 Google Cloud Storage 버킷을 추가하고, 같은 분석 이미지의 `full_tracking_dispatch.py`를 Cloud Run Jobs에서 실행한다.

원본은 브라우저에서 저장소로 재개 가능한 업로드를 한다. API에는 원본 바이트 대신 식별자와 상태만 전송한다. 서버가 확정한 객체 generation을 FFmpeg의 단일 객체 전용 loopback Range 서버로 읽으므로 4GB 원본을 Cloud Run 메모리나 임시 폴더에 통째로 저장하지 않는다.

`queues/tracking.json`은 CAS로 보호되는 영속 대기열이다. 한 runner가 최대20건의 대기 작업을 순서대로 처리하므로 대기 작업마다 별도의 유료 실행 인스턴스를 만들지 않는다. 개별 분석의 추가 lease와 체크포인트 CAS도 유지한다. 취소·SIGTERM·실패 시 FFmpeg와 자식을 정리하고, 실패한 창은 커밋하지 않는다.

## 운영자가 준비할 항목

1. Cloud Run과 같은 리전의 **비공개 버킷**. 공개 접근 차단과 uniform bucket-level access를 사용한다. 아래 CORS와 원본/결과 보관 기간을 설정한다. `.env`·키 파일을 업로드하지 않는다.
2. 제어 서비스와 작업에 사용할 서비스 계정. 버킷 객체에 필요한 읽기·생성·교체 권한을 해당 버킷으로 제한한다. JSON 서비스 계정 키를 발급해 브라우저나 Worker에 넣지 않고 ADC를 사용한다.
3. 제어 서비스 계정에 해당 Job의 실행/override 및 실행 상태 조회 권한을 준다. 임시 재생 URL에는 지정 signer 서비스 계정의 `iam.serviceAccounts.signBlob` 권한이 필요하다.
4. 분석 이미지로 Cloud Run Job을 준비한다. 명령은 `python full_tracking_dispatch.py`, task 수1·parallelism1·CPU1·메모리2GiB부터 시작한다. 전체 작업 제한 시간은 예를 들어86,400초로 설정하고 재시도 횟수는2회로 제한한다. 이는10시간 영상이24시간 안에 처리된다는 성능 보장이 아니다. 실제 장비에서 처리량과 메모리를 측정한다.
5. Job과 제어 서비스에 아래 환경을 설정한다. 제어 서비스가 Job을 실행할 때 `HORUBAK_TRACKING_RUNNER_ID`와 `HORUBAK_TRACKING_JOB_ID`를 실행별 override로 전달한다. 이 값은 사용자 비밀키가 아니다.

```text
TRACKING_STORAGE_DRIVER=gcs
TRACKING_GCS_BUCKET=<private-bucket>
TRACKING_JOB_RESOURCE=projects/<project>/locations/asia-northeast3/jobs/<job-name>
TRACKING_SIGNER_SERVICE_ACCOUNT=<signer-service-account-email>
TRACKING_ALLOWED_ORIGINS=https://horubak.pages.dev
```

기존 `ANALYSIS_SERVICE_TOKEN`, Gemini 비밀값 및 STT 설정은 기존 Secret Manager 연결을 유지한다. 저장소 URL과 Job API를 호출하는 데 Gemini 키를 사용하지 않는다. 전체 추적 자체도 Gemini API 호출이 필요하지 않다.

GCS 클라이언트의 ADC 자격 증명은 Cloud Run Jobs 실행·상태 조회와 IAM 재생 URL 서명에도 사용한다. `GCSStore`는 클라이언트를 만들 때 `cloud-platform` OAuth 범위를 명시한다. Storage SDK의 기본 Storage 전용 범위로는 이 세 경로를 모두 호출할 수 없다. OAuth 범위는 IAM 역할과 별개이므로 위의 버킷·Job·서명 권한 제한은 유지하며, 서비스 계정 JSON 키를 추가하지 않는다.

이 인증 범위 수정은 Python 이미지에 포함되므로 제어 서비스와 추적 Job을 같은 새 이미지로 업데이트해야 한다. 기존 버킷의 업로드 원본과 작업 상태는 보존한다. 배포 후에는 저장된 원본으로 작업 실행·결과 조회·재생을 확인한다. 로컬 SDK 회귀 테스트 통과만으로 운영 연결까지 완료됐다고 판단하지 않는다.

버킷 CORS 예시:

```json
[
  {
    "origin": ["https://horubak.pages.dev"],
    "method": ["PUT", "GET", "HEAD"],
    "responseHeader": ["Content-Type", "Range", "Content-Range", "Accept-Ranges"],
    "maxAgeSeconds": 600
  }
]
```

브라우저가 업로드 세션 URL을 읽어 전송하므로 HTTPS·CORS·만료·실제 업로드 완료를 확인한다. 세션 URL은 하나의 원본에 대한 접근 권한이므로 로그·분석 도구·localStorage에 기록하지 않는다. 객체는 서버 생성 `originals/{ownerId}/{projectId}/{uploadId}` 경로로만 저장한다.

## 활성화 순서

새 이미지와 비공개 저장소/Job을 준비한 뒤 운영과 분리된 staging에서 업로드·중단 재개·전체 추적·취소·복구·타 사용자 거부를 확인한다. 실제10시간·4GB 처리량은 별도 운영 검증 범위이다. 아직 측정하지 않은 완료 시간이나 무료 사용을 보장하지 않는다.

연결 확인 후에만 Worker/Node의 `FULL_TRACKING_ENABLED=1`을 켜고 프런트를 배포한다. 기본값은0이다. 기존 로그인·DB·프로젝트·전사 경로는 그대로 둔다. 새 DB 테이블은 additive schema로 적용한다.

## 롤백

- 활성화 전 Pages 배포 ID, Worker 버전, Cloud Run 리비전과 환경 설정을 별도 기록한다. 기존 `docs/demo-rollback-2026-11-20.md` 자료를 덮어쓰지 않는다.
- 새 작업 등록을 막으려면 `FULL_TRACKING_ENABLED=0`으로 되돌린다. 실행 중인 작업은 플래그만 내려도 자동 종료되지 않으므로 먼저 취소 요청과 실행 종료를 확인한다.
- 필요하면 기록한 Pages/Worker/Cloud Run 리비전으로 복구한다. 버킷·결과·추가 테이블은 즉시 삭제하지 않아 재개와 조사 근거를 보존한다.
- 원본과 중단된 업로드/분석 결과에는 운영자가 정한 보관·정리 정책을 적용한다. 프로젝트 삭제로 DB 연결이 제거돼도 버킷 객체를 즉시 삭제했다고 보고하지 않는다.

## 로컬 검증

`TRACKING_STORAGE_DRIVER=local`, `TRACKING_LOCAL_DIRECTORY=<전용 경로>`, `TRACKING_LOCAL_PUBLIC_URL=http://127.0.0.1:<분석포트>`, `TRACKING_ALLOWED_ORIGINS=http://127.0.0.1:<웹포트>`를 명시한다. 이 모드는 Cloud Run 환경에서 거부된다. 실제 파일·영속 상태·자식 프로세스·모델을 사용하며 가짜 분석 성공 화면이 아니다. 운영 GCS/Jobs 어댑터의 로컬 mock 검증을 실제 클라우드 배포 검증으로 표시하지 않는다.

## 공식 자료

- [Cloud Storage 재개 가능 업로드](https://docs.cloud.google.com/storage/docs/resumable-uploads)
- [Cloud Run Jobs 실행과 override](https://docs.cloud.google.com/run/docs/execute/jobs)
- [Cloud Run Jobs 제한 시간](https://docs.cloud.google.com/run/docs/configuring/task-timeout)
- [Cloud Run 파일 시스템과 메모리](https://docs.cloud.google.com/run/docs/container-contract)
- [Python Cloud Storage SDK](https://docs.cloud.google.com/python/docs/reference/storage/latest/google.cloud.storage.blob.Blob)
- [Cloud Run Jobs 실행 OAuth 범위](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run#authorization-scopes)
- [IAM signBlob OAuth 범위](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob#authorization-scopes)
