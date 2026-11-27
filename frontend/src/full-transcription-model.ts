import type { FullJobState, FullSource } from './full-tracking-model';
import type { SavedTranscriptSegment } from './services/analysis';

export const TRANSCRIPTION_CHUNK_SECONDS = 300;
export const TRANSCRIPT_PAGE_SIZE = 100;
export interface FullTranscriptionJob {
  id: string; state: FullJobState; source: FullSource; processedSeconds: number; duration: number;
  chunkSeconds: number; completedChunks: number; totalChunks: number; segmentCount: number;
  sourceSha256: string | null; error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
}
export interface TranscriptWindow {
  jobId: string; index: number; start: number; end: number; source: FullSource; sourceSha256: string;
  segments: Omit<SavedTranscriptSegment, 'id'>[];
}
export interface FullTranscriptionWindow {
  job: FullTranscriptionJob; sourceRevision: string; state: 'pending' | 'ready'; window: TranscriptWindow | null;
}
export const activeTranscriptionJob = (job: FullTranscriptionJob | null) => !!job && ['queued', 'running', 'cancelling'].includes(job.state);
export const resumableTranscriptionJob = (job: FullTranscriptionJob | null) => !!job && ['cancelled', 'failed', 'interrupted'].includes(job.state);
