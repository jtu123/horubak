import { describe, expect, it } from 'vitest';
import { initialEdit } from './data';
import { rememberEdit, stepEditHistory } from './edit-history';
import type { EditHistories } from './edit-history';

describe('clip edit history', () => {
  it('undoes and redoes the full edit including optional output settings', () => {
    const original = initialEdit('lecture');
    const edited = { ...original, subtitle: '변경', aspectRatio: '1:1' as const, showSafeArea: true };
    const history = rememberEdit({}, 'p:c', original);
    const undo = stepEditHistory(history, 'p:c', edited, 'undo');
    expect(undo.edit).toEqual(original);
    const redo = stepEditHistory(undo.histories, 'p:c', original, 'redo');
    expect(redo.edit).toEqual(edited);
    expect(redo.histories['p:c'].future).toEqual([]);
  });

  it('drops the redo branch after a new edit', () => {
    const original = initialEdit('lecture');
    const edited = { ...original, subtitle: '첫 편집' };
    const undo = stepEditHistory(rememberEdit({}, 'p:c', original), 'p:c', edited, 'undo');
    const branch = rememberEdit(undo.histories, 'p:c', original);
    expect(stepEditHistory(branch, 'p:c', { ...original, subtitle: '다른 편집' }, 'redo').edit).toBeUndefined();
  });

  it('isolates projects and clips', () => {
    const original = initialEdit('lecture');
    const first = rememberEdit({}, 'p1:c1', original);
    const both = rememberEdit(first, 'p1:c2', { ...original, start: 10 });
    const next = stepEditHistory(both, 'p1:c2', { ...original, start: 20 }, 'undo');
    expect(next.edit?.start).toBe(10);
    expect(next.histories['p1:c1']).toEqual(first['p1:c1']);
    expect(stepEditHistory(both, 'p2:c1', original, 'undo').edit).toBeUndefined();
  });

  it('limits snapshots to twenty and never mutates supplied state', () => {
    const original = initialEdit('lecture');
    let history: EditHistories = {};
    for (let n = 0; n < 30; n++) history = rememberEdit(history, 'p:c', { ...original, start: n });
    expect(history['p:c'].past).toHaveLength(20);
    expect(history['p:c'].past[0].start).toBe(10);
    const copy = JSON.stringify(history);
    const next = stepEditHistory(history, 'p:c', { ...original, start: 30 }, 'undo');
    expect(next.edit?.start).toBe(29);
    expect(JSON.stringify(history)).toBe(copy);
    expect(stepEditHistory({}, 'p:c', original, 'redo').edit).toBeUndefined();
  });
});
