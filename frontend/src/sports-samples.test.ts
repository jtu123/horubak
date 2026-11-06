import { describe, expect, it } from 'vitest';
import { getProjectCandidates, getProjectEvidence, getProjectTranscript, legacySeedProjects, refreshDefaultSamples, seedProjects } from './data';
import { rangeError } from './lib';
import { getSportsSample } from './sports-samples';
import { addProjectClip, normalizeProject } from './workspace-model';

describe('sports samples', () => {
  it('keeps the bundled footage and matching clip ranges after copying and saving a sample', () => {
    for (const seed of seedProjects()) {
      const copied = { ...seed, id: 'copy-of-' + seed.id, title: '사용자 프로젝트' };
      const candidate = getProjectCandidates(copied)[0];
      const saved = normalizeProject(JSON.parse(JSON.stringify(addProjectClip(copied, 'clip', candidate))))!;
      const match = getSportsSample(saved)!;
      const evidence = getProjectEvidence(saved);
      expect(match).toMatchObject({ id: seed.sportsSampleId, duration: saved.duration });
      expect(saved.edit?.candidateId).toBe(candidate.id);
      expect(getProjectTranscript(saved)).toEqual([]);
      expect(evidence.every(item => item.start >= 0 && item.end > item.start && item.end <= saved.duration)).toBe(true);
      for (const item of getProjectCandidates(saved)) {
        expect(rangeError(item.start, item.end, saved.duration)).toBeUndefined();
        expect(item.evidenceIds.every(id => evidence.some(scene => scene.id === id))).toBe(true);
        if (item.warning) expect(rangeError(item.warning.correctedStart, item.warning.correctedEnd, saved.duration)).toBeUndefined();
      }
      expect(getSportsSample({ ...saved, source: 'file' })).toBeUndefined();
    }
  });

  it('replaces pristine defaults while keeping user edits, existing sports projects and empty lists', () => {
    const [legacyLecture, legacyPodcast] = legacySeedProjects().map(project => normalizeProject(project)!);
    const edited = addProjectClip(legacyLecture, 'kept-clip');
    const existing = { ...seedProjects()[0], title: '보관한 경기 샘플' };
    const refreshed = refreshDefaultSamples([edited, legacyPodcast, existing]);
    expect(refreshed.filter(project => project.sportsSampleId)).toHaveLength(2);
    expect(refreshed).toContain(edited);
    expect(refreshed).toContain(existing);
    expect(refreshed.some(project => project.id === legacyPodcast.id)).toBe(false);
    expect(refreshed.find(project => project.sportsSampleId && project.id !== existing.id)?.updatedAt).toBe(legacyPodcast.updatedAt);
    expect(refreshDefaultSamples(refreshed)).toBe(refreshed);
    expect(refreshDefaultSamples([])).toEqual([]);
  });
});
