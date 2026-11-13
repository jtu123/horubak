import type { Candidate, Project, VisualEvidence } from './types';

export interface SportsSample {
  id: string;
  title: string;
  competition: string;
  matchInfo: string;
  duration: number;
  videoUrl: string;
  thumbnail: string;
  candidateThumbnails?: Record<string, string>;
  highlightsUrl: string;
  candidates: Candidate[];
  evidence: VisualEvidence[];
}

const assets = '/samples/';
export const SPORTS_SAMPLE_CREDITS = assets + 'ATTRIBUTION.txt';

export const SPORTS_SAMPLES: SportsSample[] = [
  {
    id: 'pl-tottenham-arsenal-2010',
    title: '토트넘 2–1 아스널',
    competition: '프리미어리그',
    matchInfo: '2010.04.14 · 화이트 하트 레인',
    duration: 35,
    videoUrl: assets + 'pl-tottenham-arsenal-2010.mp4',
    thumbnail: assets + 'pl-tottenham-arsenal-2010.webp',
    highlightsUrl: 'https://www.tottenhamhotspur.com/news/1009763/five-decades-of-golden-goals-against-the-gunners',
    candidates: [{
      id: 'pl-derby-stands', title: '골대 뒤에서 본 북런던 더비', summary: '관중석에서 바라본 북런던 더비의 경기 장면.',
      start: 0, end: 35, reason: '골대와 선수들의 움직임이 한 화면에 들어오는 구간입니다.',
      evidenceIds: ['pl-derby-pitch'], evidenceKind: 'scene', score: 90,
    }],
    evidence: [{
      id: 'pl-derby-pitch', start: 0, end: 35, title: '골대 뒤 관중석',
      description: '화이트 하트 레인 관중석에서 촬영한 경기 장면입니다.', kind: 'scene',
    }],
  },
  {
    id: 'ucl-man-city-chelsea-2021',
    title: '맨시티 0–1 첼시',
    competition: '챔피언스리그 결승',
    matchInfo: '2021.05.29 · 이스타디우 두 드라강',
    duration: 76,
    videoUrl: assets + 'ucl-man-city-chelsea-2021.mp4',
    thumbnail: assets + 'ucl-man-city-chelsea-2021.webp',
    candidateThumbnails: { 'ucl-trophy': assets + 'ucl-man-city-chelsea-ceremony.webp' },
    highlightsUrl: 'https://www.uefa.com/uefachampionsleague/history/video/026b-12da96dd9230-29f2beba5482-1000--2021-final-man-city-0-1-chelsea/',
    candidates: [
      {
        id: 'ucl-pulisic-chance', title: '풀리식의 결정적 기회', summary: '경기 초반과 후반 풀리식의 슈팅을 묶은 구간.',
        start: 0, end: 33, reason: '풀리식의 슈팅 전후로 골문 앞 상황을 확인할 수 있습니다.',
        evidenceIds: ['ucl-opening', 'ucl-attack'], evidenceKind: 'scene', score: 92,
        warning: {
          title: '슈팅 뒤 관중 반응을 확인하세요',
          description: '현재 구간 뒤로 슈팅이 빗나간 데 대한 관중의 반응이 이어집니다.',
          evidence: '편집본 0:33–0:40 · 슈팅이 빗나간 뒤 관중이 머리를 감싸는 장면',
          correctedStart: 0, correctedEnd: 40,
        },
      },
      {
        id: 'ucl-trophy', title: '첼시의 우승 세리머니', summary: '경기 종료 뒤 시상식과 관중석의 반응.',
        start: 40, end: 76, reason: '시상대에 모이는 선수들과 우승 축하 장면이 이어집니다.',
        evidenceIds: ['ucl-ceremony'], evidenceKind: 'scene', score: 88,
      },
    ],
    evidence: [
      { id: 'ucl-opening', start: 0, end: 22, title: '결승 초반', description: '골대 뒤에서 본 결승 초반 플레이입니다.', kind: 'scene' },
      { id: 'ucl-attack', start: 22, end: 40, title: '풀리식의 슈팅', description: '후반에 풀리식이 골문 앞에서 슈팅을 시도합니다.', kind: 'scene' },
      { id: 'ucl-ceremony', start: 40, end: 76, title: '우승 시상식', description: '경기 종료 뒤 첼시의 우승을 축하하는 장면입니다.', kind: 'scene' },
    ],
  },
];

export function getSportsSample(project: Project): SportsSample | undefined {
  return project.source === 'sample' && project.sportsSampleId
    ? SPORTS_SAMPLES.find(match => match.id === project.sportsSampleId)
    : undefined;
}

export function getDashboardSampleProject(projects: Project[], match: SportsSample, serverUser: boolean): Project {
  const sample = createSportsSample(match);
  const existing = projects.find(project => project.id === sample.id ||
    (serverUser && project.source === 'sample' && project.sportsSampleId === match.id));
  if (existing) return existing;
  return serverUser ? { ...sample, id: crypto.randomUUID() } : sample;
}

export function createSportsSample(match: SportsSample, now = new Date().toISOString()): Project {
  return {
    id: 'sample-' + match.id, sportsSampleId: match.id, title: match.title,
    genre: 'general', status: 'ready', duration: match.duration, source: 'sample', sourceName: match.id + '.mp4',
    createdAt: now, updatedAt: now, favorite: false, progress: 100, clips: [],
    contentProfile: { purpose: '하이라이트', focus: match.competition, signals: ['visual'] },
  };
}
