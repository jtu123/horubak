# 호루박 데스크톱 디자인 검수

2026-11-06 기준. 디자인 판단과 구현 범위는 [개편 명세](reference-redesign-spec.md)에 기록했다.

| 검증 | 결과 |
|---|---|
| 단위 테스트와 빌드 | 62개 통과. TypeScript와 Vite 프로덕션 빌드 통과 |
| 화면 배치 | 16개 화면 × 1280·1440·1920px × 라이트·다크, 96/96 통과. 최종 브라우저 실행 오류 0건 |
| 기존 기능 | 등록, 후보, 맥락 보정, 저장, 로컬 원본 재생·재연결, 다운로드 등 14/14 통과 |
| 후보와 편집 | 후보 일괄 보관, 네 화면비, JSON, undo/redo 등 7/7 통과. 편집·후보 화면 30개 조합 포함 |
| 새 레일과 대시보드 | 최종 수정 후 5/5 통과. 레일 펼치기, 실제 요약 수치, 프로젝트 메뉴, 테마, 키보드, 모션 줄이기 확인 |
| Stageshow | 라이트 1280·1440px, 다크 1440px, 모션 줄이기 1440px 정적 촬영 4건 통과 |

최종 화면 배치에서 카드 표지가 본문 폭을 모두 채우는지 별도로 측정했다. 대시보드 6개 조합에서 표지 폭 차이와 가로 넘침은 각각 0px이었다. 목록 보기의 작은 표지도 유지했다.

독립 시각 검수에서 확인한 한글 어절 줄바꿈과 미리보기 배지를 정리했다. 샘플 배지와 포스터 장식 문구를 분리하고, 밝은 표지 위 배지에 어두운 바탕을 적용했다. 대표 편집 화면을 다시 촬영해 반영을 확인했다.

Lucian의 레일, 알약 탭, 빠른 실행을 작업공간과 테마에 맞췄다. [#040 펼쳐지는 사이드 레일](https://lucianlabs.dev/uxui-prompt/#040) · [#039 미끄러지는 알약 탭](https://lucianlabs.dev/uxui-prompt/#039) · [#046 커맨드 팔레트](https://lucianlabs.dev/uxui-prompt/#046)

검수 대상은 데스크톱 UI다. 모션 줄이기는 브라우저 설정을 흉내 내 확인했고 Stageshow는 정적 구도를 검사했다. 실제 모바일 기기, 스크린 리더, 서버 분석·렌더 동작은 이번 검수 범위 밖이다.

- [화면 배치 결과](reference-layout-matrix.json)
- [레일과 대시보드 기능 결과](reference-shell-qa.json)
- [후보와 편집 기능 결과](reference-feature-qa.json)
- [Stageshow 촬영 기록](../frontend/src/components/stageshow/REHEARSAL.md)
- [대시보드 라이트](screenshots/reference/layout-projects-light-1440.png) · [대시보드 다크](screenshots/reference/layout-projects-dark-1440.png)
- [로그인](screenshots/reference/layout-login-light-1440.png) · [영상 등록](screenshots/reference/layout-new-light-1440.png) · [편집](screenshots/reference/layout-editor-light-1440.png) · [결과](screenshots/reference/layout-results-dark-1440.png)
