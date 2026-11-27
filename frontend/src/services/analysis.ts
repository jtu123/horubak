import { ApiError, request } from './api';
import type { Utterance } from '../types';

export interface SavedTranscriptSegment {
  id: string | number;
  segmentIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}
export interface ContextResult {
  status: 'keep' | 'expand' | 'review';
  reason: string;
  originalStartSeconds: number;
  originalEndSeconds: number;
  suggestion: { startSeconds: number; endSeconds: number; durationSeconds: number } | null;
}
export interface ContextTranscriptIdentity { expectedJobId: string; expectedSourceSha256: string }
const invalid = () => new ApiError(502, 'INVALID_ANALYSIS_RESPONSE', '분석 결과의 형식을 확인하지 못했어요. 다시 요청해 주세요.');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function transcriptResult(value: unknown, duration: number): Utterance[] {
  if (!Array.isArray(value) || value.length > 50000) throw invalid();
  const seen = new Set<number>();
  return value.map((item: SavedTranscriptSegment) => {
    if (!item || !Number.isInteger(item.segmentIndex) || item.segmentIndex < 0 || seen.has(item.segmentIndex)
      || !finite(item.startSeconds) || !finite(item.endSeconds) || item.startSeconds < 0 || item.endSeconds <= item.startSeconds
      || item.endSeconds > duration + 1 || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 10000) throw invalid();
    seen.add(item.segmentIndex);
    return { id: 'transcript-' + item.segmentIndex, start: item.startSeconds, end: item.endSeconds, text: item.text, speaker: '발화' };
  }).sort((a, b) => a.start - b.start);
}

function contextResult(value: unknown, start: number, end: number, duration: number): ContextResult {
  if (!value || typeof value !== 'object') throw invalid();
  const result = value as ContextResult;
  if (!['keep', 'expand', 'review'].includes(result.status) || typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 10000
    || result.originalStartSeconds !== start || result.originalEndSeconds !== end) throw invalid();
  if (result.suggestion !== null) {
    const suggestion = result.suggestion;
    if (!suggestion || !finite(suggestion.startSeconds) || !finite(suggestion.endSeconds) || !finite(suggestion.durationSeconds)
      || suggestion.startSeconds < 0 || suggestion.endSeconds > duration || suggestion.startSeconds > start || suggestion.endSeconds < end
      || suggestion.endSeconds - suggestion.startSeconds < 30 || suggestion.endSeconds - suggestion.startSeconds > 60
      || Math.abs(suggestion.durationSeconds - (suggestion.endSeconds - suggestion.startSeconds)) > .01 || result.status !== 'expand') throw invalid();
  } else if (result.status === 'expand') throw invalid();
  return result;
}

export const analysisApi = {
  transcript: async (projectId: string, duration: number, signal?: AbortSignal) => transcriptResult(await request<unknown>(`/api/transcripts/projects/${encodeURIComponent(projectId)}`, { signal }), duration),
  transcribe: async (projectId: string, duration: number, file: File, signal?: AbortSignal) => {
    const body = new FormData(); body.set('file', file);
    return transcriptResult(await request<unknown>(`/api/transcripts/projects/${encodeURIComponent(projectId)}/analyze`, { method: 'POST', body, signal }, 15 * 60 * 1000), duration);
  },
  context: async (projectId: string, start: number, end: number, duration: number, signal?: AbortSignal, expected?: ContextTranscriptIdentity) => {
    const query = new URLSearchParams({ start: String(start), end: String(end) });
    return contextResult(await request<unknown>(`/api/transcripts/projects/${encodeURIComponent(projectId)}/context-check?${query}`, { method: 'POST', body: JSON.stringify(expected ?? {}), signal }, 120000), start, end, duration);
  },
};
