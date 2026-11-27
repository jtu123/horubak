import type { TrackingResult, TrackingSelection } from './tracking-model';

export const MAX_FULL_SOURCE_BYTES = 4 * 1024 ** 3;
export const MAX_FULL_SOURCE_SECONDS = 10 * 3600;
export const FULL_UPLOAD_CHUNK_BYTES = 8 * 1024 ** 2;
export interface FullSource {
  uploadId: string; filename: string; size: number; duration: number; width: number; height: number;
  objectKey: string; generation: string; checksum: string;
}
export type FullJobState = 'queued' | 'running' | 'cancelling' | 'cancelled' | 'interrupted' | 'failed' | 'completed';
export interface FullJob {
  id: string; state: FullJobState; source: FullSource; processedSeconds: number; duration: number; sampleFps: number;
  chunkSeconds: number; completedChunks: number; totalChunks: number; sourceSha256: string | null;
  error: { code: string; message: string } | null; createdAt: string; updatedAt: string;
}
export interface UploadSession { uploadId: string; uploadUrl: string; chunkBytes: number; expiresAt: string }
export interface FullTrackingWindow { job: FullJob; state: 'missing' | 'ready'; result: TrackingResult | null; selections: TrackingSelection[] }
export const activeTrackingJob = (job: FullJob | null) => !!job && ['queued', 'running', 'cancelling'].includes(job.state);
export const resumableTrackingJob = (job: FullJob | null) => !!job && ['cancelled', 'interrupted', 'failed'].includes(job.state);
export function sameStoredSource(left: FullSource | null, right: FullSource | null) {
  return !!left && !!right && left.uploadId === right.uploadId && left.objectKey === right.objectKey
    && left.generation === right.generation && left.size === right.size && left.checksum === right.checksum;
}
export function trackingWindowStart(time: number, duration: number, chunkSeconds = 60) {
  if (![time, duration, chunkSeconds].every(Number.isFinite) || duration <= 0 || chunkSeconds <= 0) return 0;
  return Math.floor(Math.max(0, Math.min(time, duration - .000001)) / chunkSeconds) * chunkSeconds;
}
