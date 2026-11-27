import { HttpError } from './security.js';

export const MAX_TRACKING_BYTES = 1.5 * 1024 * 1024;
export interface TrackingRange { start: number; end: number; sampleFps: number }
export interface TrackingSelection { sceneId: string; trackId: string }
interface Observation { time: number; bbox: [number, number, number, number]; confidence: number }
interface Track {
  id: string; sceneId: string; classId: number; label: string; start: number; end: number; meanConfidence: number;
  observations: Observation[]; gaps: { start: number; end: number }[];
}
export interface TrackingEngineResult {
  schemaVersion: 1; sourceSha256: string;
  source: { duration: number; width: number; height: number }; range: TrackingRange;
  model: { name: string; version: string; sha256: string };
  scenes: { id: string; start: number; end: number }[]; tracks: Track[];
  recommendations: { sceneId: string; trackId: string; reason: string }[];
  warnings: { code: string; message: string; start?: number; end?: number }[];
}
export interface TrackingResult extends TrackingEngineResult { analysisId: string; sourceRevision: string; createdAt: string }

const fail = (): never => { throw new HttpError(502, 'TRACKING_RESPONSE_INVALID', '피사체 분석 결과의 시간·좌표·원본 정보를 확인하지 못했습니다.'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const array = (value: unknown, maximum: number): unknown[] => Array.isArray(value) && value.length <= maximum ? value : fail();
const number = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail();
const text = (value: unknown, maximum: number): string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : fail();
const id = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : fail();
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail();
const same = (first: unknown, second: number) => typeof first === 'number' && Number.isFinite(first) && Math.abs(first - second) <= 0.000001;

export function validateTrackingResult(payload: unknown, duration: number, expected: TrackingRange, fullWindow = false): TrackingEngineResult {
  const value = object(payload);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_TRACKING_BYTES || value.schemaVersion !== 1) fail();
  const sourceValue = object(value.source); const rangeValue = object(value.range); const modelValue = object(value.model);
  const source = { duration: number(sourceValue.duration, 0.001, fullWindow ? 36000 : 3600), width: number(sourceValue.width, 1, fullWindow ? 163840 : 16384), height: number(sourceValue.height, 1, fullWindow ? 163840 : 16384) };
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || Math.abs(source.duration - duration) > 0.5
    || !same(rangeValue.start, expected.start) || !same(rangeValue.end, expected.end) || !same(rangeValue.sampleFps, expected.sampleFps)) fail();
  const sceneIds = new Set<string>(); let previousSceneEnd = expected.start;
  const scenes = array(value.scenes, 240).map(item => {
    const row = object(item); const sceneId = id(row.id);
    const start = number(row.start, expected.start, expected.end); const end = number(row.end, start, expected.end);
    if (sceneIds.has(sceneId) || end <= start || start < previousSceneEnd - 0.000001) fail();
    sceneIds.add(sceneId); previousSceneEnd = end;
    return { id: sceneId, start, end };
  });
  if (!scenes.length) fail();
  const frameCounts = new Map<string, number>(); const trackIds = new Set<string>(); let totalObservations = 0;
  const tracks: Track[] = array(value.tracks, fullWindow ? 1440 : 64).map(item => {
    const row = object(item); const trackId = id(row.id); const sceneId = id(row.sceneId); const scene = scenes.find(item => item.id === sceneId);
    if (!scene || trackIds.has(trackId)) return fail();
    trackIds.add(trackId);
    const start = number(row.start, scene.start, scene.end); const end = number(row.end, start, scene.end);
    const classId = number(row.classId, 0, 79); if (!Number.isInteger(classId)) fail();
    let previousTime = -1;
    const observations: Observation[] = array(row.observations, 240).map(item => {
      const observation = object(item); const time = number(observation.time, start, end);
      if (time <= previousTime) fail(); previousTime = time;
      const bounds = array(observation.bbox, 4); if (bounds.length !== 4) fail();
      const x = number(bounds[0], 0, 1); const y = number(bounds[1], 0, 1);
      const width = number(bounds[2], 0, 1); const height = number(bounds[3], 0, 1);
      if (x >= 1 || y >= 1 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) fail();
      const key = time.toFixed(6); frameCounts.set(key, (frameCounts.get(key) ?? 0) + 1);
      totalObservations++;
      return { time, bbox: [x, y, Math.min(width, 1 - x), Math.min(height, 1 - y)], confidence: number(observation.confidence, 0, 1) };
    });
    if (!observations.length) fail();
    let previousGapEnd = scene.start;
    const gaps = array(row.gaps, 240).map(item => {
      const gap = object(item); const gapStart = number(gap.start, scene.start, scene.end); const gapEnd = number(gap.end, gapStart, scene.end);
      if (gapEnd <= gapStart || gapStart < previousGapEnd - 0.000001) fail(); previousGapEnd = gapEnd;
      if (observations.some(observation => observation.time > gapStart && observation.time < gapEnd)) fail();
      return { start: gapStart, end: gapEnd };
    });
    return { id: trackId, sceneId, classId, label: text(row.label, 100), start, end, meanConfidence: number(row.meanConfidence, 0, 1), observations, gaps };
  });
  if (totalObservations > (fullWindow ? 1440 : 2880) || frameCounts.size > (fullWindow ? 120 : 240) || [...frameCounts.values()].some(count => count > 12)) fail();
  const recommendedScenes = new Set<string>();
  const recommendations = array(value.recommendations, fullWindow ? 120 : 64).map(item => {
    const row = object(item); const sceneId = id(row.sceneId); const trackId = id(row.trackId);
    if (recommendedScenes.has(sceneId) || !tracks.some(track => track.id === trackId && track.sceneId === sceneId)) fail();
    recommendedScenes.add(sceneId);
    return { sceneId, trackId, reason: text(row.reason, 1000) };
  });
  const warnings = array(value.warnings, 256).map(item => {
    const row = object(item);
    const start = row.start === undefined ? undefined : number(row.start, expected.start, expected.end);
    const end = row.end === undefined ? undefined : number(row.end, start ?? expected.start, expected.end);
    return { code: text(row.code, 80), message: text(row.message, 1000), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) };
  });
  return { schemaVersion: 1, sourceSha256: hash(value.sourceSha256), source, range: { ...expected },
    model: { name: text(modelValue.name, 100), version: text(modelValue.version, 100), sha256: hash(modelValue.sha256) }, scenes, tracks, recommendations, warnings };
}
