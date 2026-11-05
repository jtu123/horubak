import { describe, expect, it } from 'vitest';
import { CANDIDATES } from './data';
import { DEFAULT_CANDIDATE_FILTERS, exploreCandidates, planCandidateAdoption } from './candidate-explorer';

describe('candidate discovery and batch adoption', () => {
  const speech = CANDIDATES.lecture;
  const mixed = [...speech, ...CANDIDATES.general];
  it('searches title, summary and reason without changing source order or content', () => {
    expect(exploreCandidates(speech, { ...DEFAULT_CANDIDATE_FILTERS, query: '  조건  ' }).map(c => c.id)).toEqual(['lecture-2']);
    expect(exploreCandidates(speech, { ...DEFAULT_CANDIDATE_FILTERS, query: '일상의 사례' }).map(c => c.id)).toEqual(['lecture-1']);
    expect(exploreCandidates(speech, { ...DEFAULT_CANDIDATE_FILTERS, query: '없는 검색어' })).toEqual([]);
    expect(exploreCandidates(speech, DEFAULT_CANDIDATE_FILTERS)).toEqual(speech);
  });
  it('recognizes legacy speech evidence and combines type and duration filters', () => {
    expect(exploreCandidates(mixed, { ...DEFAULT_CANDIDATE_FILTERS, kind: 'speech', length: 'short' }).map(c => c.id)).toEqual(['lecture-2']);
    expect(exploreCandidates(mixed, { ...DEFAULT_CANDIDATE_FILTERS, kind: 'scene', length: 'long' })).toEqual([]);
    expect(exploreCandidates(mixed, { ...DEFAULT_CANDIDATE_FILTERS, kind: 'sound', length: 'long' }).map(c => c.id)).toEqual(['visual-3']);
  });
  it('includes exactly 45 seconds in the shorter group', () => {
    const boundary = [{ ...speech[0], start: 0, end: 45 }];
    expect(exploreCandidates(boundary, { ...DEFAULT_CANDIDATE_FILTERS, length: 'short' })).toHaveLength(1);
    expect(exploreCandidates(boundary, { ...DEFAULT_CANDIDATE_FILTERS, length: 'long' })).toHaveLength(0);
  });
  it('sorts by original time or ascending duration without mutating source arrays', () => {
    const source = [speech[2], speech[0], speech[1]];
    expect(exploreCandidates(source, { ...DEFAULT_CANDIDATE_FILTERS, sort: 'start' }).map(c => c.id)).toEqual(['lecture-1', 'lecture-2', 'lecture-3']);
    expect(exploreCandidates(source, { ...DEFAULT_CANDIDATE_FILTERS, sort: 'duration' }).map(c => c.id)).toEqual(['lecture-2', 'lecture-1', 'lecture-3']);
    expect(source[0].id).toBe('lecture-3');
  });
  it('counts selected and new clips separately and ignores hidden or unknown IDs', () => {
    const plan = planCandidateAdoption(speech.slice(0, 2), ['lecture-1', 'lecture-2', 'lecture-3', 'missing'], ['lecture-1']);
    expect(plan.selected).toBe(2);
    expect(plan.existing).toBe(1);
    expect(plan.newCandidates.map(c => c.id)).toEqual(['lecture-2']);
  });
  it('does not create duplicates on repeated selections or re-adoption', () => {
    const first = planCandidateAdoption([...speech, speech[0]], ['lecture-1', 'lecture-1', 'lecture-2'], []);
    expect(first.newCandidates.map(c => c.id)).toEqual(['lecture-1', 'lecture-2']);
    const second = planCandidateAdoption(speech, ['lecture-1', 'lecture-2'], first.newCandidates.map(c => c.id));
    expect(second.newCandidates).toEqual([]);
    expect(second.existing).toBe(2);
  });
});
