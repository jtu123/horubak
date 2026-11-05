import { describe, expect, it } from 'vitest';
import { buildSrt, formatTime, rangeError, validateSourceUrl, validateVideo } from './lib';
import { CANDIDATES, SCENE_EVIDENCE, makeTranscript } from './data';
import type { Genre } from './types';

describe('input boundaries', () => {
  it('rejects empty, unsupported and oversized source files', () => {
    expect(validateVideo({ name: 'lecture.MP4', size: 2000 })).toBeUndefined();
    expect(validateVideo({ name: 'lecture.exe', size: 2000 })).toBeTruthy();
    expect(validateVideo({ name: 'lecture.mp4', size: 0 })).toBeTruthy();
    expect(validateVideo({ name: 'lecture.mov', size: 4 * 1024 ** 3 + 1 })).toBeTruthy();
  });
  it('accepts HTTPS but does not treat arbitrary strings or embedded credentials as media URLs', () => {
    expect(validateSourceUrl('https://example.com/video.mp4')).toBeUndefined();
    for (const url of ['javascript:alert(1)', 'http://example.com', 'not a url', 'https://user:secret@example.com/video']) expect(validateSourceUrl(url)).toBeTruthy();
  });
  it('enforces original-video bounds and the 30–60 second output range', () => {
    expect(rangeError(10, 40, 100)).toBeUndefined();
    expect(rangeError(10, 70, 100)).toBeUndefined();
    for (const [a, b, duration] of [[-1, 40, 100], [10, 100, 80], [20, 10, 100], [10, 39, 100], [10, 71, 100], [NaN, 50, 100]]) expect(rangeError(a, b, duration)).toBeTruthy();
  });
});
describe('time and subtitle export', () => {
  it('formats minutes and hour boundaries without wrapping the hour', () => {
    expect(formatTime(59.9)).toBe('0:59'); expect(formatTime(3601)).toBe('1:00:01'); expect(formatTime(-2)).toBe('0:00');
  });
  it('converts source time to clip time and clips overlapping utterances at both ends', () => {
    const srt = buildSrt([{ id: 'a', start: 5, end: 12, text: '앞 경계', speaker: 'A' }, { id: 'b', start: 12, end: 22, text: '뒤 경계', speaker: 'B' }, { id: 'c', start: 25, end: 30, text: '범위 밖', speaker: 'A' }], { start: 10, end: 20 });
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('00:00:02,000 --> 00:00:10,000');
    expect(srt).not.toContain('범위 밖'); expect(srt).not.toContain('-00');
  });
});
describe('shared fixture contract', () => {
  for (const genre of Object.keys(CANDIDATES) as Genre[]) it(`${genre} sample evidence and corrections refer to valid source ranges`, () => {
    const transcript = makeTranscript(genre);
    for (const candidate of CANDIDATES[genre]) {
      expect(rangeError(candidate.start, candidate.end, 3600)).toBeUndefined();
      for (const id of candidate.evidenceIds) {
        if (candidate.evidenceKind === 'scene' || candidate.evidenceKind === 'sound') {
          const evidence = SCENE_EVIDENCE.find(item => item.id === id);
          expect(evidence?.kind).toBe(candidate.evidenceKind);
          expect(evidence!.start).toBeLessThanOrEqual(candidate.start);
          expect(evidence!.end).toBeGreaterThanOrEqual(candidate.end);
        } else expect(transcript.some(u => u.id === id)).toBe(true);
      }
      if (candidate.warning) {
        expect(rangeError(candidate.warning.correctedStart, candidate.warning.correctedEnd, 3600)).toBeUndefined();
        expect(candidate.warning.correctedStart).toBeLessThan(candidate.start);
      }
    }
  });
});
