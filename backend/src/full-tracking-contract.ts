import type { AnalysisOptions } from './analysis.js';
import { service } from './analysis.js';
import { HttpError } from './security.js';

export const MAX_SOURCE_BYTES = 4 * 1024 ** 3;
export const MAX_SOURCE_SECONDS = 36000;
export interface FullSource {
  uploadId: string; filename: string; size: number; duration: number; width: number; height: number;
  objectKey: string; generation: string; checksum: string;
}
export type JobState = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'interrupted' | 'failed' | 'completed';
export interface FullJob {
  id: string; state: JobState; source: FullSource; processedSeconds: number; duration: number; sampleFps: number;
  chunkSeconds: number; completedChunks: number; totalChunks: number; sourceSha256: string | null;
  error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
}
export interface UploadSession { uploadId: string; uploadUrl: string; chunkBytes: number; expiresAt: string }
export const activeJob = (job: FullJob) => ['queued', 'running', 'cancelling'].includes(job.state);
const invalid = (): never => { throw new HttpError(502, 'FULL_TRACKING_RESPONSE_INVALID', '전체 영상 분석 서버의 응답을 확인하지 못했습니다.'); };
export const dictionary = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const finite = (value: unknown, minimum: number, maximum: number): number => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : invalid();
const text = (value: unknown, maximum = 500): string => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
export const uuid = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value) ? value : invalid();
const date = (value: unknown): string => typeof value === 'string' && value.length <= 35 && Number.isFinite(Date.parse(value)) ? value : invalid();
const integer = (value: unknown, min: number, max: number) => { const result = finite(value, min, max); return Number.isSafeInteger(result) ? result : invalid(); };

export function sourceResult(value: unknown, expected?: { ownerId: string; projectId: string; uploadId: string; filename: string; size: number }): FullSource {
  const row = dictionary(value);
  const result: FullSource = {
    uploadId: uuid(row.uploadId), filename: text(row.filename), size: integer(row.size, 1, MAX_SOURCE_BYTES),
    duration: finite(row.duration, 0.001, MAX_SOURCE_SECONDS), width: integer(row.width, 1, 163840), height: integer(row.height, 1, 163840),
    objectKey: text(row.objectKey, 700), generation: text(row.generation, 128), checksum: text(row.checksum, 200),
  };
  if (result.width * result.height > 16777216 || !/^[A-Za-z0-9_-]+$/.test(result.generation)
    || !/^[A-Za-z0-9_+\/=.-]+$/.test(result.checksum) || !/^originals\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(result.objectKey)) invalid();
  if (expected && (result.uploadId !== expected.uploadId || result.filename.normalize('NFC') !== expected.filename.normalize('NFC') || result.size !== expected.size
    || result.objectKey !== `originals/${expected.ownerId}/${expected.projectId}/${expected.uploadId}`)) invalid();
  return result;
}

export function sameSource(first: FullSource, second: FullSource) {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function jobResult(value: unknown, jobId: string, source: FullSource): FullJob {
  const row = dictionary(value); const states: JobState[] = ['queued', 'running', 'cancelling', 'cancelled', 'interrupted', 'failed', 'completed'];
  if (row.id !== jobId || !states.includes(row.state as JobState) || !sameSource(sourceResult(row.source), source)) invalid();
  const result: FullJob = {
    id: jobId, state: row.state as JobState, source, processedSeconds: finite(row.processedSeconds, 0, source.duration),
    duration: finite(row.duration, source.duration, source.duration), sampleFps: finite(row.sampleFps, 2, 2), chunkSeconds: finite(row.chunkSeconds, 60, 60),
    completedChunks: integer(row.completedChunks, 0, 600), totalChunks: integer(row.totalChunks, 1, 600),
    sourceSha256: row.sourceSha256 === null ? null : typeof row.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sourceSha256) ? row.sourceSha256 : invalid(),
    error: null, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  };
  if (row.error !== null) {
    const error = dictionary(row.error); const code = text(error.code, 80);
    if (!/^[A-Z0-9_]+$/.test(code)) invalid();
    result.error = { code, message: text(error.message, 1000) };
  }
  if (result.totalChunks !== Math.ceil(source.duration / result.chunkSeconds) || result.completedChunks > result.totalChunks
    || Math.abs(result.processedSeconds - Math.min(source.duration, result.completedChunks * 60)) > .001
    || result.state === 'completed' && (result.processedSeconds !== source.duration || result.completedChunks !== result.totalChunks || !result.sourceSha256 || result.error)) invalid();
  return result;
}

export function providerUrl(value: unknown, options?: AnalysisOptions): string {
  const raw = text(value, 8192); let url: URL;
  try { url = new URL(raw); } catch { return invalid(); }
  if (url.username || url.password || url.hash) invalid();
  const local = service(options).url;
  const google = url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && (!url.port || url.port === '443');
  const development = local.protocol === 'http:' && url.origin === local.origin && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!google && !development) invalid();
  return url.toString();
}

export function uploadSession(value: unknown, uploadId: string, options?: AnalysisOptions): UploadSession {
  const row = dictionary(value); const chunkBytes = integer(row.chunkBytes, 256 * 1024, 8 * 1024 * 1024);
  if (chunkBytes % (256 * 1024)) invalid();
  return { uploadId, uploadUrl: providerUrl(row.uploadUrl, options), chunkBytes, expiresAt: date(row.expiresAt) };
}
