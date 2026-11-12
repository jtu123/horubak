import type { Candidate, Clip, ContentProfile, ContentSignal, EditState, Genre, Project, ProjectStatus } from './types';
import { getOutputProfile } from './output-profile';

const EPOCH = '1970-01-01T00:00:00.000Z';
const GENRE_VALUES: Genre[] = ['lecture', 'speech', 'podcast', 'general'];
const STATUS_VALUES: ProjectStatus[] = ['ready', 'processing', 'completed', 'cancelled', 'failed'];
const SIGNAL_VALUES: ContentSignal[] = ['speech', 'visual', 'music', 'screen'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;

export function manualEdit(duration: number, title = ''): EditState {
  return { candidateId: 'manual', start: 0, end: Math.min(60, Math.max(0, duration)), subtitle: title, subtitleSize: 26, subtitleColor: '#ffffff', subtitleVisible: true, cropX: 50, cropY: 50, scale: 1, contextApplied: false, layout: 'full' };
}

function normalizeEdit(value: unknown, duration: number, title: string): EditState {
  const fallback = manualEdit(duration, title);
  if (!object(value)) return fallback;
  return {
    ...value,
    candidateId: text(value.candidateId, fallback.candidateId),
    start: finite(value.start, fallback.start), end: finite(value.end, fallback.end),
    subtitle: text(value.subtitle, fallback.subtitle), subtitleSize: finite(value.subtitleSize, 26),
    subtitleColor: text(value.subtitleColor, '#ffffff'),
    subtitleVisible: typeof value.subtitleVisible === 'boolean' ? value.subtitleVisible : true,
    cropX: finite(value.cropX, 50), cropY: finite(value.cropY, 50), scale: finite(value.scale, 1),
    contextApplied: value.contextApplied === true, 
layout:
  value.layout === 'speaker'
    ? 'speaker'
    : value.layout === 'material'
      ? 'material'
      : value.layout === 'split'
        ? 'split'
        : 'full',
    ...(Object.hasOwn(value, 'aspectRatio') ? { aspectRatio: getOutputProfile(value.aspectRatio).ratio } : {}),
    ...(Object.hasOwn(value, 'showSafeArea') ? { showSafeArea: value.showSafeArea === true } : {}),
  };
}

export function getProjectClips(project: Project): Clip[] {
  if (Array.isArray(project.clips)) return project.clips;
  if (!project.edit) return [];
  return [{ id: `legacy-${project.id}`, title: project.title, edit: { ...project.edit }, createdAt: project.createdAt, updatedAt: project.updatedAt }];
}

export function getActiveClip(project: Project): Clip | undefined {
  const clips = getProjectClips(project);
  return clips.find(clip => clip.id === project.activeClipId) ?? clips[0];
}

/** Converts a single record; unknown fields remain in the record and raw backups. */
export function normalizeProject(value: unknown): Project | null {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string') return null;
  const genre = GENRE_VALUES.includes(value.genre as Genre) ? value.genre as Genre : 'general';
  const createdAt = text(value.createdAt, EPOCH);
  const updatedAt = text(value.updatedAt, createdAt);
  const duration = Math.max(0, finite(value.duration, 0));
  let profile: ContentProfile | undefined;
  if (object(value.contentProfile)) {
    profile = {
      purpose: text(value.contentProfile.purpose, '하이라이트'),
      ...(typeof value.contentProfile.focus === 'string' ? { focus: value.contentProfile.focus } : {}),
      signals: Array.isArray(value.contentProfile.signals)
        ? [...new Set(value.contentProfile.signals.filter((signal): signal is ContentSignal => SIGNAL_VALUES.includes(signal as ContentSignal)))] : [],
    };
  }
  const project: Project = {
    ...value,
    id: value.id, title: value.title, genre,
    schemaVersion: 3,
    ...(typeof value.genre === 'string' && !GENRE_VALUES.includes(value.genre as Genre) ? { legacyGenre: value.genre } : {}),
    contentProfile: profile,
    status: STATUS_VALUES.includes(value.status as ProjectStatus) ? value.status as ProjectStatus : 'ready',
    duration, createdAt, updatedAt,
    favorite: value.favorite === true,
    source: value.source === 'sample' ? 'sample' : value.source === 'url' ? 'url' : 'file',
    sourceName: text(value.sourceName, value.title),
    progress: Math.min(100, Math.max(0, finite(value.progress, 0))),
    dismissedCandidateIds: Array.isArray(value.dismissedCandidateIds) ? value.dismissedCandidateIds.filter((id): id is string => typeof id === 'string') : [],
  };
  let clips: Clip[];
  if (Array.isArray(value.clips)) {
    clips = value.clips.filter((clip): clip is Record<string, unknown> => object(clip) && typeof clip.id === 'string' && !!clip.id && object(clip.edit))
      .map(clip => ({ ...clip, id: clip.id as string, title: text(clip.title, project.title), edit: normalizeEdit(clip.edit, duration, project.title), createdAt: text(clip.createdAt, createdAt), updatedAt: text(clip.updatedAt, updatedAt) }));
    const ids = new Set<string>();
    clips = clips.filter(clip => { if (ids.has(clip.id)) return false; ids.add(clip.id); return true; });
  } else if (object(value.edit)) {
    clips = [{ id: `legacy-${project.id}`, title: project.title, edit: normalizeEdit(value.edit, duration, project.title), createdAt, updatedAt }];
  } else {
    clips = [];
  }
  const active = clips.find(clip => clip.id === value.activeClipId) ?? clips[0];
  return { ...project, clips, activeClipId: active?.id, edit: active ? { ...active.edit } : undefined };
}

/** Single compatibility path: project.edit always mirrors the selected clip. */
export function patchProject(project: Project, patch: Partial<Project>, now = new Date().toISOString()): Project {
  let next = normalizeProject({ ...project, ...patch, updatedAt: now })!;
  if (Object.prototype.hasOwnProperty.call(patch, 'edit') && patch.edit) {
    const active = getActiveClip(next);
    if (active) {
      next = { ...next, clips: getProjectClips(next).map(clip => clip.id === active.id ? { ...clip, edit: { ...patch.edit! }, updatedAt: now } : clip) };
    } else {
      const clip = { id: `legacy-${project.id}`, title: project.title, edit: { ...patch.edit }, createdAt: now, updatedAt: now };
      next = { ...next, clips: [clip], activeClipId: clip.id };
    }
  }
  return normalizeProject(next)!;
}

export function selectProjectClip(project: Project, clipId: string): Project {
  return getProjectClips(project).some(clip => clip.id === clipId) ? normalizeProject({ ...project, activeClipId: clipId })! : project;
}

export function addProjectClip(project: Project, id: string, candidate?: Candidate, now = new Date().toISOString()): Project {
  const edit = candidate ? {
    ...manualEdit(project.duration), candidateId: candidate.id, start: candidate.start, end: candidate.end, subtitle: candidate.title,
    layout: candidate.evidenceKind === 'scene' || candidate.evidenceKind === 'sound' ? 'full' as const : 'speaker' as const,
  } : manualEdit(project.duration, project.title);
  const clip: Clip = { id, title: candidate?.title ?? '새 클립', edit, createdAt: now, updatedAt: now };
  return normalizeProject({ ...project, clips: [...getProjectClips(project), clip], activeClipId: id, updatedAt: now })!;
}

export function updateProjectClip(project: Project, clipId: string, patch: Partial<EditState>, now = new Date().toISOString()): Project {
  return normalizeProject({ ...project, updatedAt: now, clips: getProjectClips(project).map(clip => clip.id === clipId ? { ...clip, edit: { ...clip.edit, ...patch }, updatedAt: now } : clip) })!;
}

export interface ProjectStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface LoadedProjects { projects: Project[]; writeAllowed: boolean; notice?: string; backupKey?: string }

function preserveRaw(storage: ProjectStorage, key: string, raw: string): string {
  let backupKey = `${key}.backup.v3`;
  const previous = storage.getItem(backupKey);
  if (previous !== null && previous !== raw) {
    let checksum = 2166136261;
    for (let i = 0; i < raw.length; i++) checksum = Math.imul(checksum ^ raw.charCodeAt(i), 16777619);
    backupKey = `${key}.recovery.${(checksum >>> 0).toString(16)}-${raw.length}`;
    const existing = storage.getItem(backupKey);
    if (existing !== null && existing !== raw) throw new Error('Recovery backup collision');
  }
  if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
  return backupKey;
}

/** Does not replace malformed or unsupported saved collections with sample projects. */
export function loadProjectCollection(storage: ProjectStorage, key: string, fallback: () => Project[]): LoadedProjects {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return { projects: fallback().map(p => normalizeProject(p)!), writeAllowed: false, notice: '브라우저 저장소를 읽지 못했어요. 변경 내용은 이 창에서만 유지됩니다.' }; }
  if (raw === null) return { projects: fallback().map(p => normalizeProject(p)!), writeAllowed: true };
  let values: unknown;
  try { values = JSON.parse(raw); } catch {
    try { const backupKey = preserveRaw(storage, key, raw); return { projects: [], writeAllowed: false, backupKey, notice: '저장된 목록을 읽지 못했어요. 원본을 백업했으며 자동 저장을 중지했습니다.' }; }
    catch { return { projects: [], writeAllowed: false, notice: '저장된 목록을 읽지 못했어요. 원본 보존을 위해 자동 저장을 중지했습니다.' }; }
  }
  if (!Array.isArray(values)) {
    try { return { projects: [], writeAllowed: false, backupKey: preserveRaw(storage, key, raw), notice: '지원하지 않는 저장 형식입니다. 원본을 보존하고 자동 저장을 중지했습니다.' }; }
    catch { return { projects: [], writeAllowed: false, notice: '원본 보존을 위해 자동 저장을 중지했습니다.' }; }
  }
  const projects = values.map(normalizeProject).filter((project): project is Project => !!project);
  const changed = JSON.stringify(projects) !== raw;
  if (!changed) return { projects, writeAllowed: true };
  try {
    const backupKey = preserveRaw(storage, key, raw);
    const omitted = projects.length !== values.length;
    return { projects, writeAllowed: !omitted || projects.length > 0, backupKey, ...(omitted ? { notice: '일부 항목을 열지 못했어요. 원본 목록은 복구용으로 보존했습니다.' } : {}) };
  } catch {
    return { projects, writeAllowed: false, notice: '이전 목록을 백업하지 못했어요. 원본 보존을 위해 자동 저장을 중지했습니다.' };
  }
}

