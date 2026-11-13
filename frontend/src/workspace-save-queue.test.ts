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

  it('merges a registered upload into the saved snapshot with the next workspace version', async () => {
    const upload = normalizeProject({ id: 'upload', title: 'Uploaded source', source: 'file', sourceUploaded: true })!;
    const save = vi.fn().mockResolvedValueOnce({ version: 5 }).mockResolvedValueOnce({ version: 7 });
    const register = vi.fn().mockResolvedValueOnce({ project: upload, version: 6 });
    const queue = createWorkspaceSaveQueue(initial, save);

    await queue.enqueue(edited);
    const registered = await queue.registerFile(edited, upload.id, register);
    expect(register).toHaveBeenCalledWith(5, 'owner-a');
    expect(registered).toEqual({ project: upload, projects: [upload, ...edited] });
    expect(queue.needsSave(registered.projects)).toBe(false);

    await queue.enqueue([upload, ...original]);
    expect(save).toHaveBeenLastCalledWith([upload, ...original], 6, 'owner-a');
  });

  it('blocks autosave when an upload outcome could already have changed the server', async () => {
    const error = new ApiError(0, 'UNREACHABLE', 'Upload outcome unknown');
    const register = vi.fn().mockRejectedValueOnce(error);
    const save = vi.fn();
    const queue = createWorkspaceSaveQueue(initial, save);

    await expect(queue.registerFile(original, 'upload', register)).rejects.toBe(error);
    expect(queue.isBlocked()).toBe(true);
    await expect(queue.enqueue(edited)).rejects.toBe(error);
    expect(save).not.toHaveBeenCalled();
  });
});
