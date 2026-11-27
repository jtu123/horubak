import { ApiError, request } from './api';
import { containTrackingBox, trackingRangeError, updateTrackingSelection } from '../tracking-model';
import type { TrackingEnvelope, TrackingResult, TrackingSelection } from '../tracking-model';

const invalid = () => new ApiError(502, 'INVALID_TRACKING_RESPONSE', '피사체 분석 결과를 확인하지 못했어요. 다시 불러와 주세요.');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// The project API validates the engine response too; reject malformed data at
// this browser boundary before it is used for drawing or selection.
export function trackingEnvelope(value: unknown, limits = { maxTracks: 64, maxObservations: 2880 }): TrackingEnvelope {
  if (!value || typeof value !== 'object') throw invalid();
  const envelope = value as TrackingEnvelope;
  if (!['missing', 'ready', 'stale'].includes(envelope.state) || !Array.isArray(envelope.selections) || envelope.selections.length > 240) throw invalid();
  if (envelope.result === null) {
    if (envelope.state === 'ready' || envelope.selections.length) throw invalid();
    return envelope;
  }
  const result = envelope.result;
  if (!result || result.schemaVersion !== 1 || typeof result.analysisId !== 'string' || !result.analysisId
    || typeof result.sourceRevision !== 'string' || !result.sourceRevision || !/^[a-f0-9]{64}$/i.test(result.sourceSha256 || '')
    || typeof result.createdAt !== 'string' || !Number.isFinite(Date.parse(result.createdAt))
    || !result.model || typeof result.model.name !== 'string' || !result.model.name || typeof result.model.version !== 'string'
    || !/^[a-f0-9]{64}$/i.test(result.model.sha256 || '')
    || !result.source || ![result.source.width, result.source.height, result.source.duration].every(finite)
    || Math.min(result.source.width, result.source.height, result.source.duration) <= 0
    || !result.range || trackingRangeError(result.range.start, result.range.end, result.source.duration, result.range.sampleFps)
    || !Array.isArray(result.scenes) || result.scenes.length > 240 || !Array.isArray(result.tracks) || result.tracks.length > limits.maxTracks
    || !Array.isArray(result.recommendations) || !Array.isArray(result.warnings) || result.warnings.length > 300) throw invalid();
  const scenes = new Set<string>(); const tracks = new Set<string>(); let observations = 0;
  for (const scene of result.scenes) {
    if (!scene || typeof scene.id !== 'string' || !scene.id || scenes.has(scene.id) || !finite(scene.start) || !finite(scene.end) || scene.end <= scene.start
      || scene.start < result.range.start || scene.end > result.range.end + .001) throw invalid();
    scenes.add(scene.id);
  }
  for (const track of result.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || tracks.has(track.id) || !scenes.has(track.sceneId) || typeof track.label !== 'string'
      || !Number.isInteger(track.classId) || track.classId < 0 || track.classId > 79
      || !finite(track.start) || !finite(track.end) || track.end < track.start || !finite(track.meanConfidence) || track.meanConfidence < 0 || track.meanConfidence > 1
      || !Array.isArray(track.observations) || !Array.isArray(track.gaps)) throw invalid();
    const scene = result.scenes.find(item => item.id === track.sceneId)!;
    if (track.start < scene.start || track.end > scene.end) throw invalid();
    tracks.add(track.id); observations += track.observations.length;
    if (observations > limits.maxObservations) throw invalid();
    let lastTime = -1;
    for (const observation of track.observations) {
      if (!observation || !finite(observation.time) || observation.time < lastTime || observation.time < track.start || observation.time > track.end
        || !finite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1
        || !Array.isArray(observation.bbox) || observation.bbox.length !== 4 || !containTrackingBox(observation.bbox, 1, 1, 1, 1)) throw invalid();
      lastTime = observation.time;
    }
    if (track.gaps.some(gap => !gap || !finite(gap.start) || !finite(gap.end) || gap.end <= gap.start || gap.start < scene.start || gap.end > scene.end)) throw invalid();
  }
  for (const item of result.recommendations) if (!item || !result.tracks.some(track => track.id === item.trackId && track.sceneId === item.sceneId) || typeof item.reason !== 'string') throw invalid();
  for (const item of result.warnings) if (!item || typeof item.code !== 'string' || typeof item.message !== 'string') throw invalid();
  const selectedScenes = new Set<string>();
  for (const selection of envelope.selections) {
    if (!selection || selectedScenes.has(selection.sceneId)) throw invalid();
    try { updateTrackingSelection([], result, selection.sceneId, selection.trackId); } catch { throw invalid(); }
    selectedScenes.add(selection.sceneId);
  }
  return envelope;
}

const endpoint = (projectId: string) => `/api/tracking/projects/${encodeURIComponent(projectId)}`;
export const trackingApi = {
  load: async (projectId: string, signal?: AbortSignal) => trackingEnvelope(await request<unknown>(endpoint(projectId), { signal })),
  analyze: async (projectId: string, file: File, start: number, end: number, signal?: AbortSignal) => {
    const form = new FormData(); form.set('file', file);
    const query = new URLSearchParams({ start: String(start), end: String(end), sampleFps: '2' });
    return trackingEnvelope(await request<unknown>(`${endpoint(projectId)}/analyze?${query}`, { method: 'POST', body: form, signal }, 180000));
  },
  select: async (projectId: string, result: TrackingResult, selections: TrackingSelection[], signal?: AbortSignal) => trackingEnvelope(await request<unknown>(`${endpoint(projectId)}/selection`, {
    method: 'PUT', signal, body: JSON.stringify({ analysisId: result.analysisId, sourceRevision: result.sourceRevision, sourceSha256: result.sourceSha256, selections }),
  })),
};
