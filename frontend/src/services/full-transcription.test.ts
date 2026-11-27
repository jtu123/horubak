import { afterEach, describe, expect, it, vi } from 'vitest';
import { fullTranscriptionApi, parseTranscriptionJob, parseTranscriptionWindow, requireTranscriptionSource, watchTranscriptionJob } from './full-transcription';
import { withSourceUpload } from './source-upload';

const source = () => ({ uploadId: 'upload', filename: 'source.mp4', size: 4 * 1024 ** 3, duration: 36000,
  width: 1920, height: 1080, objectKey: 'originals/owner/project/upload/source', generation: '123', checksum: 'crc32-test' });
const job = () => ({ id: 'job', state: 'completed', source: source(), processedSeconds: 36000, duration: 36000,
  chunkSeconds: 300, completedChunks: 120, totalChunks: 120, segmentCount: 12000, sourceSha256: 'a'.repeat(64), error: null,
  createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T01:00:00Z' });
const envelope = () => ({ job: job(), sourceRevision: 'revision', state: 'ready', window: { jobId: 'job', index: 119,
  start: 35700, end: 36000, source: source(), sourceSha256: 'a'.repeat(64),
  segments: [{ segmentIndex: 11900, startSeconds: 35998, endSeconds: 35999.5, text: '마지막 전사' }] } });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('full transcription contract', () => {
  it('accepts exactly 4GiB and ten hours and rejects over-limit or incomplete completed jobs', () => {
    expect(parseTranscriptionJob(job()).duration).toBe(36000);
    expect(() => parseTranscriptionJob({ ...job(), source: { ...source(), size: source().size + 1 } })).toThrow();
    expect(() => parseTranscriptionJob({ ...job(), source: { ...source(), duration: 36001 }, duration: 36001 })).toThrow();
    expect(() => parseTranscriptionJob({ ...job(), processedSeconds: 35900 })).toThrow();
    expect(() => parseTranscriptionJob({ ...job(), completedChunks: 119 })).toThrow();
    expect(() => parseTranscriptionJob({ ...job(), sourceSha256: null })).toThrow();
  });
  it('validates the final window with stable original timestamps and source generation', () => {
    expect(parseTranscriptionWindow(envelope()).window?.segments[0].startSeconds).toBe(35998);
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, source: { ...source(), generation: '124' } } })).toThrow();
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, jobId: 'other' } })).toThrow();
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, sourceSha256: 'b'.repeat(64) } })).toThrow();
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, segments: [{ ...envelope().window.segments[0], endSeconds: 36001 }] } })).toThrow();
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, segments: [envelope().window.segments[0], envelope().window.segments[0]] } })).toThrow();
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, segments: [{ ...envelope().window.segments[0], text: '가'.repeat(2001) }] } })).toThrow();
  });
  it('accepts a committed silent window and rejects a response exceeding 512KiB', () => {
    expect(parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, segments: [] } }).window?.segments).toEqual([]);
    const segments = Array.from({ length: 100 }, (_, i) => ({ segmentIndex: i, startSeconds: 35700 + i, endSeconds: 35701 + i, text: '가'.repeat(2000) }));
    expect(() => parseTranscriptionWindow({ ...envelope(), window: { ...envelope().window, segments } })).toThrow();
  });
  it('rejects uncommitted ready windows and source replacement', () => {
    expect(() => parseTranscriptionWindow({ ...envelope(), job: { ...job(), state: 'running', completedChunks: 119, processedSeconds: 35700 } })).toThrow();
    expect(() => requireTranscriptionSource(parseTranscriptionJob(job()), { ...source(), generation: '124' })).toThrow();
    expect(parseTranscriptionWindow({ ...envelope(), state: 'pending', window: null }).window).toBeNull();
  });
  it('rejects a delayed status or window from another job or requested window', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ job: { ...job(), id: 'old-job' } })));
    await expect(fullTranscriptionApi.status('project', 'job')).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => json(envelope())));
    await expect(fullTranscriptionApi.window('project', 'job', 35400)).rejects.toThrow();
  });
  it('starts with a small JSON request instead of uploading the full video', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return String(url).endsWith('/csrf') ? json({ csrfToken: 'test-csrf' }) : json({ job: job() });
    }));
    await fullTranscriptionApi.create('project');
    const create = calls.find(call => call.url.endsWith('/jobs'))!;
    expect(create.init.body).toBe('{}');
    expect(create.init.body).not.toBeInstanceOf(FormData);
  });
});

describe('background transcription observation', () => {
  it('polls serially and stops after the terminal response', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof job>) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const status = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(job());
    const observed = vi.fn();
    const running = watchTranscriptionJob('project', 'job', source(), new AbortController().signal, observed, { status });
    await vi.advanceTimersByTimeAsync(1500);
    expect(status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(status).toHaveBeenCalledTimes(1);
    finish({ ...job(), state: 'running', completedChunks: 1, processedSeconds: 300 });
    await vi.advanceTimersByTimeAsync(2500);
    await running;
    expect(status).toHaveBeenCalledTimes(2);
    expect(observed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(status).toHaveBeenCalledTimes(2);
  });
  it('aborts observation without sending a server cancellation and rejects a changed source', async () => {
    vi.useFakeTimers();
    const status = vi.fn().mockResolvedValue({ ...job(), source: { ...source(), generation: 'other' } });
    const onJob = vi.fn();
    const changed = watchTranscriptionJob('project', 'job', source(), new AbortController().signal, onJob, { status });
    const rejected = expect(changed).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1500); await rejected;
    expect(onJob).not.toHaveBeenCalled();
    const abort = new AbortController();
    const cancel = vi.spyOn(fullTranscriptionApi, 'cancel');
    const stopped = watchTranscriptionJob('project', 'job', source(), abort.signal, onJob, { status });
    const aborted = expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await aborted;
    expect(cancel).not.toHaveBeenCalled();
  });
  it('ignores an in-flight response after the observation owner has left', async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof job>) => void;
    const status = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const abort = new AbortController(); const onJob = vi.fn();
    const running = watchTranscriptionJob('project', 'job', source(), abort.signal, onJob, { status } as unknown as Pick<typeof fullTranscriptionApi, 'status'>);
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1500);
    abort.abort(); finish(job()); await rejected;
    expect(onJob).not.toHaveBeenCalled();
  });
});

describe('shared original upload guard', () => {
  it('prevents competing panels and releases only after the owning upload settles', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const first = withSourceUpload('owner-project', new AbortController().signal, () => pending);
    await expect(withSourceUpload('owner-project', new AbortController().signal, async () => {})).rejects.toThrow('다른 화면');
    await expect(withSourceUpload('another-project', new AbortController().signal, async () => 'ok')).resolves.toBe('ok');
    finish(); await first;
    await expect(withSourceUpload('owner-project', new AbortController().signal, async () => 'ok')).resolves.toBe('ok');
  });
  it('releases the guard after an upload failure and does not start an aborted operation', async () => {
    await expect(withSourceUpload('owner-project', new AbortController().signal, async () => { throw new Error('upload failed'); })).rejects.toThrow('upload failed');
    await expect(withSourceUpload('owner-project', new AbortController().signal, async () => 'ok')).resolves.toBe('ok');
    const abort = new AbortController(); abort.abort(); const upload = vi.fn();
    await expect(withSourceUpload('owner-project', abort.signal, upload)).rejects.toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });
});
