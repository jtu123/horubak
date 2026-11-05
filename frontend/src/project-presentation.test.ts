import { describe, expect, it } from 'vitest';
import { describeProject } from './project-presentation';
import type { Project } from './types';

const project: Project = {
  id: 'review-example', title: '맥락 검토', genre: 'lecture', status: 'ready',
  duration: 120, createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
  favorite: false, source: 'sample', sourceName: '샘플', progress: 100,
};

describe('project presentation and available outputs', () => {
  it('does not confuse edit confirmation with rendered video', () => {
    const view = describeProject({ ...project, status: 'completed' }, { start: 10, end: 50 });
    expect(view.statusLabel).toBe('편집 확인됨');
    expect(view.canDownloadSrt).toBe(true);
    expect(view.canDownloadJson).toBe(true);
    expect(view.videoExportAvailable).toBe(false);
  });

  it.each(['file', 'url'] as const)('never supplies sample subtitles for a %s source', source => {
    const view = describeProject({ ...project, source }, { start: 10, end: 50 }, true);
    expect(view.canDownloadSrt).toBe(false);
    expect(view.canDownloadJson).toBe(true);
    expect(view.analysisLabel).toBe('분석 연결 전');
  });

  it('keeps saved edit metadata downloadable after a local video disconnects', () => {
    const view = describeProject({ ...project, source: 'file' }, { start: 10, end: 50 });
    expect(view.mediaLabel).toBe('원본 연결 필요');
    expect(view.canDownloadJson).toBe(true);
    expect(view.canDownloadSrt).toBe(false);
  });

  it('does not offer output when duration or selection is invalid', () => {
    for (const duration of [0, Number.NaN, 30]) {
      const view = describeProject({ ...project, duration }, { start: 10, end: 50 });
      expect(view.rangeIssue).toBeTruthy();
      expect(view.canDownloadSrt).toBe(false);
      expect(view.canDownloadJson).toBe(false);
    }
  });

  it.each(['processing', 'failed', 'cancelled'] as const)('does not expose results for %s work', status => {
    const view = describeProject({ ...project, status }, { start: 10, end: 50 });
    expect(view.canDownloadSrt).toBe(false);
    expect(view.canDownloadJson).toBe(false);
  });

  it('distinguishes a recorded URL from a connected source with unreadable duration', () => {
    const pending = { ...project, source: 'url' as const, duration: 0 };
    expect(describeProject(pending).mediaLabel).toBe('주소만 등록됨');
    expect(describeProject(pending, undefined, true).mediaLabel).toBe('길이 확인 필요');
  });

  it('does not offer a fabricated transcript subtitle file for a non-speech scene sample', () => {
    const view = describeProject({ ...project, genre: 'general' }, { start: 10, end: 50 });
    expect(view.canDownloadJson).toBe(true);
    expect(view.canDownloadSrt).toBe(false);
    expect(view.videoExportAvailable).toBe(false);
  });
});
