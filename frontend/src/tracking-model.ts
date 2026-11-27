export interface TrackingObservation { time: number; bbox: [number, number, number, number]; confidence: number }
export interface TrackingTrack {
  id: string; sceneId: string; classId: number; label: string; start: number; end: number; meanConfidence: number;
  observations: TrackingObservation[]; gaps: { start: number; end: number }[];
}
export interface TrackingResult {
  schemaVersion: 1; analysisId: string; sourceRevision: string; createdAt: string; sourceSha256: string;
  source: { duration: number; width: number; height: number };
  range: { start: number; end: number; sampleFps: number };
  model: { name: string; version: string; sha256: string };
  scenes: { id: string; start: number; end: number }[];
  tracks: TrackingTrack[];
  recommendations: { sceneId: string; trackId: string; reason: string }[];
  warnings: { code: string; message: string; start?: number; end?: number }[];
}
export interface TrackingSelection { sceneId: string; trackId: string }
export interface TrackingEnvelope { state: 'missing' | 'ready' | 'stale'; result: TrackingResult | null; selections: TrackingSelection[] }

export function trackingRangeError(start: number, end: number, duration: number, fps = 2): string | null {
  if (![start, end, duration, fps].every(Number.isFinite) || start < 0 || end <= start || end > duration) return '원본 길이 안에서 시작과 종료를 지정해 주세요.';
  if (end - start > 120) return '한 번에 최대 120초를 분석할 수 있어요.';
  if (fps < 1 || fps > 4 || Math.ceil((end - start) * fps) > 240) return '최대 240프레임 이내로 구간이나 분석 빈도를 줄여 주세요.';
  return null;
}

export function sameTrackingSource(result: TrackingResult, sha256?: string): boolean {
  return !!sha256 && /^[a-f0-9]{64}$/i.test(sha256) && sha256.toLowerCase() === result.sourceSha256.toLowerCase();
}

export function containTrackingBox(bbox: TrackingObservation['bbox'], videoWidth: number, videoHeight: number, width: number, height: number) {
  const [x, y, w, h] = bbox;
  if (![x, y, w, h, videoWidth, videoHeight, width, height].every(Number.isFinite)
    || Math.min(videoWidth, videoHeight, width, height, w, h) <= 0 || x < 0 || y < 0 || x + w > 1.000001 || y + h > 1.000001) return null;
  const scale = Math.min(width / videoWidth, height / videoHeight);
  return { left: (width - videoWidth * scale) / 2 + x * videoWidth * scale,
    top: (height - videoHeight * scale) / 2 + y * videoHeight * scale,
    width: w * videoWidth * scale, height: h * videoHeight * scale };
}

export function currentObservations(result: TrackingResult, time: number) {
  if (!Number.isFinite(time) || time < result.range.start || time >= result.range.end) return [];
  const scene = result.scenes.find(item => time >= item.start && time < item.end);
  if (!scene) return [];
  const tolerance = .5 / result.range.sampleFps + .000001;
  return result.tracks.flatMap(track => {
    if (track.sceneId !== scene.id || track.gaps.some(gap => time > gap.start && time < gap.end)) return [];
    let nearest: TrackingObservation | undefined;
    for (const observation of track.observations) {
      if (!nearest || Math.abs(time - observation.time) < Math.abs(time - nearest.time)) nearest = observation;
    }
    return nearest && Math.abs(time - nearest.time) <= tolerance ? [{ track, observation: nearest }] : [];
  });
}

export function updateTrackingSelection(current: TrackingSelection[], result: TrackingResult, sceneId: string, trackId: string | null): TrackingSelection[] {
  if (!result.scenes.some(scene => scene.id === sceneId) || trackId !== null && !result.tracks.some(track => track.sceneId === sceneId && track.id === trackId)) {
    throw new Error('현재 분석 결과에 있는 대상만 선택할 수 있어요.');
  }
  return [...current.filter(selection => selection.sceneId !== sceneId), ...(trackId ? [{ sceneId, trackId }] : [])];
}
