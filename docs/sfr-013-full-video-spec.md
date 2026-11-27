# SFR-013 전체 영상 추적 설계 v2

2026-11-27. 사용자 요청: 영상 등록 길이 상한을7일에서10시간으로, 전체 원본 추적, 리뷰2건 수정, 커밋 전 승인. 사용자가 앞서 제안한 원본 저장/백그라운드/분할처리 구조의 설계와 구현을 함께 승인했다. 재차 설계 승인을 기다리거나 자동 커밋하지 않는다.

## 모듈과 구현 순서

| 모듈 | 책임 | 선행 |
|---|---|---|
| source-storage | 비공개GCS/로컬시험 저장,재개가능직접업로드,원본generation 고정,Range/seek 읽기 | 인증 |
| tracking-job | 영속전체작업,단일실행lease,프레임순차분석,체크포인트,취소/재개,결과분할 | source-storage |
| tracking-api | 소유자·CSRF·원본revision·작업/선택DB,제어API 연결 | 위두모듈 |
| tracking-ui | 10시간등록,조각업로드,전체분석,진행복원,시간창상자/선택 | tracking-api |

상세 계약은 [full-tracking-v2.md](../contracts/full-tracking-v2.md). 기존NanoDet/추적코어·인증·클라우드DB를 재사용한다. 원본 4GiB/36,000초/16,777,216픽셀, 기본2fps. 10시간은영상길이상한이며 처리제한시간이아니다. 실제처리시간/정확도는장비와영상에의존한다. 자동크롭SFR014는별도이며 전체영상전사STT의기존레거시제한변경은이SFR013구현과혼동하지않는다.

## 주요 설계

- 브라우저는파일을8MiB씩저장소에직접전송한다. CloudRun/Worker를원본바이트프록시로쓰지않고4GB메모리할당을피한다. 연결실패는저장소offset확인후재개한다.
- 서버원본generation·저장소체크섬을고정해재생과분석을같은원본에연결한다. 전체SHA256은워커에서버퍼방식계산. 비공개임시접근URL/업로드세션을로그나localStorage에기록하지않는다.
- Python 제어 서비스는GCS/CloudRunJobs 어댑터를제공한다. 실제작업은별도프로세스/Jobs에서실행돼브라우저와제어HTTP요청수명에종속되지않는다. 작업·진행·취소명령·체크포인트는영속저장한다.
- 원본은승인된저장객체만Range/seek 방식으로읽고,서버/tmp에통째저장하지않는다. 마지막moov를가진MP4도다룬다. FFmpeg의외부참조/임의URL허용을풀지않는다.
- 내부60초경계에서도활성트랙과scene/ID를유지하고,장면전환시만ID를분리한다. 전체누적64개한도를없애고종료트랙은창별저장한다. UI는필요한시간창만읽는다.
- 실패는커밋된창의체크포인트부터재개하고같은원본/설정의결과를혼합하지않는다. completed는0..원본끝전체구간의처리확인후만표시한다. 검출없는구간도정상처리기록을남긴다.
- Python워커·FFmpeg를함께종료/회수하고,바쁨503과모델미준비503 및Retry-After를구분한다.

## 검증과 작업 경계

단위/계약→실제모델·영속작업→API·DB통합→데스크톱브라우저 순서. 경계테스트10시간/초과/4GiB, 전체10분영상,연속ID,취소/복구,중복실행,권한/CSRF,모델/저장소오류,리뷰회귀를확인한다. 실제GCS/CloudRunJobs 배포없이는운영완료로보고하지않는다. 기존데모/롤백을유지하며새자원·운영환경·커밋은사용자승인전변경하지않는다.

실행 결과와 미검증 운영 조건은 [전체 영상 검증 기록](sfr-013-full-video-verification.md)에 정리한다. 실제10분 미디어 검증과10시간 시뮬레이션을 구분한다.

## 공식 자료

- https://docs.cloud.google.com/storage/docs/resumable-uploads
- https://docs.cloud.google.com/run/docs/execute/jobs
- https://docs.cloud.google.com/run/docs/configuring/task-timeout
- https://docs.cloud.google.com/run/docs/container-contract
