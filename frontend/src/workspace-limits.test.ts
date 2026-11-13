import { describe, expect, it } from 'vitest';
import { addProjectClip, normalizeProject } from './workspace-model';
import { workspaceLimitError } from './workspace-limits';

const ownerId = 'test-owner';
const project = normalizeProject({ id: 'project', title: '프로젝트', duration: 60 })!;

describe('workspace limits', () => {
  it('accepts 100 projects and rejects the next project', () => {
    const projects = Array.from({ length: 100 }, (_, index) => ({ ...project, id: `project-${index}` }));
    expect(workspaceLimitError(projects, ownerId)).toBeUndefined();
    expect(workspaceLimitError([...projects, project], ownerId)).toContain('프로젝트는 100개');
  });

  it('accepts 200 clips and rejects a batch that would exceed the limit', () => {
    const clip = addProjectClip(project, 'clip').clips![0];
    const clips = Array.from({ length: 199 }, (_, index) => ({ ...clip, id: `clip-${index}` }));
    const current = normalizeProject({ ...project, clips })!;
    const withOne = addProjectClip(current, 'new-clip-1');
    expect(workspaceLimitError([withOne], ownerId)).toBeUndefined();
    expect(workspaceLimitError([addProjectClip(withOne, 'new-clip-2')], ownerId)).toContain('클립을 200개');
    expect(current.clips).toHaveLength(199);
  });

  it('counts UTF-8 bytes across the entire save request', () => {
    const clip = addProjectClip(project, 'clip').clips![0];
    const subtitle = '가'.repeat(10_000);
    const clips = Array.from({ length: 150 }, (_, index) => ({ ...clip, id: `clip-${index}`, edit: { ...clip.edit, subtitle } }));
    const largeProject = normalizeProject({ ...project, clips })!;
    expect(workspaceLimitError([normalizeProject({ ...project, clips: clips.slice(0, 100) })!], ownerId)).toBeUndefined();
    expect(workspaceLimitError([largeProject], ownerId)).toContain('서버 저장 한도');
  });
});
