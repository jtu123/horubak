import type { Candidate } from './types';

export type CandidateKind = 'all' | 'speech' | 'scene' | 'sound';
export type CandidateLength = 'all' | 'short' | 'long';
export type CandidateSort = 'original' | 'start' | 'duration';
export interface CandidateFilters { query: string; kind: CandidateKind; length: CandidateLength; sort: CandidateSort }
export const DEFAULT_CANDIDATE_FILTERS: CandidateFilters = { query: '', kind: 'all', length: 'all', sort: 'original' };

export function exploreCandidates(candidates: Candidate[], filters: CandidateFilters): Candidate[] {
  const query = filters.query.trim().normalize('NFKC').toLocaleLowerCase('ko-KR');
  const result = candidates.filter(candidate => {
    const duration = candidate.end - candidate.start;
    return (!query || [candidate.title, candidate.summary, candidate.reason].some(text => text.normalize('NFKC').toLocaleLowerCase('ko-KR').includes(query)))
      && (filters.kind === 'all' || (candidate.evidenceKind ?? 'speech') === filters.kind)
      && (filters.length === 'all' || (filters.length === 'short' ? duration <= 45 : duration > 45));
  });
  if (filters.sort === 'start') result.sort((a, b) => a.start - b.start);
  if (filters.sort === 'duration') result.sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return result;
}

/** Restrict a batch to visible candidates; repeated selections and saved candidates never create duplicates. */
export function planCandidateAdoption(visible: Candidate[], selectedIds: string[], existingIds: string[]) {
  const selected = new Set(selectedIds);
  const saved = new Set(existingIds);
  const seen = new Set<string>();
  const candidates = visible.filter(candidate => {
    if (!selected.has(candidate.id) || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
  return { selected: candidates.length, newCandidates: candidates.filter(candidate => !saved.has(candidate.id)), existing: candidates.filter(candidate => saved.has(candidate.id)).length };
}
