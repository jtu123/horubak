import { describe, expect, it } from 'vitest';
import { containTrackingBox, currentObservations, sameTrackingSource, trackingRangeError, updateTrackingSelection } from './tracking-model';
import type { TrackingResult } from './tracking-model';

const result: TrackingResult = {
  schemaVersion: 1, analysisId: 'analysis-1', sourceRevision: 'revision-1', createdAt: '2026-11-27T00:00:00Z', sourceSha256: 'a'.repeat(64),
  source: { duration: 10, width: 1920, height: 1080 }, range: { start: 0, end: 10, sampleFps: 2 },
  model: { name: 'nanodet', version: '2022nov', sha256: 'b'.repeat(64) },
  scenes: [{ id: 's0', start: 0, end: 5 }, { id: 's1', start: 5, end: 10 }],
  tracks: [
    { id: 't0', sceneId: 's0', classId: 0, label: 'person', start: 0, end: 4.5, meanConfidence: .9,
      observations: [{ time: 0, bbox: [.1, .2, .3, .4], confidence: .9 }, { time: 1, bbox: [.2, .2, .3, .4], confidence: .9 }, { time: 2, bbox: [.3, .2, .3, .4], confidence: .9 }, { time: 4.5, bbox: [.4, .2, .3, .4], confidence: .9 }], gaps: [{ start: 1, end: 2 }] },
    { id: 't1', sceneId: 's1', classId: 0, label: 'person', start: 5, end: 9.5, meanConfidence: .8,
      observations: [{ time: 5, bbox: [.1, .2, .3, .4], confidence: .8 }], gaps: [] },
  ], recommendations: [], warnings: [],
};

describe('tracking review safeguards', () => {
  it('maps normalized boxes into the actual contain video area including letterboxing', () => {
    expect(containTrackingBox([0, 0, 1, 1], 1920, 1080, 400, 400)).toEqual({ left: 0, top: 87.5, width: 400, height: 225 });
    expect(containTrackingBox([0, 0, 1, 1], 1080, 1920, 400, 400)).toEqual({ left: 87.5, top: 0, width: 225, height: 400 });
    expect(containTrackingBox([.9, 0, .3, 1], 1920, 1080, 400, 400)).toBeNull();
  });
  it('shows only a nearby observed box and never bridges missing observations or a scene cut', () => {
    expect(currentObservations(result, .1).map(item => item.track.id)).toEqual(['t0']);
    expect(currentObservations(result, .5)).toEqual([]);
    expect(currentObservations(result, 1.2)).toEqual([]);
    expect(currentObservations(result, 5).map(item => item.track.id)).toEqual(['t1']);
    expect(currentObservations(result, 10)).toEqual([]);
  });
  it('does not accept a name match or an absent file fingerprint as identity', () => {
    expect(sameTrackingSource(result, undefined)).toBe(false);
    expect(sameTrackingSource(result, 'b'.repeat(64))).toBe(false);
    expect(sameTrackingSource(result, 'a'.repeat(64))).toBe(true);
  });
  it('allows one existing track per scene without inventing a track reference', () => {
    expect(updateTrackingSelection([], result, 's0', 't0')).toEqual([{ sceneId: 's0', trackId: 't0' }]);
    expect(() => updateTrackingSelection([], result, 's0', 't1')).toThrow();
    expect(updateTrackingSelection([{ sceneId: 's0', trackId: 't0' }], result, 's0', null)).toEqual([]);
  });
  it('bounds work by source duration, range duration and frame count', () => {
    expect(trackingRangeError(0, 60, 200, 4)).toBeNull();
    expect(trackingRangeError(0, 120, 200, 4)).toBeTruthy();
    expect(trackingRangeError(0, 121, 200, 2)).toBeTruthy();
    expect(trackingRangeError(0, 60, 30, 2)).toBeTruthy();
    expect(trackingRangeError(Number.NaN, 60, 200, 2)).toBeTruthy();
  });
});
