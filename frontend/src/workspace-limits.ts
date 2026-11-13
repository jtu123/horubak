import type { Project } from './types';
import { getProjectClips } from './workspace-model';

const MAX_PROJECTS = 100;
const MAX_CLIPS = 200;
const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024;

export function workspaceLimitError(projects: Project[], ownerId: string): string | undefined {
  if (projects.length > MAX_PROJECTS) return `프로젝트는 ${MAX_PROJECTS}개까지 저장할 수 있어요. 기존 프로젝트를 정리한 뒤 다시 시도해 주세요.`;
  if (projects.some(project => getProjectClips(project).length > MAX_CLIPS)) return `프로젝트마다 클립을 ${MAX_CLIPS}개까지 저장할 수 있어요. 기존 클립을 정리한 뒤 다시 시도해 주세요.`;

  const payload = JSON.stringify({ projects, version: Number.MAX_SAFE_INTEGER, ownerId });
  if (new TextEncoder().encode(payload).byteLength > MAX_WORKSPACE_BYTES) return '편집 정보가 서버 저장 한도를 넘어요. 프로젝트 또는 클립을 정리한 뒤 다시 시도해 주세요.';
}
