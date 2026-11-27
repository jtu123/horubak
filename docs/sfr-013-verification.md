# SFR-013 구현·검증 기록

> 최초 구간 분석 구현의 검증 기록이다. 전체 영상 지원의 설계·조건은 [설계 v2](sfr-013-full-video-spec.md), 운영 준비는 [클라우드 연결 안내](full-tracking-cloud-setup.md)를 참고한다.

작성: 2026-11-27 (한국 시간). 기준 main: `6cdb4a2299dbd8dc77ba2541dc73f7048b64e8e6`. 작업 브랜치: `kjh-sfr-013`.

## 구현 결과

- NanoDet CPU 검출 → 장면별 같은 대상 연결 → 원본 시간·정규화 위치 기록 → 주요 대상 선택과 저장을 연결했다.
- 편집기의 **피사체** 탭에서 실제 원본을 연결하고 분석한다. 원본 SHA-256을 확인한 뒤 관측 상자와 대상 목록을 표시한다.
- 프로젝트 접근 권한·CSRF·입력/결과 한도·분석 중 원본 변경·재분석 충돌을 검사한다. 저장 선택은 분석 ID와 원본 지문에 연결한다.
- 원본 전체 보기의 상자를 사용하므로 기존 자막·수동 크롭은 유지한다. SFR-014 자동 크롭은 이 결과를 소비할 별도 기능이다.
- Node와 Cloudflare Durable Object는 공통 앱/스키마를 사용한다. `project_tracking`은 기존 DB에 추가되는 테이블이며 DB를 이전하지 않는다.

## 확인한 결과

| 검증 | 결과 |
|---|---|
| 백엔드 전체 테스트 | 25개 통과, TypeScript 빌드 통과 |
| 프런트 전체 테스트 | 118개 통과, TypeScript·Vite 빌드 통과 |
| Python 추적 테스트 | 36개 통과: 이동·복수 대상·가림·장면 전환·입력/잠금/시간 초과·메타데이터·해상도 제한 |
| 실제 모델 → Python → Node → SQLite | 기존 공개 PL 표본의 0–6초/2fps 분석, 28개 트랙·47개 관측 반환. 주요 대상 저장 후 GET 복원 확인 |
| 실제 모델 독립 표본 | 기존 UCL 표본의 0–6초/2fps에서 36개 트랙·114개 관측, 최장 트랙 12회 관측 |
| 브라우저 | 별도 로컬 테스트 계정으로 원본 파일 연결·지문 확인·재분석·상자 표시·장면별 선택·저장·다시 불러오기 확인 |
| 실제 미디어 경계 | 90도 회전의 표시 크기/좌표 방향, 빈 화면과 장면 전환, 검출 없음 안내, 네트워크 플레이리스트 거부 확인 |
| 독립 코드 리뷰 | UI가 정상 trailing gap을 거부하던 오류와 Docker 모델 폴더 쓰기 권한 오류를 수정, 재검토에서 추가 차단 문제 없음 |
| Cloudflare 로컬 번들 | Wrangler 4.160.1 `deploy --dry-run --config wrangler.auth-test.toml --compatibility-flags nodejs_compat` 성공. 추적 API·검증기·테이블 포함 확인. 원격 업로드 없음 |

API 검증에는 실제 운영 계정·DB·Gemini 키를 사용하지 않았다. 새 로컬 SQLite와 테스트 계정으로 실행했다. 모델의 실제 응답을 저장했으며 모의 응답으로 실제 분석 성공을 대신하지 않았다. 백엔드 경계 테스트의 가짜 분석 응답과 계약 fixture는 단위 테스트 전용이다.

## 실행 준비

기존 로그인·프로젝트 저장 서버와 Python 분석 서버의 실행 설정을 유지한다. 서버 간 `ANALYSIS_BASE_URL`과 `ANALYSIS_SERVICE_TOKEN`은 기존 설정 방법을 사용하며 브라우저에는 토큰을 전달하지 않는다.

Python 3.12 환경에서 `ai-server/requirements.txt`를 설치하고 FFmpeg·FFprobe 실행 경로를 준비한다. 모델은 다음 명령으로 고정 체크포인트를 내려받아 크기와 SHA-256을 검증한다.

```powershell
# ai-server 디렉터리, 활성화한 Python 환경에서 실행
python preload_tracking_model.py
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

`TRACKING_MODEL_PATH`를 생략하면 `ai-server/models/nanodet.onnx`를 사용한다. 모델·개발 가상환경은 Git에서 제외된다. Docker는 빌드 중 모델을 준비하므로 요청 시 외부 모델 다운로드가 필요하지 않다.

```powershell
# 저장소 루트
pnpm --dir backend test
pnpm --dir backend build
pnpm --dir frontend test
pnpm --dir frontend build
# ai-server 디렉터리, pytest가 설치된 개발 환경
python -m pytest tests/test_tracking_core.py tests/test_tracking_api.py tests/test_tracking_worker.py -q
```

## 제공 조건과 남은 확인

25 MiB 이하 MP4·MOV·WebM, 1시간 이하·16,777,216픽셀 이하 원본의 요청당 최대 120초·240프레임을 분석한다. 4K는 포함하며 8K는 거부한다. FFmpeg 단일 메모리 할당을 64 MiB로 제한하고, 제한 반영 후 실제 모델의 UCL 결과 전체가 변경 전과 동일함을 확인했다. UI는 2fps를 사용한다. COCO 80개 클래스 범위이며, 작은 관중·광고판·가림·빠른 움직임에서는 오분류와 ID 단절이 발생할 수 있다. 추천은 관측 크기·빈도·신뢰도의 휴리스틱으로, 의미상 중요한 대상을 보장하지 않는다. 표본 결과를 전체 영상 품질 지표로 해석하지 않는다.

프런트 빌드의 기존 큰 청크 경고가 남아 있다. Docker 실행 환경이 없어 최종 이미지 빌드는 검증하지 않았다. 운영 장비의 처리량·메모리 측정, Cloud Run/Cloudflare 배포 및 실제 데모 확인은 별도 단계이다.

이번 작업은 로컬 구현과 검증만 수행했다. README, 기존 작업 폴더의 미커밋 변경, 운영 데모와 롤백 자료는 변경하지 않았고 커밋·푸시·배포도 하지 않았다.
