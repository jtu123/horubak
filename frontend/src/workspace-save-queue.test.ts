import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './services/api';
import { createWorkspaceSaveQueue } from './store';
import { normalizeProject } from './workspace-model';

const original = [normalizeProject({ id: 'project', title: 'Original' })!];
const edited = [{ ...original[0], title: 'Edited' }];
const initial = { ownerId: 'owner-a', projects: original, version: 4 };

function pendingSave() {
  let resolve!: (result: { version: number }) => void;
  const promise = new Promise<{ version: number }>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('workspace save queue', () => {
  it('queues the revert of an in-flight edit against the new version', async () => {
    const first = pendingSave();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ version: 6 });
    const queue = createWorkspaceSaveQueue(initial, save);

    expect(queue.needsSave(original)).toBe(false);
    const edit = queue.enqueue(edited);
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(edited, 4, 'owner-a');
    expect(queue.needsSave(original)).toBe(true);
    const revert = queue.enqueue(original);
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve({ version: 5 });
    await Promise.all([edit, revert]);
    expect(save).toHaveBeenLastCalledWith(original, 5, 'owner-a');
    expect(queue.needsSave(original)).toBe(false);
  });

  it('keeps queued edits blocked after a conflict and skips them after closing the session', async () => {
    const error = new ApiError(409, 'WORKSPACE_ACCOUNT_CHANGED', 'Account changed');
    const save = vi.fn().mockRejectedValueOnce(error);
    const queue = createWorkspaceSaveQueue(initial, save);

    const results = await Promise.allSettled([queue.enqueue(edited), queue.enqueue(original)]);
    expect(results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
    expect(queue.isBlocked()).toBe(true);
    expect(queue.needsSave(original)).toBe(true);
    queue.close();
    await expect(queue.enqueue(edited)).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips queued requests from a closed session even if an in-flight request completes', async () => {
    const first = pendingSave();
    const save = vi.fn().mockReturnValueOnce(first.promise);
    const queue = createWorkspaceSaveQueue(initial, save);
    const edit = queue.enqueue(edited);
    const revert = queue.enqueue(original);
    await Promise.resolve();
    queue.close();
    first.resolve({ version: 5 });

    await expect(Promise.all([edit, revert])).resolves.toEqual([false, false]);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
