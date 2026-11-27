import type { FullSource, JobState } from './full-tracking-contract.js';
import { sameSource, sourceResult } from './full-tracking-contract.js';
import { HttpError } from './security.js';

export const TRANSCRIPTION_CHUNK_SECONDS = 300;
export const MAX_TRANSCRIPT_WINDOW_BYTES = 512 * 1024;
export interface FullTranscriptionJob {
  id: string; state: JobState; source: FullSource; duration: number; processedSeconds: number; chunkSeconds: number;
  completedChunks: number; totalChunks: number; segmentCount: number; sourceSha256: string | null;
  error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
}
export interface TranscriptWindow {
  jobId: string; index: number; start: number; end: number; source: FullSource; sourceSha256: string;
  segments: { segmentIndex: number; startSeconds: number; endSeconds: number; text: string }[];
}
export const activeTranscription = (job: Pick<FullTranscriptionJob, 'state'>) => ['queued', 'running', 'cancelling'].includes(job.state);
const invalid = (): never => { throw new HttpError(502, 'TRANSCRIPTION_RESPONSE_INVALID', '전사 작업과 결과의 정보를 확인하지 못했습니다.'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const number = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : invalid();
const integer = (value: unknown, min: number, max: number): number => { const result = number(value, min, max); return Number.isSafeInteger(result) ? result : invalid(); };
const date = (value: unknown): string => typeof value === 'string' && value.length <= 35 && Number.isFinite(Date.parse(value)) ? value : invalid();
const sha = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : invalid();

export function transcriptionJob(value: unknown, id: string, source: FullSource): FullTranscriptionJob {
  const row = object(value);
  if (row.id !== id || !['queued', 'running', 'cancelling', 'cancelled', 'interrupted', 'failed', 'completed'].includes(String(row.state))
    || !sameSource(sourceResult(row.source), source)) invalid();
  const total = Math.ceil(source.duration / TRANSCRIPTION_CHUNK_SECONDS);
  const result: FullTranscriptionJob = {
    id, source, state: row.state as JobState, duration: number(row.duration, source.duration, source.duration),
    processedSeconds: number(row.processedSeconds, 0, source.duration), chunkSeconds: number(row.chunkSeconds, 300, 300),
    completedChunks: integer(row.completedChunks, 0, total), totalChunks: integer(row.totalChunks, total, total),
    segmentCount: integer(row.segmentCount, 0, total * 2000), sourceSha256: row.sourceSha256 === null ? null : sha(row.sourceSha256),
    error: null, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  };
  if (row.error !== null) {
    const error = object(row.error);
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : invalid();
    if (typeof error.message !== 'string' || !error.message.trim() || error.message.length > 1000) invalid();
    const messages: Record<string, string> = {
      NO_AUDIO: '원본 영상에 음성 트랙이 없습니다.', STT_TIMEOUT: '전사 구간의 처리 시간이 초과됐습니다. 저장된 지점부터 재개해 주세요.',
      DISPATCH_FAILED: '전사 작업을 시작하지 못했습니다. 다시 시도해 주세요.', EXECUTION_INTERRUPTED: '실행이 중단됐습니다. 저장된 지점부터 재개할 수 있습니다.',
      MODEL_UNAVAILABLE: '전사 모델이 준비되지 않았습니다. 서버 설정을 확인해 주세요.', CONFIG_INVALID: '분석 서버의 전사 설정을 확인해 주세요.',
    };
    result.error = { code, message: messages[code] ?? '전사 작업을 완료하지 못했습니다. 원본과 작업 상태를 확인해 주세요.' };
  }
  if (result.segmentCount > result.completedChunks * 2000
    || Math.abs(result.processedSeconds - Math.min(source.duration, result.completedChunks * 300)) > .001
    || result.completedChunks > 0 && !result.sourceSha256
    || result.state === 'completed' && (result.completedChunks !== total || result.processedSeconds !== source.duration || !result.sourceSha256 || result.error)) invalid();
  return result;
}

export function transcriptionWindow(value: unknown, job: FullTranscriptionJob, requestedStart: number): TranscriptWindow {
  const row = object(value); const start = Math.floor(requestedStart / 300) * 300; const end = Math.min(job.duration, start + 300);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_TRANSCRIPT_WINDOW_BYTES || row.jobId !== job.id || row.index !== start / 300
    || row.start !== start || row.end !== end || !sameSource(sourceResult(row.source), job.source)
    || !job.sourceSha256 || sha(row.sourceSha256) !== job.sourceSha256 || end > job.processedSeconds + .001
    || !Array.isArray(row.segments) || row.segments.length > 2000) invalid();
  let previousIndex = -1, previousStart = -1;
  const segments = (row.segments as unknown[]).map(value => {
    const segment = object(value); const index = integer(segment.segmentIndex, 0, job.segmentCount - 1);
    const from = number(segment.startSeconds, start, end), to = number(segment.endSeconds, from, end);
    const text = typeof segment.text === 'string' && segment.text.trim() && segment.text.length <= 2000 && !/\u0000/.test(segment.text) ? segment.text : invalid();
    if (index <= previousIndex || from < previousStart || to <= from) invalid();
    previousIndex = index; previousStart = from;
    return { segmentIndex: index, startSeconds: from, endSeconds: to, text };
  });
  return { jobId: job.id, index: start / 300, start, end, source: job.source, sourceSha256: job.sourceSha256!, segments };
}
