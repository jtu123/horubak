import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscriptAnalysis } from './TranscriptAnalysis';
import type { Project } from '../types';
import type { useProjectTranscript } from '../services/useProjectTranscript';

const project = { id: 'project', source: 'file', sourceName: 'long.mp4', duration: 36000, fileSize: 4 * 1024 ** 3 } as Project;
const source = { uploadId: 'upload', filename: project.sourceName, size: project.fileSize!, duration: project.duration,
  width: 1920, height: 1080, objectKey: 'originals/owner/project/upload/source', generation: '1', checksum: 'crc32-test' };
const job = { id: 'job', state: 'completed' as const, source, duration: 36000, processedSeconds: 36000,
  chunkSeconds: 300, completedChunks: 120, totalChunks: 120, segmentCount: 12000, sourceSha256: 'a'.repeat(64), error: null,
  createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T01:00:00Z' };
type State = ReturnType<typeof useProjectTranscript>;
const state = (patch: Partial<State> = {}) => ({
  items: [], windowItems: [], loading: false, windowLoading: false, operation: null, error: '', notice: '', source, job,
  uploadedBytes: 0, configured: true, supported: true, analyzing: false, contextReady: true, identity: 'test',
  windowStart: 35700, page: 0, pageCount: 1, ...patch,
} as State);
const render = (value: State) => renderToStaticMarkup(<TranscriptAnalysis project={project} enabled transcript={value} />);

describe('long-video transcription controls', () => {
  it('restores a ten-hour completed server job and offers bounded result navigation', () => {
    const html = render(state({ pageCount: 20 }));
    expect(html).toContain('전체 한국어 전사 완료');
    expect(html).toContain('120 / 120 구간');
    expect(html).toContain('서버 원본 연결됨');
    expect(html).toContain('max="36000"');
    expect(html).toContain('한 번에 최대 100개');
    expect(html).not.toContain('25MiB');
    expect(html).not.toContain('이 화면을 유지');
  });
  it('shows upload bytes separately from model processing and provides explicit upload stop', () => {
    const file = { name: project.sourceName, size: project.fileSize } as File;
    const html = render(state({ source: null, job: null, operation: 'upload', selectedFile: file, uploadedBytes: 8 * 1024 ** 2 }));
    expect(html).toContain('전사 원본 업로드 진행');
    expect(html).toContain('max="4294967296"');
    expect(html).toContain('value="8388608"');
    expect(html).toContain('원본 전송 중단');
    expect(html).not.toContain('전체 영상 전사 진행');
  });
  it('offers cancellation only for an active job and resume for a cancelled job', () => {
    const running = render(state({ job: { ...job, state: 'running', processedSeconds: 300, completedChunks: 1 }, analyzing: true }));
    expect(running).toContain('전체 전사 중단');
    expect(running).toContain('이 창을 닫아도 서버 전사는 계속됩니다');
    const cancelled = render(state({ job: { ...job, state: 'cancelled' } }));
    expect(cancelled).toContain('저장된 지점부터 전사 재개');
    expect(cancelled).not.toContain('>전체 전사 중단<');
  });
});
