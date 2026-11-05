import { describe, expect, it } from 'vitest';
import { CANDIDATES, createVisualSample, getProjectCandidates, getProjectEvidence, getProjectTranscript } from './data';
import { addProjectClip, getActiveClip, getProjectClips, loadProjectCollection, normalizeProject, patchProject, selectProjectClip, updateProjectClip } from './workspace-model';
import type { ProjectStorage } from './workspace-model';
import type { Project } from './types';

const legacy: Project = {
  id: 'saved-source', title: '내가 편집한 영상', genre: 'lecture', status: 'completed',
  duration: 120, source: 'file', sourceName: 'original.mov', sourceUrl: 'https://example.com/original.mov',
  favorite: true, progress: 100, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
  edit: { candidateId: 'manual', start: 12, end: 58, subtitle: '저장한 문구', subtitleSize: 32, subtitleColor: '#ffffff', subtitleVisible: false, cropX: 23, cropY: 72, scale: 1.4, contextApplied: true, layout: 'speaker' },
};
const KEY = 'moment.projects.owner.v1';
class MemoryStorage implements ProjectStorage {
  values = new Map<string, string>();
  denyWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.denyWrites) throw new Error('quota'); this.values.set(key, value); }
}

describe('v3 saved-project compatibility', () => {
  it('moves the existing edit into a deterministic clip without changing user edits or status semantics', () => {
    const project = normalizeProject(legacy)!;
    expect(project.clips).toHaveLength(1);
    expect(project.activeClipId).toBe('legacy-saved-source');
    expect(project.edit).toEqual(legacy.edit);
    expect(project.clips![0].edit).toEqual(legacy.edit);
    expect(project.sourceUrl).toBe(legacy.sourceUrl);
    expect(project.favorite).toBe(true);
    expect(project.status).toBe('completed');
    expect(normalizeProject(project)).toEqual(project);
  });

  it('preserves an unknown content label and custom metadata rather than replacing the project with samples', () => {
    const project = normalizeProject({ ...legacy, genre: 'sports', notes: '내 메모' })!;
    expect(project.genre).toBe('general');
    expect(project.legacyGenre).toBe('sports');
    expect(project).toMatchObject({ id: legacy.id, notes: '내 메모', edit: legacy.edit });
    expect(normalizeProject(project)).toEqual(project);
  });

  it('backs up the complete raw collection before recovering records individually', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([{ ...legacy, genre: 'sports' }, { title: 'missing identifier' }]);
    storage.setItem(KEY, raw);
    const loaded = loadProjectCollection(storage, KEY, () => [createVisualSample()]);
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.projects[0].id).toBe(legacy.id);
    expect(loaded.notice).toBeTruthy();
    expect(storage.getItem(KEY)).toBe(raw);
    expect(storage.getItem(loaded.backupKey!)).toBe(raw);
  });

  it('keeps migration idempotent across persistence and does not create a second legacy clip or backup', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([legacy]);
    storage.setItem(KEY, raw);
    const initial = loadProjectCollection(storage, KEY, () => []);
    expect(initial.writeAllowed).toBe(true);
    storage.setItem(KEY, JSON.stringify(initial.projects));
    const second = loadProjectCollection(storage, KEY, () => []);
    expect(second.projects).toEqual(initial.projects);
    expect(second.projects[0].clips).toHaveLength(1);
    expect(storage.values.size).toBe(2);
    expect(storage.getItem(KEY + '.backup.v3')).toBe(raw);
  });

  it('blocks automatic persistence if the original cannot be backed up', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([legacy]);
    storage.setItem(KEY, raw);
    storage.denyWrites = true;
    const loaded = loadProjectCollection(storage, KEY, () => []);
    expect(loaded.projects[0].id).toBe(legacy.id);
    expect(loaded.writeAllowed).toBe(false);
    expect(storage.getItem(KEY)).toBe(raw);
  });

  it('never replaces malformed or entirely invalid saved data with successful sample projects', () => {
    for (const raw of ['{broken', '{"unexpected":true}', '[{"title":"invalid"}]']) {
      const storage = new MemoryStorage();
      storage.setItem(KEY, raw);
      const loaded = loadProjectCollection(storage, KEY, () => [createVisualSample()]);
      expect(loaded.projects).toEqual([]);
      expect(loaded.writeAllowed).toBe(false);
      expect(storage.getItem(KEY)).toBe(raw);
      expect(storage.getItem(loaded.backupKey!)).toBe(raw);
    }
  });

  it('keeps an intentionally empty project list empty', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, '[]');
    expect(loadProjectCollection(storage, KEY, () => [createVisualSample()]).projects).toEqual([]);
    expect(storage.values.size).toBe(1);
  });
});

describe('independent clips and the legacy active-edit mirror', () => {
  it('edits and selects multiple clips without overwriting another clip', () => {
    const first = addProjectClip(createVisualSample(), 'one', CANDIDATES.general[0], '2026-11-05T01:00:00Z');
    const second = addProjectClip(first, 'two', CANDIDATES.general[1], '2026-11-05T02:00:00Z');
    const modified = updateProjectClip(second, 'two', { subtitle: '두 번째만 변경', cropX: 12 });
    expect(getProjectClips(modified)[0]).toEqual(first.clips![0]);
    expect(getActiveClip(modified)?.id).toBe('two');
    expect(modified.edit?.subtitle).toBe('두 번째만 변경');
    const selected = selectProjectClip(modified, 'one');
    expect(selected.edit).toEqual(first.edit);
    expect(selected.clips![1].edit.subtitle).toBe('두 번째만 변경');
  });

  it('keeps existing project.edit consumers synchronized with the active clip only', () => {
    const first = addProjectClip(createVisualSample(), 'one', CANDIDATES.general[0]);
    const second = addProjectClip(first, 'two', CANDIDATES.general[1]);
    const modified = patchProject(second, { edit: { ...second.edit!, start: 75, contextApplied: true } });
    expect(modified.edit?.start).toBe(75);
    expect(modified.clips![1].edit.contextApplied).toBe(true);
    expect(modified.clips![0].edit).toEqual(first.edit);
  });

  it('does not resurrect a deleted last clip from the old edit mirror', () => {
    const original = normalizeProject(legacy)!;
    const removed = normalizeProject({ ...original, clips: [] })!;
    expect(getProjectClips(removed)).toEqual([]);
    expect(removed.activeClipId).toBeUndefined();
    expect(removed.edit).toBeUndefined();
  });

  it('does not switch to a nonexistent clip', () => {
    const original = normalizeProject(legacy)!;
    expect(selectProjectClip(original, 'not-found')).toBe(original);
  });
});

describe('multimodal sample boundaries', () => {
  it('uses scene and sound evidence for visual samples and never manufactures speech', () => {
    const sample = createVisualSample();
    expect(getProjectTranscript(sample)).toEqual([]);
    expect(getProjectEvidence(sample)).toHaveLength(3);
    for (const candidate of getProjectCandidates(sample)) {
      for (const id of candidate.evidenceIds) {
        expect(getProjectEvidence(sample).some(evidence => evidence.id === id && evidence.kind === candidate.evidenceKind)).toBe(true);
      }
    }
  });

  it.each(['file', 'url'] as const)('never injects sample analysis into a real %s project', source => {
    const project = { ...createVisualSample(), source };
    expect(getProjectCandidates(project)).toEqual([]);
    expect(getProjectTranscript(project)).toEqual([]);
    expect(getProjectEvidence(project)).toEqual([]);
  });
});

