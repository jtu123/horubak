import { afterEach, describe, expect, it, vi } from 'vitest';
import example from '../../../contracts/tracking-result.example.json';
import { fullTrackingApi, parseFullJob, parseFullSource, parseFullWindow, uploadResumable } from './full-tracking';
import { MAX_FULL_SOURCE_BYTES, MAX_FULL_SOURCE_SECONDS, sameStoredSource, trackingWindowStart } from '../full-tracking-model';

const source = () => ({ uploadId: '09ae4026-80dd-4841-9bd7-424623496d48', filename: 'source.mp4', size: 10,
  duration: 60, width: 1280, height: 720, objectKey: 'originals/owner/project/upload/source', generation: '123', checksum: 'verified-storage-checksum' });
const job = () => ({ id: 'e45b6cef-591b-4f6b-9afc-c8257df8d61f', state: 'running', source: source(), processedSeconds: 0,
  duration: 60, sampleFps: 2, chunkSeconds: 60, completedChunks: 0, totalChunks: 1, sourceSha256: 'a'.repeat(64), error: null,
  createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' });
const session = () => ({ uploadId: source().uploadId, uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/test/o?upload_id=private',
  chunkBytes: 8 * 1024 * 1024, expiresAt: '2099-01-01T00:00:00Z' });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('full source and job boundary', () => {
  it('accepts exactly 4GiB and ten hours, and rejects either limit being exceeded', () => {
    expect(parseFullSource({ ...source(), size: MAX_FULL_SOURCE_BYTES, duration: MAX_FULL_SOURCE_SECONDS }).duration).toBe(36000);
    expect(() => parseFullSource({ ...source(), size: MAX_FULL_SOURCE_BYTES + 1 })).toThrow();
    expect(() => parseFullSource({ ...source(), duration: 36000.1 })).toThrow();
    expect(() => parseFullSource({ ...source(), width: 7680, height: 4320 })).toThrow();
  });
  it('never presents a partially processed source as completed', () => {
    expect(() => parseFullJob({ ...job(), state: 'completed' })).toThrow();
    expect(parseFullJob({ ...job(), state: 'completed', processedSeconds: 60, completedChunks: 1 }).state).toBe('completed');
    expect(() => parseFullJob({ ...job(), processedSeconds: 61 })).toThrow();
  });
  it('binds stored playback and results to the same object generation', () => {
    expect(sameStoredSource(source(), { ...source() })).toBe(true);
    expect(sameStoredSource(source(), { ...source(), generation: '124' })).toBe(false);
    expect(sameStoredSource(source(), { ...source(), objectKey: 'another' })).toBe(false);
  });
  it('looks up the last committed window without seeking beyond the video', () => {
    expect(trackingWindowStart(600, 600, 60)).toBe(540);
    expect(trackingWindowStart(120, 600, 60)).toBe(120);
    expect(trackingWindowStart(Number.NaN, 600, 60)).toBe(0);
  });
  it('rejects a late response from another job even when it points to the same source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ job: { ...job(), id: 'previous-job' } }), { headers: { 'Content-Type': 'application/json' } })));
    await expect(fullTrackingApi.status('project', job().id)).rejects.toThrow('전체 추적 정보를 확인하지 못했어요');
  });
  it('rejects a different time window rather than drawing it at the newly requested position', async () => {
    const current = { ...job(), source: { ...source(), duration: 600 }, duration: 600, totalChunks: 10, processedSeconds: 60, completedChunks: 1 };
    const result = { ...structuredClone(example), analysisId: current.id, sourceRevision: 'revision', createdAt: current.createdAt,
      source: { ...example.source, duration: 600 }, range: { start: 0, end: 60, sampleFps: 2 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ job: current, state: 'ready', result, selections: [] }), { headers: { 'Content-Type': 'application/json' } })));
    await expect(fullTrackingApi.window('project', current.id, 120)).rejects.toThrow('전체 추적 정보를 확인하지 못했어요');
  });
  it('accepts bounded long-video windows containing more than 64 total tracks', () => {
    const current = { ...job(), source: { ...source(), duration: 600 }, duration: 600, totalChunks: 10, processedSeconds: 60, completedChunks: 1 };
    const result = { ...structuredClone(example), analysisId: current.id, sourceRevision: 'revision', createdAt: current.createdAt,
      source: { ...example.source, duration: 600 } };
    result.tracks = Array.from({ length: 65 }, (_, index) => ({ ...structuredClone(example.tracks[0]), id: 't' + index }));
    result.recommendations = [];
    expect(parseFullWindow({ job: current, state: 'ready', result, selections: [] }).result?.tracks).toHaveLength(65);
    result.range.sampleFps = 1;
    expect(() => parseFullWindow({ job: current, state: 'ready', result, selections: [] })).toThrow();
    result.range.sampleFps = 2;
    result.sourceSha256 = 'b'.repeat(64);
    expect(() => parseFullWindow({ job: current, state: 'ready', result, selections: [] })).toThrow();
  });
});

describe('resumable direct upload', () => {
  it('sends bounded file slices, resumes an existing offset and sends no account credentials', async () => {
    const chunk = session().chunkBytes; const file = new File([new Uint8Array(chunk * 2 + 3)], 'source.mp4');
    const wholeRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole file must not be read'));
    const slice = vi.spyOn(file, 'slice');
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init!);
      if (calls.length === 1) return new Response(null, { status: 308, headers: { Range: `bytes=0-${chunk - 1}` } });
      if (calls.length === 2) return new Response(null, { status: 308, headers: { Range: `bytes=0-${chunk * 2 - 1}` } });
      return new Response('{}', { status: 200 });
    });
    const progress: number[] = [];
    await uploadResumable(file, session(), new AbortController().signal, value => progress.push(value), fetcher);
    expect(slice.mock.calls).toEqual([[chunk, chunk * 2], [chunk * 2, file.size]]);
    expect(wholeRead).not.toHaveBeenCalled();
    expect(progress.at(-1)).toBe(file.size);
    for (const init of calls) {
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      const headers = new Headers(init.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('X-CSRF-Token')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
    }
  });
  it('queries the committed offset after a lost response instead of duplicating accepted bytes', async () => {
    const file = new File([new Uint8Array(12)], 'source.mp4'); let count = 0;
    const slice = vi.spyOn(file, 'slice');
    const fetcher = vi.fn(async () => {
      count += 1;
      if (count === 1) return new Response(null, { status: 308 });
      if (count === 2) throw new TypeError('Connection lost after server accepted bytes');
      return new Response('{}', { status: 200 });
    });
    await uploadResumable(file, session(), new AbortController().signal, () => {}, fetcher);
    expect(slice).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects an impossible or non-advancing offset and aborts before further slices', async () => {
    const file = new File([new Uint8Array(12)], 'source.mp4');
    const fetcher = vi.fn(async () => new Response(null, { status: 308, headers: { Range: 'bytes=0-99' } }));
    await expect(uploadResumable(file, session(), new AbortController().signal, () => {}, fetcher)).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(uploadResumable(file, session(), abort.signal, () => {}, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
