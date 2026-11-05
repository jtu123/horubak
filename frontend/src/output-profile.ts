import type { AspectRatio } from './types';

const PROFILES = {
  '9:16': { ratio: '9:16', width: 1080, height: 1920, cssRatio: '9 / 16', label: '세로' },
  '1:1': { ratio: '1:1', width: 1080, height: 1080, cssRatio: '1 / 1', label: '정사각형' },
  '16:9': { ratio: '16:9', width: 1920, height: 1080, cssRatio: '16 / 9', label: '가로' },
  '4:5': { ratio: '4:5', width: 1080, height: 1350, cssRatio: '4 / 5', label: '세로 피드' },
} satisfies Record<AspectRatio, { ratio: AspectRatio; width: number; height: number; cssRatio: string; label: string }>;

/** Rendering targets and preview geometry share this profile; unknown legacy values stay 9:16. */
export function getOutputProfile(ratio?: unknown) {
  return PROFILES[typeof ratio === 'string' && Object.hasOwn(PROFILES, ratio) ? ratio as AspectRatio : '9:16'];
}
