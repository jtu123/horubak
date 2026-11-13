import { randomUUID } from 'node:crypto';
import { HttpError } from '../security.js';
import { object, text } from '../validation.js';
import type { ContentSignal, Genre, StagedProject } from '../types/project.types.js';
import { probeVideo } from './video.service.js';

const GENRES = new Set<unknown>(['lecture', 'speech', 'podcast', 'general']);
const SIGNALS = new Set<unknown>(['speech', 'visual', 'music', 'screen']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readContentProfile(value: unknown): StagedProject['contentProfile'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_CONTENT_PROFILE', '제작 목적을 확인해 주세요.');
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new HttpError(400, 'INVALID_CONTENT_PROFILE', '제작 목적을 확인해 주세요.'); }
  const profile = object(parsed);
  const purpose = text(profile.purpose, 80, '제작 목적');
  const focus = profile.focus === undefined ? undefined : text(profile.focus, 160, '남기고 싶은 순간', 0);
  const signals = profile.signals ?? [];
  if (!Array.isArray(signals) || signals.length > SIGNALS.size || !signals.every(signal => SIGNALS.has(signal))) {
    throw new HttpError(400, 'INVALID_CONTENT_PROFILE', '영상 단서를 확인해 주세요.');
  }
  return { purpose, ...(focus ? { focus } : {}), signals: [...new Set<ContentSignal>(signals)] };
}

export async function inspectStagedProject(body: unknown, file: Express.Multer.File | undefined, signal: AbortSignal): Promise<StagedProject> {
  const fields = object(body);
  if (fields.projectId !== undefined && (typeof fields.projectId !== 'string' || !UUID_V4.test(fields.projectId))) {
    throw new HttpError(400, 'INVALID_PROJECT_ID', '프로젝트 ID를 확인해 주세요.');
  }
  const projectId = fields.projectId ?? randomUUID();
  if (fields.inputType !== 'FILE') throw new HttpError(400, 'UNSUPPORTED_INPUT', '현재는 영상 파일만 서버에 등록할 수 있습니다.');
  const projectName = text(fields.projectName, 80, '프로젝트 이름');
  if (!GENRES.has(fields.genre)) throw new HttpError(400, 'INVALID_GENRE', '영상 종류를 확인해 주세요.');
  if (!file || file.size === 0) throw new HttpError(400, 'MISSING_VIDEO', '영상 파일을 선택해 주세요.');
  const filename = text(file.originalname, 255, '원본 파일 이름');
  const contentProfile = readContentProfile(fields.contentProfile);
  const metadata = await probeVideo(file.path, signal);

  return {
    projectId, projectName, genre: fields.genre as Genre, inputType: 'FILE',
    ...(contentProfile ? { contentProfile } : {}),
    metadata: { filename, ...metadata },
    file: { stagedPath: file.path, filename: file.filename, size: file.size },
  };
}
