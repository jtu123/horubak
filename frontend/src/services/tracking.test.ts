import { describe, expect, it } from 'vitest';
import example from '../../../contracts/tracking-result.example.json';
import { ApiError } from './api';
import { trackingEnvelope } from './tracking';
import { currentObservations } from '../tracking-model';
import type { TrackingResult } from '../tracking-model';

const ready = () => ({ state: 'ready', result: { ...structuredClone(example), analysisId: 'analysis-1', sourceRevision: 'revision-1', createdAt: '2026-11-27T00:00:00Z' } as unknown as TrackingResult, selections: [] });

describe('tracking API response boundary', () => {
  it('accepts the shared engine contract wrapped by the authenticated project API', () => {
    const response = ready();
    expect(trackingEnvelope(response).result?.tracks[0].id).toBe('s0-t1');
    expect(trackingEnvelope({ state: 'stale', result: null, selections: [] }).state).toBe('stale');
    expect(trackingEnvelope({ state: 'missing', result: null, selections: [] }).result).toBeNull();
  });
  it('accepts the engine trailing lost gap after the last observation until the scene ends', () => {
    const response = ready();
    response.result.tracks[0].gaps = [{ start: 6.25, end: 7 }];
    const parsed = trackingEnvelope(response).result!;
    expect(parsed.tracks[0].end).toBe(6);
    expect(parsed.tracks[0].gaps).toEqual([{ start: 6.25, end: 7 }]);
    expect(currentObservations(parsed, 6.5)).toEqual([]);
  });
  it('rejects lost gaps outside the track scene', () => {
    const response = ready();
    response.result.tracks[0].gaps = [{ start: 6.25, end: 7.5 }];
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('rejects off-screen boxes before drawing them on the video', () => {
    const response = ready(); response.result.tracks[0].observations[0].bbox = [.9, 0, .5, .5];
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('rejects a box assigned to a different scene time', () => {
    const response = ready();
    response.result.scenes = [{ id: 's0', start: 5, end: 6 }, { id: 's1', start: 6, end: 7 }];
    response.result.tracks[0].observations[2].time = 6.5;
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('keeps recommendation references within the track scene', () => {
    const response = ready();
    response.result.scenes = [{ id: 's0', start: 5, end: 6.5 }, { id: 's1', start: 6.5, end: 7 }];
    response.result.recommendations[0].sceneId = 's1';
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('rejects invalid nested data as an API error instead of leaking a rendering failure', () => {
    const response = ready();
    const malformed = JSON.parse(JSON.stringify(response)); malformed.result.tracks[0].observations[0] = null;
    expect(() => trackingEnvelope(malformed)).toThrow(ApiError);
  });
  it('rejects more observations than the result contract permits', () => {
    const response = ready();
    response.result.tracks[0].observations = Array.from({ length: 2881 }, () => ({ time: 5, bbox: [.1, .1, .2, .5], confidence: .9 }));
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('rejects saved selections that do not reference an existing scene track', () => {
    const response = { ...ready(), selections: [{ sceneId: 's0', trackId: 'missing-track' }] };
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
  it('requires model provenance with a fingerprint', () => {
    const response = ready(); response.result.model.sha256 = '';
    expect(() => trackingEnvelope(response)).toThrow(ApiError);
  });
});
