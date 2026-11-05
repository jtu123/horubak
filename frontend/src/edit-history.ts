import type { EditState } from './types';

export interface EditHistory { past: EditState[]; future: EditState[] }
export type EditHistories = Record<string, EditHistory>;
export const EMPTY_EDIT_HISTORY: EditHistory = { past: [], future: [] };
const LIMIT = 20;

export function rememberEdit(histories: EditHistories, key: string, current: EditState): EditHistories {
  const history = histories[key] ?? EMPTY_EDIT_HISTORY;
  return { ...histories, [key]: { past: [...history.past.slice(-(LIMIT - 1)), { ...current }], future: [] } };
}

export function stepEditHistory(histories: EditHistories, key: string, current: EditState, direction: 'undo' | 'redo') {
  const history = histories[key] ?? EMPTY_EDIT_HISTORY;
  const source = direction === 'undo' ? history.past : history.future;
  const edit = source.at(-1);
  if (!edit) return { histories, edit: undefined };
  const next: EditHistory = direction === 'undo'
    ? { past: history.past.slice(0, -1), future: [...history.future.slice(-(LIMIT - 1)), { ...current }] }
    : { past: [...history.past.slice(-(LIMIT - 1)), { ...current }], future: history.future.slice(0, -1) };
  return { histories: { ...histories, [key]: next }, edit: { ...edit } };
}
