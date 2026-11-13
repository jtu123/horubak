import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clipPlaybackStart, readVideoDuration } from './video-metadata';

function fakeVideo() {
  return {
    duration: 45,
    src: '',
    onloadedmetadata: null as (() => void) | null,
    onerror: null as (() => void) | null,
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
}

describe('local source metadata', () => {
  let video: ReturnType<typeof fakeVideo>;
  const file = new File(['video'], 'source.mp4');

  beforeEach(() => {
    vi.useFakeTimers();
    video = fakeVideo();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { createElement: () => video });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the finite source duration and releases the temporary object URL', async () => {
    const result = readVideoDuration(file, new AbortController().signal);
    expect(video.src).toBe('blob:source');
    video.onloadedmetadata?.();

    await expect(result).resolves.toBe(45);
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out and cleans up an unreadable source', async () => {
    const result = expect(readVideoDuration(file, new AbortController().signal)).rejects.toThrow('시간이 초과');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;

    expect(video.onloadedmetadata).toBeNull();
    expect(video.onerror).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('reports a decode error and releases the temporary source', async () => {
    const result = readVideoDuration(file, new AbortController().signal);
    video.onerror?.();

    await expect(result).rejects.toThrow('영상을 읽을 수 없어요');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an older selection without affecting the next probe', async () => {
    const oldSelection = new AbortController();
    const first = expect(readVideoDuration(file, oldSelection.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const oldVideo = video;
    oldSelection.abort();
    video = fakeVideo();
    const second = readVideoDuration(file, new AbortController().signal);
    video.onloadedmetadata?.();

    await first;
    await expect(second).resolves.toBe(45);
    expect(oldVideo.onloadedmetadata).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each([0, Infinity, 7 * 86_400 + 1])('rejects invalid source duration %s', async duration => {
    video.duration = duration;
    const result = readVideoDuration(file, new AbortController().signal);
    video.onloadedmetadata?.();

    await expect(result).rejects.toThrow();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});

describe('clip playback position', () => {
  it('returns to the clip start only when the playhead is outside the interval', () => {
    const edit = { start: 10, end: 40 };
    expect([0, 10, 25, 40, 45, NaN].map(time => clipPlaybackStart(time, edit))).toEqual([10, 10, 25, 10, 10, 10]);
  });
});
