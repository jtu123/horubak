# 호루박 UI 설계 Council 검토

검토일: 2026-11-05. 아래 인물명은 설치된 지침에 따른 관점 역할이며, 실제 인물이 참여한 검토가 아니다. 기존 UI 재구성 설계와 현재 코드를 검토했다. 이 파일은 검토 기록이며 웹사이트 구현 코드는 변경하지 않았다.

**B안, 즉 기존 설계에 검증 조건을 추가한 뒤 대표 제작 흐름부터 재구성하는 방향을 권고한다.**

## 1. Selected Panel

Rams·Torvalds·Watts 관점, quick 2라운드. Rams에 디자인 도메인 가중치 1.5배를 분석 전에 적용했다.

## 2. Chairman

토론에 참여하지 않은 별도 에이전트가 종합했다. OpenAI의 호스트 상속 모델이며 정확한 모델 ID·등급은 노출되지 않았다. 사용 가능한 네이티브 런타임에서 선정했으며, 별도 제공자의 CLI/API는 호출하지 않았다. 단일 제공자이므로 모델 다양성을 확보한 검토는 아니다.

## 3. Acceptable Compromises

전체 화면의 시각적 통일은 단계적으로 완성한다. 기존 셸과 유용한 Lucian 동작은 재사용하고, 글자 크기·패널 폭·반경은 첫 구현의 가정값으로 둔다.

## 4. Kill Criteria

D는 첫 시제품 검수일이며 구현 착수 시 확정한다. 확정된 구현·검수 일정은 없다.

- D일까지 기존 화면보다 후보 탐색이나 맥락 비교 후 복귀가 어려워지면 전체 적용 권고를 무효화하고 C안으로 전환한다.
- D일까지 사용자가 샘플 분석을 실제 영상 분석으로, 편집 확인을 MP4 출력 완료로 오해한다면 확장을 중단하고 상태·안내부터 수정한다.

위 조건은 앞으로 관찰할 기준이다. 현재 실제 사용자 성공률·소요 시간·오해 빈도를 측정하지 않았으므로 개선 효과를 확정하지 않는다.

## 5. Concrete Next Step

**대표 제작 흐름과 상태 표시 규칙을 포함한 ‘호루박 UI 설계명세 v2’를 작성한다.** 이는 다음 작업에 대한 권고이며 이번 검토에서 해당 명세나 시제품을 구현했다는 뜻은 아니다.

## 6. Unresolved Questions

모바일에서 후보와 미리보기를 오가는 최선의 배치, 적정 정보 밀도, 실제로 정리가 필요한 CSS 범위가 남아 있다. CSS 파일 7개라는 사실만으로 충돌을 단정할 수는 없다.

## 7. Key Agreements

| Before | After | Why |
|---|---|---|
| 소개·통계·장식이 작업과 경쟁 | 등록·최근 작업·프로젝트에 집중 | 다음 행동을 쉽게 찾도록 함 |
| completed의 의미가 모호할 가능성 | 기존 계약을 유지하며 편집 확인과 영상 출력 가능 여부를 구분 | 산출물 오해 방지 |
| 반복 안내와 필수 안내를 함께 축소할 위험 | 반복 문구는 줄이고 샘플·미연결·빈 후보의 이유는 유지 | 사용자의 판단에 필요한 정보 보존 |
| 여러 화면을 동시에 변경 | 대표 제작 흐름부터 변경·검증 | 회귀 원인과 개선 효과를 확인 |

상태 표시는 기존 프로젝트 상태와 실제 미디어/렌더 연결 여부에 근거한다. 팀 계약에 없는 필드를 UI 검토만으로 임의로 추가하지 않는다. 단순히 안내를 늘리는 것이 아니라 필요한 위치에 짧게 제시한다.

## 8. Key Disagreements

공식적인 반대표나 DEALBREAKER 표는 없다. 다만 Rams의 후보 접근성 우려에 대해 Torvalds는 전용 이동 버튼을 먼저 추가하지 말고 실제 탐색 실패를 확인하자고 지적했다. 또한 과업 성공과 CSS 유지 비용 개선은 별도로 평가해야 한다.

세 관점 모두, 기존 화면의 문구·지연만 수정한 대안이 비슷한 과업 성과를 더 적은 비용으로 내고 구조 변경 필요성이 확인되지 않으면 C안이 더 타당할 수 있다는 조건을 남겼다.

## 9. Vote Tally

| 선택 | 신뢰도 반영 점수 | 지지 |
|---|---:|---|
| A | 0 | 없음 |
| B | 2.625 | Rams 1.125〔기본 1.5배〕, Torvalds 0.75, Watts 0.75 |
| C | 0 | 없음 |

기본 가중치 합계 3.5의 2/3 문턱은 2.333이다. B가 통과했다. 세 좌석 모두 CONFIDENCE: med, DEALBREAKER: no를 명시했다. 이 점수는 사용성 측정값이나 통계적 신뢰도가 아니다.

## 10. Decision Options

- **A — 기존 설계 그대로 진행:** 착수는 빠르지만 미검증 가정을 유지한다.
- **B — 조건 보완 후 진행:** 검증 작업이 추가되지만 변경 범위를 조절할 수 있다. 이번 권고다.
- **C — 전체 재구성 보류·핵심 불편만 수정:** 비용은 작지만 화면 간 정리는 제한된다.

## 11. Recommended Next Steps

명세 작성 후 기존 셸을 활용한 대표 흐름 시제품을 만든다. 샘플 선택→후보 검토→맥락 비교→보정·되돌리기→SRT/JSON 다운로드를 확인한다. 결과를 바탕으로 나머지 화면과 CSS 정리를 확장한다.

모바일 후보 접근성과 다음 행동 이해는 사용자 관찰로, CSS 정리 효과는 중복 규칙·변경 영향·회귀 원인 추적 등 별도 근거로 확인한다.

## 12. Confidence

**중간.** 코드와 설계에 근거한 권고다. 실제 사용자 조사, 브라우저 검수, 테스트는 이번 세션에서 수행하지 않았다. 이전의 테스트 통과·브라우저 검수 기록을 새 설계의 검증으로 간주하지 않았다.

주요 코드 근거:

- [공통 셸 사용](<C:/Users/권준한/Documents/ChatGPT/AI 결합 강의·연설·팟캐스트 하이라이트 숏폼 자동 제작 시스템/frontend/src/App.tsx:16>)
- [스타일시트 가져오기](<C:/Users/권준한/Documents/ChatGPT/AI 결합 강의·연설·팟캐스트 하이라이트 숏폼 자동 제작 시스템/frontend/src/main.tsx:6>)
- [샘플 후보·전사 조건](<C:/Users/권준한/Documents/ChatGPT/AI 결합 강의·연설·팟캐스트 하이라이트 숏폼 자동 제작 시스템/frontend/src/pages/Editor.tsx:19>)
- [결과 이동 때 completed 기록](<C:/Users/권준한/Documents/ChatGPT/AI 결합 강의·연설·팟캐스트 하이라이트 숏폼 자동 제작 시스템/frontend/src/pages/Editor.tsx:35>)
- [편집 JSON과 rendered 상태](<C:/Users/권준한/Documents/ChatGPT/AI 결합 강의·연설·팟캐스트 하이라이트 숏폼 자동 제작 시스템/frontend/src/pages/Results.tsx:13>)

## 13. Execution Reliability

live 3, degraded 0, offline 0. 토론 2라운드를 완료했고 재시도·타임아웃·시뮬레이션은 없었다. 1차의 전원 동의에 대해 2차에서 각 좌석에 반대 선택이 더 타당해지는 조건을 요청했다. 이를 agreement_check 3회로 집계했다. 독립 의장 호출은 토론 라운드에 포함하지 않았다.

---
Session Metadata

```yaml
schema_version: 1
mode: quick
panel_size: 3
rounds_run: 2
enforcement_calls: 3
enforcement_breakdown:
  dissent_quota: 0
  novelty_gate: 0
  agreement_check: 3
  anti_recursion: 0
  missing_stance: 0
tools_used: [exec_command, spawn_agent, followup_task, wait_agent, apply_patch, clock__curr_time]
provider_count: 1
fallbacks_triggered: []
input_tokens_estimate: "~unknown"
output_tokens_estimate: "~unknown"
duration_seconds: 614
```

---

