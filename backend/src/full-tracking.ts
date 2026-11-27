import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express, Request } from 'express';
import type { Database } from './database-contract.js';
import { analysisConfigured, callService, ownedProject, revision } from './analysis.js';
import type { AnalysisOptions } from './analysis.js';
import { createSecurity, HttpError } from './security.js';
import { activeJob, dictionary, jobResult, MAX_SOURCE_BYTES, MAX_SOURCE_SECONDS, providerUrl, sourceResult, uploadSession } from './full-tracking-contract.js';
import type { FullJob, FullSource, UploadSession } from './full-tracking-contract.js';
import { MAX_TRACKING_BYTES, validateTrackingResult } from './tracking-validation.js';
import type { TrackingResult, TrackingSelection } from './tracking-validation.js';

type Security = ReturnType<typeof createSecurity>;
type Options = {
  analysis?: AnalysisOptions; origin: string;
  beforeSourceChange?: (req: Request) => Promise<void>;
  assertNoReservedSourceChange?: (ownerId: string, projectId: string, sourceRevision: string) => void;
};
interface UploadRow {
  owner_id: string; project_id: string; upload_id: string; source_revision: string; filename: string; size: number;
  content_type: string; session_json: string; source_json: string | null; created_at: string;
}
interface JobRow {
  id: string; owner_id: string; project_id: string; source_revision: string; upload_id: string;
  source_json: string; job_json: string; provisioned: number; created_at: string;
}
export const fullTrackingConfigured = (options?: AnalysisOptions) => options?.fullTrackingEnabled === true && analysisConfigured(options);
const prefix = '/api/tracking/projects/:id';
const missing = () => new HttpError(404, 'NOT_FOUND', '프로젝트 또는 분석 작업을 찾을 수 없습니다.');
const sourceChanged = () => new HttpError(409, 'SOURCE_CHANGED', '원본이 변경됐어요. 현재 원본으로 다시 분석해 주세요.');
const body = (req: Request) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'INVALID_INPUT', '입력 형식을 확인해 주세요.');
  return req.body as Record<string, unknown>;
};

export function mountFullTracking(app: Express, db: Database, security: Security, options: Options) {
  const router = express.Router({ mergeParams: true });
  const uploads = (owner: string, project: string, sourceRevision: string, ready: boolean) => db.prepare(
    `SELECT * FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND source_revision=? AND source_json IS ${ready ? 'NOT ' : ''}NULL ORDER BY created_at DESC,rowid DESC LIMIT 1`,
  ).get(owner, project, sourceRevision) as unknown as UploadRow | undefined;
  const jobRow = (owner: string, project: string, id: string) => db.prepare('SELECT * FROM tracking_full_jobs WHERE owner_id=? AND project_id=? AND id=?').get(owner, project, id) as unknown as JobRow | undefined;
  const latest = (owner: string, project: string) => db.prepare('SELECT * FROM tracking_full_jobs WHERE owner_id=? AND project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(owner, project) as unknown as JobRow | undefined;
  const configured = () => { if (!fullTrackingConfigured(options.analysis)) throw new HttpError(503, 'FULL_TRACKING_NOT_CONFIGURED', '전체 영상 분석 저장소와 작업 서버가 아직 연결되지 않았습니다.'); };
  const context = (req: Request) => {
    const owner = security.user(req); const projectId = String(req.params.id); const project = ownedProject(db, owner.id, projectId);
    if (project.duration > MAX_SOURCE_SECONDS) throw new HttpError(422, 'VIDEO_TOO_LONG', '최대 10시간 이하 원본을 등록해 주세요.');
    return { ownerId: owner.id, projectId, project, sourceRevision: revision(project) };
  };
  type Context = ReturnType<typeof context>;
  const recheck = (req: Request, expected: Context) => {
    const current = context(req);
    if (current.ownerId !== expected.ownerId || current.sourceRevision !== expected.sourceRevision) throw sourceChanged();
    return current;
  };
  const provider = (action: string, input: unknown, maximum = 128 * 1024) => callService(options.analysis, '/api/full-tracking/' + action,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, 60000, maximum);
  const currentSource = (ctx: Context) => {
    const row = uploads(ctx.ownerId, ctx.projectId, ctx.sourceRevision, true);
    return row ? sourceResult(JSON.parse(row.source_json!)) : null;
  };
  const boundJob = (ctx: Context, id: string) => {
    const row = jobRow(ctx.ownerId, ctx.projectId, id); if (!row) throw missing();
    const source = currentSource(ctx);
    if (row.source_revision !== ctx.sourceRevision || !source || source.uploadId !== row.upload_id || JSON.stringify(source) !== row.source_json) throw sourceChanged();
    return row;
  };
  const assertJob = (req: Request, ctx: Context, row: JobRow) => { recheck(req, ctx); return boundJob(ctx, row.id); };
  const cache = (row: JobRow, job: FullJob, provisioned = row.provisioned) => {
    db.prepare('UPDATE tracking_full_jobs SET job_json=?,provisioned=?,updated_at=? WHERE id=? AND owner_id=? AND project_id=?')
      .run(JSON.stringify(job), provisioned, new Date().toISOString(), row.id, row.owner_id, row.project_id);
  };
  const refresh = async (req: Request, ctx: Context, row: JobRow) => {
    assertJob(req, ctx, row);
    if (!row.provisioned) return JSON.parse(row.job_json) as FullJob;
    const value = await provider('jobs/status', { jobId: row.id });
    assertJob(req, ctx, row);
    const job = jobResult(value, row.id, JSON.parse(row.source_json)); cache(row, job); return job;
  };
  const noActiveJob = async (req: Request, ctx: Context) => {
    await options.beforeSourceChange?.(req);
    const rows = db.prepare("SELECT * FROM tracking_full_jobs WHERE owner_id=? AND project_id=? AND source_revision=? AND json_extract(job_json,'$.state') IN ('queued','running','cancelling') ORDER BY created_at DESC").all(ctx.ownerId, ctx.projectId, ctx.sourceRevision) as unknown as JobRow[];
    for (const row of rows) {
      if (!activeJob(JSON.parse(row.job_json))) continue;
      const job = await refresh(req, ctx, row);
      if (activeJob(job)) throw new HttpError(409, 'TRACKING_IN_PROGRESS', '실행 중인 전체 분석을 중단한 뒤 원본을 변경해 주세요.');
    }
  };
  const noReservedJob = (ctx: Context) => {
    options.assertNoReservedSourceChange?.(ctx.ownerId, ctx.projectId, ctx.sourceRevision);
    const rows = db.prepare('SELECT job_json FROM tracking_full_jobs WHERE owner_id=? AND project_id=? AND source_revision=?').all(ctx.ownerId, ctx.projectId, ctx.sourceRevision);
    if (rows.some(row => activeJob(JSON.parse(String(row.job_json))))) throw new HttpError(409, 'TRACKING_IN_PROGRESS', '실행 중인 전체 분석을 중단한 뒤 원본을 변경해 주세요.');
  };
  const newestUpload = (ctx: Context) => db.prepare('SELECT upload_id FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND source_revision=? ORDER BY created_at DESC,rowid DESC LIMIT 1')
    .get(ctx.ownerId, ctx.projectId, ctx.sourceRevision)?.upload_id;
  const mutation = [
    (req: Request, _res: express.Response, next: express.NextFunction) => { context(req); security.verifyMutation(req); configured(); if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.'); next(); },
    express.json({ limit: '16kb' }),
  ];
  const selections = (row: JobRow, result: TrackingResult): TrackingSelection[] => {
    const sceneIds = result.scenes.map(scene => scene.id);
    if (!sceneIds.length) return [];
    const records = db.prepare('SELECT scene_id,track_id FROM tracking_full_selections WHERE job_id=? AND scene_id IN (' + sceneIds.map(() => '?').join(',') + ')').all(row.id, ...sceneIds);
    const refs = new Set(result.tracks.map(track => `${track.sceneId}:${track.id}`));
    return records.flatMap(item => refs.has(`${item.scene_id}:${item.track_id}`)
      ? [{ sceneId: String(item.scene_id), trackId: String(item.track_id) }] : []);
  };
  const window = async (req: Request, ctx: Context, row: JobRow, start: number) => {
    if (!Number.isFinite(start) || start < 0 || start >= JSON.parse(row.source_json).duration) throw new HttpError(422, 'TRACKING_RANGE_INVALID', '원본 안의 재생 위치를 선택해 주세요.');
    let current = await refresh(req, ctx, row);
    const value = await provider('jobs/window', { jobId: row.id, start }, MAX_TRACKING_BYTES);
    assertJob(req, ctx, row);
    if (value.result === null) return { job: current, state: 'missing' as const, result: null, selections: [] as TrackingSelection[] };
    const rangeStart = Math.floor(start / 60) * 60; const end = Math.min(rangeStart + 60, current.duration);
    const engine = validateTrackingResult(value.result, current.duration, { start: rangeStart, end, sampleFps: 2 }, true);
    // A chunk may have committed between the status and window reads. Refresh
    // that older snapshot instead of rejecting the newly available result.
    if (end > current.processedSeconds + .001 || !current.sourceSha256) current = await refresh(req, ctx, row);
    const source = JSON.parse(row.source_json) as FullSource;
    if (engine.source.width !== source.width || engine.source.height !== source.height || !current.sourceSha256 || engine.sourceSha256 !== current.sourceSha256) throw new HttpError(502, 'TRACKING_RESPONSE_INVALID', '분석한 원본과 결과의 지문이 일치하지 않습니다.');
    if (end > current.processedSeconds + .001) throw new HttpError(502, 'TRACKING_RESPONSE_INVALID', '아직 완료되지 않은 구간의 결과입니다.');
    const result: TrackingResult = { ...engine, analysisId: row.id, sourceRevision: row.source_revision, createdAt: current.createdAt };
    return { job: current, state: 'ready' as const, result, selections: selections(row, result) };
  };

  router.get('/source', (req, res) => {
    const ctx = context(req); configured();
    const pending = uploads(ctx.ownerId, ctx.projectId, ctx.sourceRevision, false);
    const upload = pending ? JSON.parse(pending.session_json) as UploadSession : null;
    res.json({ source: currentSource(ctx), upload: upload && Date.parse(upload.expiresAt) > Date.now() ? upload : null });
  });
  router.post('/source', ...mutation, async (req, res) => {
    const ctx = context(req); const input = body(req); const filename = input.filename; const size = input.size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', '비어 있지 않은 4GB 이하 원본 파일을 선택해 주세요.');
    if (typeof filename !== 'string' || !/\.(mp4|mov)$/i.test(filename) || filename.length > 500 || /[\u0000-\u001f\u007f]/.test(filename)
      || !['video/mp4', 'video/quicktime', 'application/octet-stream'].includes(String(input.contentType))) throw new HttpError(422, 'INVALID_VIDEO', 'MP4 또는 MOV 원본을 선택해 주세요.');
    if (!['file', 'sample'].includes(ctx.project.source) || filename.normalize('NFC') !== ctx.project.sourceName.normalize('NFC') || ctx.project.fileSize !== undefined && size !== ctx.project.fileSize) throw sourceChanged();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(ctx.projectId)) throw new HttpError(422, 'PROJECT_ID_INVALID', '새 프로젝트를 등록한 뒤 전체 분석을 시작해 주세요.');
    await noActiveJob(req, ctx);
    const previous = uploads(ctx.ownerId, ctx.projectId, ctx.sourceRevision, false);
    if (previous && previous.filename === filename && previous.size === size) {
      const session = JSON.parse(previous.session_json) as UploadSession;
      if (Date.parse(session.expiresAt) > Date.now()) return res.status(200).json(session);
    }
    const uploadId = randomUUID(); const inputBody = { ownerId: ctx.ownerId, projectId: ctx.projectId, uploadId, filename, size, contentType: input.contentType, origin: options.origin };
    const value = await provider('uploads/init', inputBody); recheck(req, ctx);
    const session = uploadSession(value, uploadId, options.analysis); const date = new Date().toISOString();
    db.transaction(() => {
      noReservedJob(ctx);
      db.prepare('INSERT INTO tracking_source_uploads(owner_id,project_id,upload_id,source_revision,filename,size,content_type,session_json,source_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(ctx.ownerId, ctx.projectId, uploadId, ctx.sourceRevision, filename, size, String(input.contentType), JSON.stringify(session), null, date, date);
    });
    res.status(201).json(session);
  });
  router.post('/source/:uploadId/complete', ...mutation, async (req, res) => {
    const ctx = context(req); const row = db.prepare('SELECT * FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND upload_id=?').get(ctx.ownerId, ctx.projectId, String(req.params.uploadId)) as unknown as UploadRow | undefined;
    if (!row) throw missing(); if (row.source_revision !== ctx.sourceRevision) throw sourceChanged();
    if (row.source_json) return res.json({ source: sourceResult(JSON.parse(row.source_json)) });
    if (newestUpload(ctx) !== row.upload_id) throw new HttpError(409, 'UPLOAD_SUPERSEDED', '더 최근에 선택한 원본의 업로드를 완료해 주세요.');
    await noActiveJob(req, ctx);
    const expected = { ownerId: ctx.ownerId, projectId: ctx.projectId, uploadId: row.upload_id, filename: row.filename, size: row.size };
    const value = await provider('uploads/complete', { ...expected, contentType: row.content_type, origin: options.origin }); recheck(req, ctx);
    const source = sourceResult(value, expected);
    if (Math.abs(source.duration - ctx.project.duration) > .5) throw new HttpError(409, 'SOURCE_DURATION_CHANGED', '등록한 영상과 실제 원본 길이가 다릅니다. 원본을 다시 등록해 주세요.');
    const date = new Date().toISOString();
    db.transaction(() => {
      noReservedJob(ctx);
      if (newestUpload(ctx) !== row.upload_id) throw new HttpError(409, 'UPLOAD_SUPERSEDED', '원본 업로드가 변경됐습니다. 최신 업로드를 확인해 주세요.');
      db.prepare('UPDATE tracking_source_uploads SET source_json=?,updated_at=? WHERE owner_id=? AND project_id=? AND upload_id=?').run(JSON.stringify(source), date, ctx.ownerId, ctx.projectId, row.upload_id);
      // A completed replacement supersedes only old upload sessions, never an active job.
      db.prepare('DELETE FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND upload_id<>?').run(ctx.ownerId, ctx.projectId, row.upload_id);
      const projectRow = db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=?').get(ctx.ownerId, ctx.projectId);
      const document = JSON.parse(String(projectRow!.document));
      document.sourceUploaded = true;
      // This is a derived server capability, not a user edit/version change.
      db.prepare('UPDATE projects SET document=? WHERE owner_id=? AND id=?').run(JSON.stringify(document), ctx.ownerId, ctx.projectId);
    });
    res.json({ source });
  });
  router.get('/jobs/latest', async (req, res) => {
    const ctx = context(req); configured(); const row = latest(ctx.ownerId, ctx.projectId);
    if (!row) return res.json({ job: null });
    if (row.source_revision !== ctx.sourceRevision || row.upload_id !== currentSource(ctx)?.uploadId) return res.json({ job: null });
    res.json({ job: await refresh(req, ctx, row) });
  });
  router.post('/jobs', ...mutation, async (req, res) => {
    const ctx = context(req); const source = currentSource(ctx); if (!source) throw new HttpError(409, 'SOURCE_UPLOAD_REQUIRED', '원본 업로드를 완료한 뒤 전체 분석을 시작해 주세요.');
    const existing = latest(ctx.ownerId, ctx.projectId);
    if (existing && existing.source_revision === ctx.sourceRevision && existing.upload_id === source.uploadId && activeJob(JSON.parse(existing.job_json))) {
      const current = await refresh(req, ctx, existing);
      if (activeJob(current)) return res.status(202).json({ job: current });
    }
    recheck(req, ctx); security.rate(req, 'full-tracking:' + ctx.ownerId);
    const id = randomUUID(); const date = new Date().toISOString();
    const initial: FullJob = { id, source, state: 'queued', processedSeconds: 0, duration: source.duration, sampleFps: 2, chunkSeconds: 60,
      completedChunks: 0, totalChunks: Math.ceil(source.duration / 60), sourceSha256: null, error: null, createdAt: date, updatedAt: date };
    const joined = db.transaction(() => {
      if (currentSource(ctx)?.uploadId !== source.uploadId) throw sourceChanged();
      const newest = latest(ctx.ownerId, ctx.projectId);
      if (newest && newest.id !== existing?.id && newest.source_revision === ctx.sourceRevision && newest.upload_id === source.uploadId && activeJob(JSON.parse(newest.job_json))) return newest;
      db.prepare('INSERT INTO tracking_full_jobs(id,owner_id,project_id,source_revision,upload_id,source_json,job_json,provisioned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, ctx.ownerId, ctx.projectId, ctx.sourceRevision, source.uploadId, JSON.stringify(source), JSON.stringify(initial), 0, date, date);
      return null;
    });
    if (joined) return res.status(202).json({ job: await refresh(req, ctx, joined) });
    const row = boundJob(ctx, id);
    try {
      const value = await provider('jobs/create', { jobId: id, source }); assertJob(req, ctx, row);
      const job = jobResult(value, id, source); cache(row, job, 1); row.provisioned = 1;
      await provider('jobs/dispatch', { jobId: id }); assertJob(req, ctx, row);
      res.status(202).json({ job });
    } catch (error) {
      if (!row.provisioned) cache(row, { ...initial, state: 'failed', error: { code: 'JOB_CREATE_FAILED', message: '전체 영상 작업을 등록하지 못했습니다. 다시 시도해 주세요.' } });
      throw error;
    }
  });
  router.get('/jobs/:jobId', async (req, res) => { const ctx = context(req); configured(); res.json({ job: await refresh(req, ctx, boundJob(ctx, String(req.params.jobId))) }); });
  router.post('/jobs/:jobId/cancel', ...mutation, async (req, res) => {
    const ctx = context(req); const row = boundJob(ctx, String(req.params.jobId)); const current = await refresh(req, ctx, row);
    if (!activeJob(current)) return res.json({ job: current });
    const value = await provider('jobs/cancel', { jobId: row.id }); assertJob(req, ctx, row);
    const job = jobResult(value, row.id, JSON.parse(row.source_json)); cache(row, job); res.json({ job });
  });
  router.post('/jobs/:jobId/resume', ...mutation, async (req, res) => {
    const ctx = context(req); const row = boundJob(ctx, String(req.params.jobId)); const current = await refresh(req, ctx, row);
    if (!['failed', 'interrupted', 'cancelled'].includes(current.state)) throw new HttpError(409, 'JOB_NOT_RESUMABLE', '중단되거나 실패한 작업만 이어서 분석할 수 있습니다.');
    let job: FullJob;
    if (!row.provisioned) {
      job = jobResult(await provider('jobs/create', { jobId: row.id, source: JSON.parse(row.source_json) }), row.id, JSON.parse(row.source_json));
      assertJob(req, ctx, row); cache(row, job, 1); row.provisioned = 1;
    } else {
      job = jobResult(await provider('jobs/resume', { jobId: row.id }), row.id, JSON.parse(row.source_json)); assertJob(req, ctx, row); cache(row, job);
    }
    await provider('jobs/dispatch', { jobId: row.id }); assertJob(req, ctx, row); res.status(202).json({ job });
  });
  router.get('/jobs/:jobId/window', async (req, res) => {
    const ctx = context(req); configured(); const start = typeof req.query.start === 'string' && req.query.start.trim() ? Number(req.query.start) : NaN;
    res.json(await window(req, ctx, boundJob(ctx, String(req.params.jobId)), start));
  });
  router.put('/jobs/:jobId/selection', ...mutation, async (req, res) => {
    const ctx = context(req); const row = boundJob(ctx, String(req.params.jobId)); const input = body(req);
    if (input.sourceRevision !== row.source_revision) throw sourceChanged();
    const value = await window(req, ctx, row, typeof input.windowStart === 'number' ? input.windowStart : NaN);
    if (!value.result || typeof input.sceneId !== 'string' || !value.result.scenes.some(scene => scene.id === input.sceneId)
      || input.trackId !== null && !value.result.tracks.some(track => track.id === input.trackId && track.sceneId === input.sceneId)) {
      throw new HttpError(422, 'TRACKING_SELECTION_INVALID', '현재 결과에 존재하는 장면과 대상을 선택해 주세요.');
    }
    assertJob(req, ctx, row);
    if (input.trackId === null) db.prepare('DELETE FROM tracking_full_selections WHERE job_id=? AND scene_id=?').run(row.id, input.sceneId);
    else db.prepare('INSERT INTO tracking_full_selections(job_id,scene_id,track_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(job_id,scene_id) DO UPDATE SET track_id=excluded.track_id,updated_at=excluded.updated_at')
      .run(row.id, input.sceneId, String(input.trackId), new Date().toISOString());
    res.json({ selections: selections(row, value.result) });
  });

  app.get('/api/projects/:id/source', async (req, res, next) => {
    const owner = security.user(req); const projectId = String(req.params.id);
    const version = req.query.version;
    const nestedVersion = Object.keys(req.query).some(name => name.startsWith('version['));
    const versioned = version !== undefined || nestedVersion;
    let ctx = versioned ? context(req) : undefined;
    if (versioned && (nestedVersion || typeof version !== 'string')) throw sourceChanged();
    if (!db.prepare('SELECT 1 FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND source_json IS NOT NULL').get(owner.id, projectId)) {
      if (versioned) throw sourceChanged();
      return next();
    }
    ctx ??= context(req); configured(); const source = currentSource(ctx);
    if (!source) { if (versioned) throw sourceChanged(); return next(); }
    // Matching the server-validated UUID also rejects malformed/unknown versions.
    if (versioned && version !== source.uploadId) throw sourceChanged();
    const value = dictionary(await provider('source/playback', { source })); recheck(req, ctx);
    if (currentSource(ctx)?.uploadId !== source.uploadId) throw sourceChanged();
    res.redirect(307, providerUrl(value.url, options.analysis));
  });
  app.use(prefix, router);
}
