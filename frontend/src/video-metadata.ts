import { useLayoutEffect, useRef } from 'react';
import type { EditState } from './types';

const METADATA_TIMEOUT_MS = 10_000;
const MAX_VIDEO_SECONDS = 7 * 86_400;

export function readVideoDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => fail(new Error('영상 길이를 확인하는 시간이 초과됐어요. 다시 시도해 주세요.')), METADATA_TIMEOUT_MS);
    const abort = () => fail(signal.reason);

    function cleanUp() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }

    function fail(error: unknown) {
      cleanUp();
      reject(error);
    }

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        fail(new Error('영상 길이를 확인할 수 없어요. 다른 MP4 또는 MOV 파일을 선택해 주세요.'));
        return;
      }
      if (duration > MAX_VIDEO_SECONDS) {
        fail(new Error('원본 영상의 길이는 최대 7일이에요.'));
        return;
      }
      cleanUp();
      resolve(duration);
    };
    video.onerror = () => fail(new Error('영상을 읽을 수 없어요. H.264/AAC MP4 파일로 다시 시도해 주세요.'));
    signal.addEventListener('abort', abort, { once: true });
    video.src = objectUrl;
  });
}

export function useVideoProbe(projectId?: string) {
  const current = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => current.current?.abort(), [projectId]);

  const cancel = () => {
    current.current?.abort();
    current.current = null;
  };

  return {
    cancel,
    start() {
      cancel();
      const controller = new AbortController();
      current.current = controller;
      return controller.signal;
    },
  };
}

export function clipPlaybackStart(time: number, { start, end }: Pick<EditState, 'start' | 'end'>) {
  return time >= start && time < end ? time : start;
}
