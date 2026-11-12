import { HttpError } from './security.js';

const MAX_SOURCE_URL_LENGTH = 4096;
const MAX_VIDEO_SECONDS = 7 * 86400;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_INPUT', '입력 형식을 확인해 주세요.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, label: string, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new HttpError(400, 'INVALID_INPUT', `${label}을 확인해 주세요.`);
  return value.trim();
}
export function email(value: unknown) {
  const result = text(value, 254, '이메일').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(result)) throw new HttpError(400, 'INVALID_INPUT', '이메일 형식을 확인해 주세요.');
  return result;
}
export function password(value: unknown, signup = false) {
  if (typeof value !== 'string' || value.length < (signup ? 12 : 1) || value.length > 128) throw new HttpError(400, 'INVALID_INPUT', signup ? '비밀번호는 12~128자로 입력해 주세요.' : '이메일 또는 비밀번호를 확인해 주세요.');
  return value;
}
function number(value: unknown, max: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max; }
function choice(value: unknown, options: string[]) { return typeof value === 'string' && options.includes(value); }
export function project(value: unknown) {
  const doc = object(value);
  if (typeof doc.id !== 'string' || !/^[\w-]{1,100}$/.test(doc.id)) throw new HttpError(400, 'INVALID_PROJECT', '프로젝트 ID를 확인해 주세요.');
  text(doc.title, 200, '프로젝트 제목'); text(doc.sourceName, doc.source === 'url' ? MAX_SOURCE_URL_LENGTH : 500, '원본 이름');
  if (!choice(doc.status, ['ready', 'processing', 'completed', 'cancelled', 'failed']) || !choice(doc.genre, ['lecture', 'speech', 'podcast', 'general']) || !choice(doc.source, ['sample', 'file', 'url']) || !number(doc.duration, MAX_VIDEO_SECONDS) || !number(doc.progress, 100) || typeof doc.favorite !== 'boolean') throw new HttpError(400, 'INVALID_PROJECT', '프로젝트 형식을 확인해 주세요.');
  for (const date of [doc.createdAt, doc.updatedAt]) if (typeof date !== 'string' || date.length > 35 || !Number.isFinite(Date.parse(date))) throw new HttpError(400, 'INVALID_PROJECT', '프로젝트 날짜를 확인해 주세요.');
  if (doc.sourceUrl !== undefined) {
    let address: URL;
    try { address = new URL(text(doc.sourceUrl, MAX_SOURCE_URL_LENGTH, '원본 URL')); } catch { throw new HttpError(400, 'INVALID_PROJECT', '원본 URL을 확인해 주세요.'); }
    if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) throw new HttpError(400, 'INVALID_PROJECT', '원본 URL을 확인해 주세요.');
  }
  function edit(value: unknown) {
    const item = object(value);
    // Draft edits can temporarily fall outside the source range while the editor inputs change.
    for (const time of [item.start, item.end]) {
      if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time) > MAX_VIDEO_SECONDS) throw new HttpError(400, 'INVALID_PROJECT', '편집 구간을 확인해 주세요.');
    }
    text(item.subtitle, 10000, '자막', 0);
  }
  if (doc.edit) edit(doc.edit);
  if (doc.clips !== undefined) {
    if (!Array.isArray(doc.clips) || doc.clips.length > 200) throw new HttpError(400, 'INVALID_PROJECT', '클립 개수를 확인해 주세요.');
    for (const clip of doc.clips) { const item = object(clip); text(item.id, 100, '클립 ID'); text(item.title, 200, '클립 제목'); edit(item.edit); }
  }
  // Owner, role and archive state are server columns, never client-writable properties.
  const allowed = ['id', 'title', 'genre', 'status', 'duration', 'createdAt', 'updatedAt', 'favorite', 'source', 'sourceName', 'sportsSampleId', 'sourceUrl', 'fileSize', 'startedAt', 'progress', 'edit', 'schemaVersion', 'legacyGenre', 'contentProfile', 'clips', 'activeClipId', 'dismissedCandidateIds'];
  return Object.fromEntries(allowed.filter(key => doc[key] !== undefined).map(key => [key, doc[key]]));
}
export function pagination(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1); const size = Number(query.size ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(size) || size < 1 || size > 100) throw new HttpError(400, 'INVALID_INPUT', '페이지 범위를 확인해 주세요.');
  return { page, size, offset: (page - 1) * size };
}
