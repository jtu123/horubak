import { describe, expect, it } from 'vitest';
import { getOutputProfile } from './output-profile';
import { normalizeProject, updateProjectClip } from './workspace-model';
import { seedProjects } from './data';

describe('output profiles', () => {
  it.each([
    ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['16:9', 1920, 1080], ['4:5', 1080, 1350],
  ] as const)('keeps %s preview geometry and export dimensions consistent', (ratio, width, height) => {
    const profile = getOutputProfile(ratio);
    expect(profile).toMatchObject({ ratio, width, height });
    const [x, y] = profile.cssRatio.split('/').map(Number);
    expect(x / y).toBeCloseTo(width / height);
  });

  it.each([undefined, null, '', '3:2', 'constructor', '__proto__', {}, 1])('uses the legacy 9:16 target for an unsupported ratio (%s)', ratio => {
    expect(getOutputProfile(ratio)).toMatchObject({ ratio: '9:16', width: 1080, height: 1920 });
  });

  it('keeps a new ratio and guide independent between saved clips and across normalization', () => {
    const initial = normalizeProject(seedProjects()[0])!;
    const first = initial.clips![0];
    const second = { ...first, id: 'another-clip', edit: { ...first.edit } };
    const project = { ...initial, clips: [first, second] };
    const changed = updateProjectClip(project, first.id, { aspectRatio: '16:9', showSafeArea: true });
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(changed)))!;
    expect(reloaded.clips![0].edit).toMatchObject({ aspectRatio: '16:9', showSafeArea: true });
    expect(getOutputProfile(reloaded.clips![1].edit.aspectRatio).ratio).toBe('9:16');
    expect(reloaded.clips![1].edit.showSafeArea).not.toBe(true);
  });

  it('recovers an invalid persisted ratio and guide without losing existing edit values', () => {
    const legacy = seedProjects()[0];
    const project = normalizeProject({ ...legacy, edit: { ...legacy.edit, aspectRatio: '3:2', showSafeArea: 'yes' } })!;
    expect(project.edit).toMatchObject({ start: legacy.edit!.start, subtitle: legacy.edit!.subtitle, aspectRatio: '9:16', showSafeArea: false });
  });
});
