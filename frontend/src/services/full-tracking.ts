import { ApiError, request } from './api';
import { trackingEnvelope } from './tracking';
import { FULL_UPLOAD_CHUNK_BYTES, MAX_FULL_SOURCE_BYTES, MAX_FULL_SOURCE_SECONDS, sameStoredSource, trackingWindowStart } from '../full-tracking-model';
import type { FullJob, FullSource, FullTrackingWindow, UploadSession } from '../full-tracking-model';
import type { TrackingSelection } from '../tracking-model';

const invalid = () => new ApiError(502, 'INVALID_FULL_TRACKING_RESPONSE', '전체 추적 정보를 확인하지 못했어요. 다시 불러와 주세요.');
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; };
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function parseFullSource(value: unknown): FullSource {
  const source = object(value);
  if (!text(source.uploadId, 128) || !text(source.filename, 500) || !text(source.objectKey, 1024) || !text(source.generation, 128) || !text(source.checksum, 128)
    || !Number.isSafeInteger(source.size) || (source.size as number) <= 0 || (source.size as number) > MAX_FULL_SOURCE_BYTES
    || !finite(source.duration) || source.duration <= 0 || source.duration > MAX_FULL_SOURCE_SECONDS
    || !Number.isInteger(source.width) || !Number.isInteger(source.height) || (source.width as number) <= 0 || (source.height as number) <= 0
    || (source.width as number) * (source.height as number) > 16777216) throw invalid();
  return source as unknown as FullSource;
}

export function parseFullJob(value: unknown): FullJob {
  const job = object(value); const source = parseFullSource(job.source);
  if (!text(job.id, 128) || !['queued', 'running', 'cancelling', 'cancelled', 'interrupted', 'failed', 'completed'].includes(String(job.state))
    || !finite(job.duration) || Math.abs(job.duration - source.duration) > .001
    || !finite(job.processedSeconds) || job.processedSeconds < 0 || job.processedSeconds > job.duration + .001
    || !finite(job.sampleFps) || job.sampleFps < .5 || job.sampleFps > 4 || !finite(job.chunkSeconds) || job.chunkSeconds <= 0 || job.chunkSeconds > 120
    || !Number.isInteger(job.completedChunks) || (job.completedChunks as number) < 0 || !Number.isInteger(job.totalChunks)
    || job.totalChunks !== Math.ceil(job.duration / job.chunkSeconds) || (job.completedChunks as number) > (job.totalChunks as number)
    || job.sourceSha256 !== null && !sha(job.sourceSha256) || !date(job.createdAt) || !date(job.updatedAt)) throw invalid();
  if (job.state === 'completed' && (job.completedChunks !== job.totalChunks || Math.abs(job.duration - job.processedSeconds) > .001 || !sha(job.sourceSha256))) throw invalid();
  if (job.error !== null) { const error = object(job.error); if (!text(error.code, 128) || !text(error.message, 2000)) throw invalid(); }
  return { ...job, source } as unknown as FullJob;
}

function uploadAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw invalid();
  let url: URL; try { url = new URL(value); } catch { throw invalid(); }
  const localPage = typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const gcs = url.protocol === 'https:' && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com'));
  const local = localPage && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!gcs && !local) || url.username || url.password || url.hash) throw invalid();
  return value;
}
export function parseUploadSession(value: unknown): UploadSession {
  const session = object(value);
  if (!text(session.uploadId, 128) || session.chunkBytes !== FULL_UPLOAD_CHUNK_BYTES || !date(session.expiresAt)) throw invalid();
  return { uploadId: session.uploadId, chunkBytes: FULL_UPLOAD_CHUNK_BYTES, expiresAt: session.expiresAt, uploadUrl: uploadAddress(session.uploadUrl) };
}
export function parseFullWindow(value: unknown): FullTrackingWindow {
  const data = object(value); const job = parseFullJob(data.job);
  if (!['missing', 'ready'].includes(String(data.state))) throw invalid();
  const envelope = trackingEnvelope(data, { maxTracks: 1440, maxObservations: 1440 });
  const result = envelope.result;
  if (result && (result.analysisId !== job.id || !job.sourceSha256 || result.sourceSha256 !== job.sourceSha256
    || Math.abs(result.source.duration - job.duration) > .001 || result.source.width !== job.source.width || result.source.height !== job.source.height
    || Math.abs(result.range.sampleFps - job.sampleFps) > .000001
    || result.range.end - result.range.start > job.chunkSeconds + .001 || result.range.end > job.processedSeconds + .001)) throw invalid();
  return { job, state: data.state as 'missing' | 'ready', result, selections: envelope.selections };
}

const prefix = (projectId: string) => `/api/tracking/projects/${encodeURIComponent(projectId)}`;
const jobPath = (projectId: string, jobId: string) => `${prefix(projectId)}/jobs/${encodeURIComponent(jobId)}`;
const json = (body: unknown, signal?: AbortSignal) => ({ method: 'POST', body: JSON.stringify(body), signal });
const matchingJob = (value: unknown, jobId: string) => { const job = parseFullJob(object(value).job); if (job.id !== jobId) throw invalid(); return job; };
export const fullTrackingApi = {
  configured: async (signal?: AbortSignal) => (await request<{ fullTrackingConfigured?: boolean }>('/api/health', { signal })).fullTrackingConfigured === true,
  source: async (projectId: string, signal?: AbortSignal) => {
    const body = object(await request<unknown>(`${prefix(projectId)}/source`, { signal }));
    return { source: body.source === null ? null : parseFullSource(body.source), upload: body.upload === null ? null : parseUploadSession(body.upload) };
  },
  init: async (projectId: string, file: File, signal?: AbortSignal) => parseUploadSession(await request<unknown>(`${prefix(projectId)}/source`, json({ filename: file.name, size: file.size, contentType: file.type || 'video/mp4' }, signal))),
  complete: async (projectId: string, uploadId: string, signal?: AbortSignal) => parseFullSource(object(await request<unknown>(`${prefix(projectId)}/source/${encodeURIComponent(uploadId)}/complete`, json({}, signal), 60000)).source),
  latest: async (projectId: string, signal?: AbortSignal) => { const body = object(await request<unknown>(`${prefix(projectId)}/jobs/latest`, { signal })); return body.job === null ? null : parseFullJob(body.job); },
  create: async (projectId: string, signal?: AbortSignal) => parseFullJob(object(await request<unknown>(`${prefix(projectId)}/jobs`, json({}, signal), 60000)).job),
  status: async (projectId: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(jobPath(projectId, jobId), { signal }), jobId),
  cancel: async (projectId: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(`${jobPath(projectId, jobId)}/cancel`, json({}, signal)), jobId),
  resume: async (projectId: string, jobId: string, signal?: AbortSignal) => matchingJob(await request<unknown>(`${jobPath(projectId, jobId)}/resume`, json({}, signal), 60000), jobId),
  window: async (projectId: string, jobId: string, start: number, signal?: AbortSignal) => {
    const window = parseFullWindow(await request<unknown>(`${jobPath(projectId, jobId)}/window?start=${encodeURIComponent(start)}`, { signal }));
    if (window.job.id !== jobId || window.result && Math.abs(window.result.range.start - trackingWindowStart(start, window.job.duration, window.job.chunkSeconds)) > .001) throw invalid();
    return window;
  },
  select: async (projectId: string, data: FullTrackingWindow, sceneId: string, trackId: string | null, signal?: AbortSignal): Promise<TrackingSelection[]> => {
    if (!data.result) throw invalid();
    const body = object(await request<unknown>(`${jobPath(projectId, data.job.id)}/selection`, { method: 'PUT', signal,
      body: JSON.stringify({ windowStart: data.result.range.start, sourceRevision: data.result.sourceRevision, sceneId, trackId }) }));
    return trackingEnvelope({ state: 'ready', result: data.result, selections: body.selections }, { maxTracks: 1440, maxObservations: 1440 }).selections;
  },
};

function acceptedOffset(response: Response, size: number): number {
  if (response.status === 200 || response.status === 201) return size;
  if (response.status !== 308) {
    if (response.status === 404 || response.status === 410) throw new Error('업로드 연결이 만료됐어요. 원본을 다시 선택해 시작해 주세요.');
    throw new Error('원본을 저장하지 못했어요. 같은 파일을 선택하면 이어 올릴 수 있어요.');
  }
  const range = response.headers.get('Range');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/i.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error('저장된 업로드 범위를 확인하지 못했어요. 다시 시작해 주세요.');
  return offset;
}

/** Uploads only File.slice buffers. The storage capability receives no account credentials. */
export async function uploadResumable(file: Pick<File, 'size' | 'slice'> & { type?: string }, session: UploadSession, signal: AbortSignal,
  onProgress: (bytes: number) => void, fetcher: typeof fetch = fetch): Promise<void> {
  signal.throwIfAborted(); uploadAddress(session.uploadUrl);
  if (!file.size || file.size > MAX_FULL_SOURCE_BYTES || session.chunkBytes !== FULL_UPLOAD_CHUNK_BYTES) throw new Error('원본은 4GB 이하 파일이어야 해요.');
  const send = (headers: Record<string, string>, body?: Blob) => fetcher(session.uploadUrl, { method: 'PUT', headers, body,
    credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
  const query = async () => {
    signal.throwIfAborted(); const response = await send({ 'Content-Range': `bytes */${file.size}` });
    try { return acceptedOffset(response, file.size); } finally { await response.body?.cancel(); }
  };
  let offset = await query(); let failures = 0; onProgress(offset);
  while (offset < file.size) {
    signal.throwIfAborted(); const end = Math.min(file.size, offset + session.chunkBytes);
    let response: Response;
    try { response = await send({ 'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`, 'Content-Type': file.type || 'application/octet-stream' }, file.slice(offset, end)); }
    catch (reason) {
      if (signal.aborted) throw reason;
      if (++failures > 3) throw new Error('업로드 연결이 끊겼어요. 같은 파일을 선택하면 이어 올릴 수 있어요.');
      offset = await query(); onProgress(offset); continue;
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      if (++failures > 3) throw new Error('저장소가 응답하지 않아요. 잠시 후 같은 파일로 이어 올려 주세요.');
      offset = await query(); onProgress(offset); continue;
    }
    let next: number;
    try { next = acceptedOffset(response, file.size); } finally { await response.body?.cancel(); }
    if (next <= offset || next > end) throw new Error('업로드 진행 범위를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요.');
    offset = next; failures = 0; onProgress(offset);
  }
}

export function requireJobSource(job: FullJob, source: FullSource) {
  if (!sameStoredSource(job.source, source)) throw new ApiError(409, 'TRACKING_SOURCE_CHANGED', '원본이 바뀌었어요. 작업을 다시 불러와 주세요.');
}
