import type { Candidate, EditState, Genre, Project, Utterance } from './types';

export const CANDIDATES: Record<Genre, Candidate[]> = {
  lecture: [
    { id: 'lecture-1', title: '좋은 질문은 정답보다 오래 남는다', summary: '익숙한 답을 찾기보다, 질문의 방향을 바꾸는 것이 중요한 이유.', start: 252, end: 300, reason: '강의의 핵심 개념을 일상의 사례와 함께 설명하는 완결된 구간입니다.', evidenceIds: ['u-1', 'u-2', 'u-3', 'u-4'], score: 94 },
    { id: 'lecture-2', title: '실패를 배움으로 바꾸는 조건', summary: '실패를 돌아보는 과정이 있어야 경험이 학습으로 이어집니다.', start: 583, end: 624, reason: '조건과 결론의 연결을 확인하면 독립적인 메시지로 활용할 수 있습니다.', evidenceIds: ['u-5', 'u-6', 'u-7'], score: 89, warning: { title: '앞의 조건이 빠져 있어요', description: '현재 구간만 보면 모든 실패가 자동으로 배움이 된다는 의미로 전달될 수 있습니다.', evidence: '“무엇이 잘못됐는지 함께 돌아볼 수 있다면”이라는 조건이 앞 발화에 있습니다.', correctedStart: 575, correctedEnd: 624 } },
    { id: 'lecture-3', title: '생각의 틀을 넓히는 작은 습관', summary: '다른 관점을 묻는 짧은 질문 하나로 대화를 바꾸는 방법.', start: 1025, end: 1078, reason: '실천할 수 있는 방법과 마무리 문장이 함께 들어 있습니다.', evidenceIds: ['u-8', 'u-9'], score: 87 },
  ],
  speech: [
    { id: 'speech-1', title: '변화를 선택하는 우리의 태도', summary: '불확실한 상황에서 방향을 정하고 한 걸음 나아가는 태도.', start: 131, end: 177, reason: '주장과 그 주장을 뒷받침하는 이유가 연결되어 있습니다.', evidenceIds: ['u-1', 'u-2', 'u-3', 'u-4'], score: 93 },
    { id: 'speech-2', title: '더 나은 내일을 위한 약속', summary: '안전 검증을 전제로 하는 확장 계획과 실행 의지.', start: 429, end: 473, reason: '조건을 보존하면 핵심 메시지가 분명해집니다.', evidenceIds: ['u-5', 'u-6', 'u-7'], score: 88, warning: { title: '약속에 붙은 조건을 확인해 주세요', description: '안전 검증이라는 전제 없이 확정된 계획처럼 보일 수 있습니다.', evidence: '앞 발화의 “안전 검증이 완료된다면”을 포함해야 합니다.', correctedStart: 422, correctedEnd: 473 } },
    { id: 'speech-3', title: '함께 만드는 변화', summary: '작은 참여가 공동의 성과로 이어지는 과정.', start: 702, end: 751, reason: '핵심 주장과 행동 제안이 함께 포함되어 있습니다.', evidenceIds: ['u-8', 'u-9'], score: 86 },
  ],
  podcast: [
    { id: 'podcast-1', title: '꾸준함을 만드는 진짜 동기', summary: '대단한 의지보다 중요한, 다시 시작할 수 있는 환경에 관한 대화.', start: 361, end: 410, reason: '질문과 답변이 모두 포함되어 별도의 설명 없이 이해할 수 있습니다.', evidenceIds: ['u-1', 'u-2', 'u-3', 'u-4'], score: 95 },
    { id: 'podcast-2', title: '창작이 막혔을 때 하는 일', summary: '답변 앞에 있는 질문을 포함하면 대화의 맥락이 더 분명해집니다.', start: 809, end: 852, reason: '질문을 포함해 하나의 대화로 구성할 수 있는 구간입니다.', evidenceIds: ['u-5', 'u-6', 'u-7'], score: 90, warning: { title: '답변 앞의 질문이 빠져 있어요', description: '누구에게 무엇을 조언하는 답변인지 알기 어렵습니다.', evidence: '진행자의 “아무것도 만들기 싫은 날에는 어떻게 하세요?”를 포함해 보세요.', correctedStart: 800, correctedEnd: 852 } },
    { id: 'podcast-3', title: '나만의 속도를 찾는 방법', summary: '타인과 비교하기보다 내 작업의 리듬을 지키는 이야기.', start: 1205, end: 1257, reason: '경험과 구체적인 조언이 연결된 완결된 답변입니다.', evidenceIds: ['u-8', 'u-9'], score: 87 },
  ],
};

export function makeTranscript(genre: Genre): Utterance[] {
  const [a, b, c] = CANDIDATES[genre];
  const texts: Record<Genre, string[]> = {
    lecture: ['우리는 보통 좋은 답을 찾는 데 시간을 많이 씁니다.', '하지만 생각의 방향을 바꾸는 것은 의외로 좋은 질문 하나입니다.', '“왜 안 될까?” 대신 “다르게 해 보면 어떨까?”라고 물어보세요.', '질문이 바뀌면, 우리가 볼 수 있는 가능성도 달라집니다.', '무엇이 잘못됐는지 함께 돌아볼 수 있다면,', '실패는 다음 시도를 더 나아지게 하는 배움이 됩니다.', '중요한 건 경험 자체가 아니라 경험을 돌아보는 과정입니다.', '매일 한 번, 익숙한 생각에 다른 질문을 던져 보세요.', '그 작은 습관이 생각의 틀을 조금씩 넓혀 줍니다.'],
    speech: ['우리가 마주한 미래에는 정해진 답이 없습니다.', '그렇기에 지금 어떤 방향을 선택하는지가 중요합니다.', '두려움이 사라질 때까지 기다릴 수는 없습니다.', '함께 확인하고, 작은 실험부터 시작하겠습니다.', '안전 검증이 완료된다면,', '사업을 확대하고 더 많은 분들과 기회를 나누겠습니다.', '그 약속을 지키기 위해 과정을 투명하게 공유하겠습니다.', '변화는 혼자 만드는 결과가 아닙니다.', '여러분의 작은 참여가 더 나은 내일을 만듭니다.'],
    podcast: ['오래 창작하려면 무엇이 가장 중요하다고 생각하세요?', '저는 다시 시작하기 쉬운 환경을 만드는 거라고 생각해요.', '매번 의지로만 버티려 하면 쉽게 지치거든요.', '아주 작은 작업부터 시작할 수 있게 준비해 두는 거죠.', '아무것도 만들기 싫은 날에는 어떻게 하세요?', '그럴 땐 결과를 내야 한다는 생각을 잠깐 내려놓아요.', '산책을 하거나 다른 사람의 이야기를 듣기도 해요.', '남의 속도가 내 기준이 될 필요는 없어요.', '내가 계속할 수 있는 리듬을 찾는 게 중요하죠.'],
  };
  const ranges = [[a.start, a.start + 11], [a.start + 11, a.start + 24], [a.start + 24, a.start + 37], [a.start + 37, a.end], [b.warning?.correctedStart ?? b.start - 8, b.start], [b.start, b.start + 20], [b.start + 20, b.end], [c.start, c.start + 26], [c.start + 26, c.end]];
  return ranges.map(([start, end], i) => ({ id: `u-${i + 1}`, start, end, text: texts[genre][i], speaker: genre === 'podcast' && [0, 4].includes(i) ? '화자 A' : genre === 'podcast' ? '화자 B' : '화자 A' }));
}

export function initialEdit(genre: Genre): EditState {
  const c = CANDIDATES[genre][0];
  return { candidateId: c.id, start: c.start, end: c.end, subtitle: c.title, subtitleSize: 26, subtitleColor: '#ffe18b', subtitleVisible: true, cropX: 50, cropY: 50, scale: 1, contextApplied: false, layout: 'speaker' };
}

export function seedProjects(): Project[] {
  const defs: Array<[string, string, Genre, Project['status'], number, string, boolean]> = [
    ['sample-lecture', '좋은 질문이 생각을 바꾸는 순간', 'lecture', 'ready', 1842, '질문의 힘_인문학 특강.mp4', true],
    ['sample-podcast', 'EP.12 창작을 계속하게 하는 것', 'podcast', 'completed', 2565, '작업실의 대화_EP12.mp4', false],
    ['sample-speech', '불확실한 시대, 우리가 선택할 것', 'speech', 'ready', 1534, '내일을 여는 연설.mp4', false],
  ];
  return defs.map(([id, title, genre, status, duration, sourceName, favorite], i) => ({ id, title, genre, status, duration, sourceName, favorite, source: 'sample', progress: 100, createdAt: `2026-10-${22 - i}T09:00:00+09:00`, updatedAt: `2026-10-${23 - i}T10:30:00+09:00`, edit: initialEdit(genre) }));
}
