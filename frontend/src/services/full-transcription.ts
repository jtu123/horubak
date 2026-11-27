import { ApiError, request } from './api';
import { parseFullSource } from './full-tracking';
import { sameStoredSource, trackingWindowStart } from '../full-tracking-model';
import type { FullSource } from '../full-tracking-model';
import { activeTranscriptionJob, TRANSCRIPTION_CHUNK_SECONDS } from '../full-transcription-model';
import type { FullTranscriptionJob, FullTranscriptionWindow } from '../full-transcription-model';

const invalid = () => new ApiError(502, 'INVALID_TRANSCRIPTION_RESPONSE', '전사 작업 정보를 확인하지 못했어요. 다시 불러와 주세요.');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function requireTranscriptionSource(job: FullTranscriptionJob, source: FullSource) {
  if (!sameStoredSource(job.source, source) || job.source.filename !== source.filename || job.source.duration !== source.duration
    || job.source.width !== source.width || job.source.height !== source.height) throw new ApiError(409, 'TRANSCRIPTION_SOURCE_CHANGED', '원본이 바뀌었어요. 전사 작업을 다시 불러와 주세요.');
}

export function parseTranscriptionJob(value: unknown): FullTranscriptionJob {
  const job = object(value); const source = parseFullSource(job.source);
  if (!text(job.id, 128) || !['queued', 'running', 'cancelling', 'cancelled', 'interrupted', 'failed', 'completed'].includes(String(job.state))
    || !finite(job.duration) || job.duration !== source.duration || job.chunkSeconds !== TRANSCRIPTION_CHUNK_SECONDS
    || !finite(job.processedSeconds) || job.processedSeconds < 0 || job.processedSeconds > job.duration
    || !Number.isSafeInteger(job.completedChunks) || (job.completedChunks as number) < 0
    || job.totalChunks !== Math.ceil(job.duration / TRANSCRIPTION_CHUNK_SECONDS) || (job.completedChunks as number) > (job.totalChunks as number)
    || Math.abs(job.processedSeconds - Math.min((job.completedChunks as number) * TRANSCRIPTION_CHUNK_SECONDS, job.duration)) > .001
    || !Number.isSafeInteger(job.segmentCount) || (job.segmentCount as number) < 0 || (job.segmentCount as number) > (job.completedChunks as number) * 2000
    || job.sourceSha256 !== null && !sha(job.sourceSha256) || !date(job.createdAt) || !date(job.updatedAt)) throw invalid();
  if (job.state === 'completed' && (job.completedChunks !== job.totalChunks || job.processedSeconds !== job.duration || !sha(job.sourceSha256))) throw invalid();
  if (job.error !== null) { const failure = object(job.error); if (!text(failure.code, 128) || !text(failure.message, 2000)) throw invalid(); }
  return { ...job, source } as unknown as FullTranscriptionJob;
}

export function parseTranscriptionWindow(value: unknown): FullTranscriptionWindow {
  const envelope = object(value); const job = parseTranscriptionJob(envelope.job);
  if (!text(envelope.sourceRevision, 128) || !['pending', 'ready'].includes(String(envelope.state))) throw invalid();
  if (envelope.state === 'pending') { if (envelope.window !== null) throw invalid(); return { job, sourceRevision: envelope.sourceRevision, state: 'pending', window: null }; }
  const window = object(envelope.window); const source = parseFullSource(window.source);
  requireTranscriptionSource(job, source);
  if (!Number.isSafeInteger(window.index) || (window.index as number) < 0 || window.jobId !== job.id
    || window.start !== (window.index as number) * TRANSCRIPTION_CHUNK_SECONDS
    || window.end !== Math.min((window.start as number) + TRANSCRIPTION_CHUNK_SECONDS, job.duration)
    || (window.start as number) >= job.duration || (window.end as number) > job.processedSeconds + .001
    || !sha(window.sourceSha256) || window.sourceSha256 !== job.sourceSha256 || !Array.isArray(window.segments) || window.segments.length > 2000
    || new TextEncoder().encode(JSON.stringify(window)).byteLength > 512 * 1024) throw invalid();
  let previousIndex = -1; let previousStart = -1;
  for (const raw of window.segments) {
    const segment = object(raw);
    if (!Number.isSafeInteger(segment.segmentIndex) || (segment.segmentIndex as number) <= previousIndex
      || !finite(segment.startSeconds) || !finite(segment.endSeconds) || segment.startSeconds < 0 || segment.endSeconds > job.duration
      || segment.startSeconds < (window.start as number) - .001 || segment.endSeconds > (window.end as number) + .001
      || segment.endSeconds <= segment.startSeconds || segment.startSeconds < previousStart
      || !text(segment.text, 2000) || !segment.text.trim()) throw invalid();
    previousIndex = segment.segmentIndex as number; previousStart = segment.startSeconds;
  }
  return { job, sourceRevision: envelope.sourceRevision, state: 'ready', window } as unknown as FullTranscriptionWindow;
}

const prefix = (project: string) => `/api/transcripts/projects/${encodeURIComponent(project)}/jobs`;
const path = (project: string, job: string) => `${prefix(project)}/${encodeURIComponent(job)}`;
const mutation = (signal?: AbortSignal) => ({ method: 'POST', body: '{}', signal });
const matchingJob = (value: unknown, jobId?: string) => {
  const job = parseTranscriptionJob(object(value).job); if (jobId && job.id !== jobId) throw invalid(); return job;
};
export const fullTranscriptionApi = {
  latest: async (project: string, signal?: AbortSignal) => {
    const value = object(await request<unknown>(`${prefix(project)}/latest`, { signal }));
    return value.job === null ? null : parseTranscriptionJob(value.job);
  },
  create: async (project: string, signal?: AbortSignal) => matchingJob(await request<unknown>(prefix(project), mutation(signal), 60000)),
  status: async (project: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(path(project, jobId), { signal }), jobId),
  cancel: async (project: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(`${path(project, jobId)}/cancel`, mutation(signal)), jobId),
  resume: async (project: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(`${path(project, jobId)}/resume`, mutation(signal), 60000), jobId),
  window: async (project: string, jobId: string, start: number, signal?: AbortSignal) => {
    const envelope = parseTranscriptionWindow(await request<unknown>(`${path(project, jobId)}/window?start=${encodeURIComponent(start)}`, { signal }));
    if (envelope.job.id !== jobId || envelope.window && envelope.window.start !== trackingWindowStart(start, envelope.job.duration, TRANSCRIPTION_CHUNK_SECONDS)) throw invalid();
    return envelope;
  },
};

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** Observation stops on teardown; only the explicit cancel action mutates the server job. */
export async function watchTranscriptionJob(project: string, jobId: string, source: FullSource, signal: AbortSignal,
  onJob: (job: FullTranscriptionJob) => void, api: Pick<typeof fullTranscriptionApi, 'status'> = fullTranscriptionApi) {
  let interval = 1500;
  while (!signal.aborted) {
    await delay(interval, signal);
    const job = await api.status(project, jobId, signal); signal.throwIfAborted(); requireTranscriptionSource(job, source);
    if (job.id !== jobId) throw invalid();
    onJob(job); if (!activeTranscriptionJob(job)) return;
    interval = 2500;
  }
  signal.throwIfAborted();
}
