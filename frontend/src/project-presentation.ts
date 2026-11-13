import { rangeError } from './lib';
import { getSportsSample } from './sports-samples';
import type { EditState, Project, ProjectStatus } from './types';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  processing: '화면 준비 중',
  ready: '편집 준비',
  completed: '편집 확인됨',
  failed: '준비 실패',
  cancelled: '준비 취소',
};

/** UI descriptions of the existing demo contract; no render job is configured. */
export function describeProject(
  project: Project,
  edit: Pick<EditState, 'start' | 'end'> = project.edit ?? { start: 0, end: Math.min(60, project.duration) },
  hasVideo = false,
) {
  const sample = project.source === 'sample';
  const match = getSportsSample(project);
  const editable = project.status === 'ready' || project.status === 'completed';
  const rangeIssue = rangeError(edit.start, edit.end, project.duration);
  return {
    statusLabel: STATUS_LABELS[project.status],
    sourceLabel: sample ? '샘플' : project.sourceUploaded ? '서버 파일' : project.source === 'file' ? '로컬 파일' : 'URL',
    analysisLabel: match ? '샘플 후보' : sample ? '샘플 분석' : '분석 연결 전',
    mediaLabel: match ? '경기 샘플 영상' : sample ? '샘플 미리보기'
      : !hasVideo && !project.sourceUploaded ? project.source === 'url' ? '주소만 등록됨' : '원본 연결 필요'
      : !Number.isFinite(project.duration) || project.duration <= 0 ? '길이 확인 필요' : '원본 연결됨',
    rangeIssue,
    canDownloadSrt: editable && sample && project.genre !== 'general' && !rangeIssue,
    canDownloadJson: editable && !rangeIssue,
    videoExportAvailable: false as const,
  };
}
