import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express, Request } from 'express';
import type { Database } from './database-contract.js';
import { callService, contextResult, ownedProject, revision } from './analysis.js';
import type { AnalysisOptions } from './analysis.js';
import { fullTrackingConfigured } from './full-tracking.js';
import { dictionary, MAX_SOURCE_SECONDS, sourceResult } from './full-tracking-contract.js';
import type { FullSource } from './full-tracking-contract.js';
import { activeTranscription, MAX_TRANSCRIPT_WINDOW_BYTES, transcriptionJob, transcriptionWindow } from './full-transcription-contract.js';
import type { FullTranscriptionJob } from './full-transcription-contract.js';
import { createSecurity, HttpError } from './security.js';

interface JobRow {
  id: string; owner_id: string; project_id: string; source_revision: string; upload_id: string;
  source_json: string; job_json: string; provisioned: number; created_at: string;
}
interface Control {
  pendingRun?: string | null; pendingSince?: number; cancelRequested?: boolean;
  pendingCancel?: string | null; pendingCancelSince?: number;
}
const changed = () => new HttpError(409, 'SOURCE_CHANGED', '원본이 변경됐습니다. 현재 원본으로 전사해 주세요.');
const missing = () => new HttpError(404, 'NOT_FOUND', '프로젝트 또는 전사 작업을 찾지 못했습니다.');
const busy = () => new HttpError(409, 'TRANSCRIPTION_IN_PROGRESS', '실행 중인 전사를 중단한 뒤 원본을 변경해 주세요.');

export function mountFullTranscription(app: Express, db: Database, security: ReturnType<typeof createSecurity>, options: { analysis?: AnalysisOptions; origin: string }) {
  const router = express.Router({ mergeParams: true });
  const context = (req: Request) => {
    const ownerId = security.user(req).id, projectId = String(req.params.id), project = ownedProject(db, ownerId, projectId);
    if (project.duration > MAX_SOURCE_SECONDS) throw new HttpError(422, 'VIDEO_TOO_LONG', '전사는 최대 10시간 이하 원본을 지원합니다.');
    return { ownerId, projectId, project, sourceRevision: revision(project) };
  };
  type Context = ReturnType<typeof context>;
  const configured = () => { if (!fullTrackingConfigured(options.analysis)) throw new HttpError(503, 'FULL_TRANSCRIPTION_NOT_CONFIGURED', '전체 영상 전사 저장소와 작업 서버가 아직 연결되지 않았습니다.'); };
  const provider = (action: string, input: unknown, maximum = 128 * 1024, timeout = 60000) => callService(options.analysis, '/api/transcripts/full/jobs/' + action,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }, timeout, maximum);
  const sourceFor = (ctx: Context) => {
    const row = db.prepare('SELECT source_json FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND source_revision=? AND source_json IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1')
      .get(ctx.ownerId, ctx.projectId, ctx.sourceRevision);
    if (!row) return null;
    const source = sourceResult(JSON.parse(String(row.source_json)));
    if (source.objectKey !== `originals/${ctx.ownerId}/${ctx.projectId}/${source.uploadId}`) throw changed();
    return source;
  };
  const latest = (ctx: Context) => db.prepare('SELECT * FROM transcript_full_jobs WHERE owner_id=? AND project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1')
    .get(ctx.ownerId, ctx.projectId) as unknown as JobRow | undefined;
  const bound = (ctx: Context, id: string) => {
    const row = db.prepare('SELECT * FROM transcript_full_jobs WHERE owner_id=? AND project_id=? AND id=?').get(ctx.ownerId, ctx.projectId, id) as unknown as JobRow | undefined;
    if (!row) throw missing();
    const source = sourceFor(ctx);
    if (row.source_revision !== ctx.sourceRevision || !source || source.uploadId !== row.upload_id || JSON.stringify(source) !== row.source_json) throw changed();
    return row;
  };
  const recheck = (req: Request, ctx: Context, row: JobRow) => {
    const current = context(req);
    if (current.ownerId !== ctx.ownerId || current.sourceRevision !== ctx.sourceRevision) throw changed();
    return bound(current, row.id);
  };
  const liveRow = (row: JobRow) => {
    const current = db.prepare('SELECT * FROM transcript_full_jobs WHERE owner_id=? AND project_id=? AND id=?').get(row.owner_id, row.project_id, row.id) as unknown as JobRow | undefined;
    if (!current) throw missing();
    return current;
  };
  const control = (row: JobRow): Control => JSON.parse(row.job_json)._control ?? {};
  const cachedJob = (row: JobRow) => transcriptionJob(JSON.parse(row.job_json), row.id, JSON.parse(row.source_json));
  // Keep cancellation intent outside the public provider state. A late preparation
  // response must not overwrite it or start a runner after cancellation returned.
  const cache = (row: JobRow, value: FullTranscriptionJob, provisioned = row.provisioned, change?: (value: Control) => Control) => db.transaction(() => {
    const current = liveRow(row); const existing = cachedJob(current);
    const intent = change ? change(control(current)) : control(current);
    const ready = Math.max(current.provisioned, provisioned);
    const job = intent.cancelRequested && !['cancelled', 'completed'].includes(value.state)
      ? { ...value, state: !ready || existing.state === 'cancelled' || ['failed', 'interrupted'].includes(value.state) ? 'cancelled' as const : 'cancelling' as const, error: null }
      : value;
    db.prepare('UPDATE transcript_full_jobs SET job_json=?,provisioned=?,updated_at=? WHERE id=? AND owner_id=? AND project_id=?')
      .run(JSON.stringify({ ...job, _control: intent }), ready, new Date().toISOString(), row.id, row.owner_id, row.project_id);
    return job;
  });
  const pending = (id: string | null | undefined, since = 0) => Boolean(id && Date.now() - since < 5 * 60000);
  const cancelProvider = async (req: Request, ctx: Context, row: JobRow) => {
    const current = recheck(req, ctx, row), previous = control(current);
    if (!previous.cancelRequested || pending(previous.pendingCancel, previous.pendingCancelSince)) return cachedJob(current);
    const token = randomUUID();
    cache(current, cachedJob(current), current.provisioned, value => ({ ...value, pendingCancel: token, pendingCancelSince: Date.now() }));
    try {
      const reserved = recheck(req, ctx, row);
      if (control(reserved).pendingCancel !== token || !control(reserved).cancelRequested) return cachedJob(reserved);
      const value = await provider('cancel', { jobId: row.id }); recheck(req, ctx, row);
      return cache(current, transcriptionJob(value, row.id, JSON.parse(row.source_json)));
    } finally {
      const remaining = liveRow(row);
      if (control(remaining).pendingCancel === token) cache(remaining, cachedJob(remaining), remaining.provisioned, value => ({ ...value, pendingCancel: null }));
    }
  };
  const refresh = async (req: Request, ctx: Context, row: JobRow) => {
    const current = recheck(req, ctx, row);
    const source = JSON.parse(current.source_json) as FullSource;
    if (!current.provisioned) return cachedJob(current);
    if (control(current).cancelRequested && activeTranscription(cachedJob(current))) return cancelProvider(req, ctx, row);
    const value = await provider('status', { jobId: row.id }); recheck(req, ctx, row);
    return cache(current, transcriptionJob(value, row.id, source));
  };
  const prepareRun = (row: JobRow) => {
    const token = randomUUID();
    cache(row, { ...cachedJob(liveRow(row)), state: 'queued', error: null }, row.provisioned, previous => {
      if (pending(previous.pendingRun, previous.pendingSince) || pending(previous.pendingCancel, previous.pendingCancelSince)) throw new HttpError(409, 'JOB_OPERATION_PENDING', '이 전사 작업의 요청을 처리 중입니다. 상태를 다시 확인해 주세요.');
      return { pendingRun: token, pendingSince: Date.now(), cancelRequested: false };
    });
    return token;
  };
  const clearPending = (row: JobRow, token: string) => {
    const current = liveRow(row);
    if (control(current).pendingRun === token) cache(current, cachedJob(current), current.provisioned, previous => ({ ...previous, pendingRun: null }));
  };
  const dispatchPrepared = async (req: Request, ctx: Context, row: JobRow, token: string, value: unknown) => {
    recheck(req, ctx, row);
    cache(row, transcriptionJob(value, row.id, JSON.parse(row.source_json)), 1);
    const cancelIfRequested = async () => {
      const current = recheck(req, ctx, row);
      if (!control(current).cancelRequested) return null;
      return cancelProvider(req, ctx, current);
    };
    const cancelled = await cancelIfRequested(); if (cancelled) return cancelled;
    if (control(liveRow(row)).pendingRun !== token) return cachedJob(liveRow(row));
    await provider('dispatch', { jobId: row.id }); recheck(req, ctx, row);
    return await cancelIfRequested() ?? cachedJob(liveRow(row));
  };
  const noPendingUpload = (ctx: Context, source: FullSource) => {
    const newest = db.prepare('SELECT upload_id,source_json,session_json FROM tracking_source_uploads WHERE owner_id=? AND project_id=? AND source_revision=? ORDER BY created_at DESC,rowid DESC LIMIT 1')
      .get(ctx.ownerId, ctx.projectId, ctx.sourceRevision);
    if (newest && newest.upload_id !== source.uploadId && !newest.source_json && Date.parse(JSON.parse(String(newest.session_json)).expiresAt) > Date.now()) {
      throw new HttpError(409, 'SOURCE_UPLOAD_PENDING', '새 원본의 업로드를 완료한 뒤 전사를 시작해 주세요.');
    }
  };
  const mutation = [
    (req: Request, _res: express.Response, next: express.NextFunction) => { context(req); security.verifyMutation(req); configured(); if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.'); next(); },
    express.json({ limit: '1kb' }),
    (req: Request, _res: express.Response, next: express.NextFunction) => { if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new HttpError(400, 'INVALID_INPUT', '원본 파일 대신 저장된 원본으로 전사를 요청해 주세요.'); next(); },
  ];
  router.get('/jobs/latest', async (req, res) => {
    const ctx = context(req); configured(); const row = latest(ctx); const source = sourceFor(ctx);
    if (!row || row.source_revision !== ctx.sourceRevision || row.upload_id !== source?.uploadId || row.source_json !== JSON.stringify(source)) return res.json({ job: null });
    res.json({ job: await refresh(req, ctx, row) });
  });
  router.post('/jobs', ...mutation, async (req, res) => {
    const ctx = context(req), source = sourceFor(ctx);
    if (!source) throw new HttpError(409, 'SOURCE_UPLOAD_REQUIRED', '원본 업로드를 완료한 뒤 전체 전사를 시작해 주세요.');
    noPendingUpload(ctx, source);
    const existing = latest(ctx);
    if (existing && existing.source_revision === ctx.sourceRevision && existing.source_json === JSON.stringify(source)) {
      const job = await refresh(req, ctx, existing); if (activeTranscription(job)) return res.status(202).json({ job });
    }
    security.rate(req, 'full-transcription:' + ctx.ownerId);
    const id = randomUUID(), created = new Date().toISOString();
    const initial: FullTranscriptionJob = { id, source, state: 'queued', processedSeconds: 0, duration: source.duration, chunkSeconds: 300,
      completedChunks: 0, totalChunks: Math.ceil(source.duration / 300), segmentCount: 0, sourceSha256: null, error: null, createdAt: created, updatedAt: created };
    const joined = db.transaction(() => {
      if (revision(ownedProject(db, ctx.ownerId, ctx.projectId)) !== ctx.sourceRevision || JSON.stringify(sourceFor(ctx)) !== JSON.stringify(source)) throw changed();
      noPendingUpload(ctx, source);
      const concurrent = latest(ctx);
      if (concurrent && concurrent.id !== existing?.id && concurrent.source_revision === ctx.sourceRevision && concurrent.source_json === JSON.stringify(source)
        && activeTranscription(JSON.parse(concurrent.job_json))) return concurrent;
      db.prepare('INSERT INTO transcript_full_jobs(id,owner_id,project_id,source_revision,upload_id,source_json,job_json,provisioned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, ctx.ownerId, ctx.projectId, ctx.sourceRevision, source.uploadId, JSON.stringify(source), JSON.stringify(initial), 0, created, created);
      return null;
    });
    if (joined) return res.status(202).json({ job: await refresh(req, ctx, joined) });
    const row = bound(ctx, id); const token = prepareRun(row);
    try {
      const value = await provider('create', { jobId: id, source }); recheck(req, ctx, row);
      const job = await dispatchPrepared(req, ctx, row, token, value); res.status(202).json({ job });
    } catch (error) {
      const current = liveRow(row);
      if (!current.provisioned && control(current).pendingRun === token) cache(row, { ...initial, state: 'failed', error: { code: 'JOB_CREATE_FAILED', message: '전사 작업을 등록하지 못했습니다. 다시 시도해 주세요.' } });
      throw error;
    } finally { clearPending(row, token); }
  });
  router.get('/jobs/:jobId', async (req, res) => { const ctx = context(req); configured(); res.json({ job: await refresh(req, ctx, bound(ctx, String(req.params.jobId))) }); });
  router.post('/jobs/:jobId/cancel', ...mutation, async (req, res) => {
    const ctx = context(req), row = bound(ctx, String(req.params.jobId)), current = cachedJob(row);
    if (!activeTranscription(current) && !control(row).pendingRun) return res.json({ job: await refresh(req, ctx, row) });
    cache(row, current, row.provisioned, previous => ({ ...previous, cancelRequested: true }));
    res.json({ job: await refresh(req, ctx, row) });
  });
  router.post('/jobs/:jobId/resume', ...mutation, async (req, res) => {
    const ctx = context(req), row = bound(ctx, String(req.params.jobId)), current = await refresh(req, ctx, row);
    if (!['failed', 'interrupted', 'cancelled'].includes(current.state)) throw new HttpError(409, 'JOB_NOT_RESUMABLE', '중단되거나 실패한 작업만 이어서 전사할 수 있습니다.');
    const newest = latest(ctx);
    if (newest?.id !== row.id) throw new HttpError(409, 'TRANSCRIPT_CHANGED', '최신 전사 작업을 확인해 주세요.');
    const intent = control(liveRow(row));
    if (pending(intent.pendingRun, intent.pendingSince) || pending(intent.pendingCancel, intent.pendingCancelSince)) throw new HttpError(409, 'JOB_OPERATION_PENDING', '이 전사 작업의 요청을 처리 중입니다. 상태를 다시 확인해 주세요.');
    if (row.provisioned && intent.cancelRequested) await cancelProvider(req, ctx, row);
    const token = prepareRun(row);
    try {
      const value = await provider(row.provisioned ? 'resume' : 'create', row.provisioned ? { jobId: row.id } : { jobId: row.id, source: JSON.parse(row.source_json) });
      res.status(202).json({ job: await dispatchPrepared(req, ctx, row, token, value) });
    } catch (error) {
      const current = liveRow(row);
      if (!current.provisioned && control(current).pendingRun === token) cache(current, { ...cachedJob(current), state: 'failed', error: { code: 'JOB_CREATE_FAILED', message: '전사 작업을 등록하지 못했습니다. 다시 시도해 주세요.' } });
      throw error;
    } finally { clearPending(row, token); }
  });
  router.get('/jobs/:jobId/window', async (req, res) => {
    const ctx = context(req); configured(); const row = bound(ctx, String(req.params.jobId));
    const start = typeof req.query.start === 'string' && req.query.start.trim() ? Number(req.query.start) : NaN;
    const source = JSON.parse(row.source_json) as FullSource;
    if (!Number.isFinite(start) || start < 0 || start >= source.duration) throw new HttpError(422, 'TRANSCRIPT_RANGE_INVALID', '원본 안의 전사 위치를 선택해 주세요.');
    let job = await refresh(req, ctx, row);
    const value = dictionary(await provider('window', { jobId: row.id, start }, MAX_TRANSCRIPT_WINDOW_BYTES + 16 * 1024)); recheck(req, ctx, row);
    if (value.state === 'pending' && value.window === null && job.completedChunks <= Math.floor(start / 300)) {
      return res.json({ job, sourceRevision: ctx.sourceRevision, state: 'pending', window: null });
    }
    if (value.state !== 'ready') throw new HttpError(502, 'TRANSCRIPTION_RESPONSE_INVALID', '전사 구간의 상태를 확인하지 못했습니다.');
    if (!job.sourceSha256 || Math.min(source.duration, (Math.floor(start / 300) + 1) * 300) > job.processedSeconds + .001) job = await refresh(req, ctx, row);
    const window = transcriptionWindow(value.window, job, start);
    res.json({ job, sourceRevision: ctx.sourceRevision, state: 'ready', window });
  });
  // New, split transcripts take precedence; old projects retain their legacy path.
  router.post('/context-check', (req, _res, next) => {
    const ctx = context(req); if (!latest(ctx)) return next('router');
    security.verifyMutation(req); configured(); if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.'); next();
  }, express.json({ limit: '1kb' }), async (req, res) => {
    const ctx = context(req), row = bound(ctx, latest(ctx)!.id);
    const duration = (JSON.parse(row.source_json) as FullSource).duration;
    const input = req.body;
    const expectedId = input && typeof input === 'object' && !Array.isArray(input) ? input.expectedJobId : undefined;
    const expectedSha = input && typeof input === 'object' && !Array.isArray(input) ? input.expectedSourceSha256 : undefined;
    const assertExpected = (value: JobRow | undefined, allowUnobserved = false) => {
      const storedSha = value ? cachedJob(value).sourceSha256 : null;
      if (!value || expectedId !== value.id || typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha)
        || storedSha !== expectedSha && !(allowUnobserved && storedSha === null)) {
        throw new HttpError(409, 'TRANSCRIPT_CHANGED', '화면의 전사와 현재 전사가 다릅니다. 전사를 다시 불러온 뒤 검토해 주세요.');
      }
    };
    assertExpected(row, true);
    const start = typeof req.query.start === 'string' && req.query.start.trim() ? Number(req.query.start) : NaN;
    const end = typeof req.query.end === 'string' && req.query.end.trim() ? Number(req.query.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end - start < 30 || end - start > 60) throw new HttpError(400, 'INVALID_CLIP_RANGE', '맥락 검토는 원본 안의 30~60초 구간에서 사용할 수 있습니다.');
    const job = await refresh(req, ctx, row);
    assertExpected(latest(ctx));
    if (job.state !== 'completed') throw new HttpError(409, 'TRANSCRIPT_NOT_READY', '현재 원본의 전체 전사가 완료된 뒤 맥락을 검토해 주세요.');
    security.rate(req, 'context:' + ctx.ownerId);
    const value = await provider('context', { jobId: row.id, start, end }, 128 * 1024, 120000);
    recheck(req, ctx, row);
    assertExpected(latest(ctx));
    res.json(contextResult(value, start, end, duration));
  });
  app.use('/api/transcripts/projects/:id', router);
  return {
    beforeSourceChange: async (req: Request) => {
      const ctx = context(req);
      const rows = db.prepare("SELECT * FROM transcript_full_jobs WHERE owner_id=? AND project_id=? AND source_revision=? AND json_extract(job_json,'$.state') IN ('queued','running','cancelling')")
        .all(ctx.ownerId, ctx.projectId, ctx.sourceRevision) as unknown as JobRow[];
      for (const row of rows) if (activeTranscription(await refresh(req, ctx, row))) throw busy();
    },
    assertNoReservedSourceChange: (ownerId: string, projectId: string, sourceRevision: string) => {
      if (db.prepare("SELECT 1 FROM transcript_full_jobs WHERE owner_id=? AND project_id=? AND source_revision=? AND json_extract(job_json,'$.state') IN ('queued','running','cancelling') LIMIT 1")
        .get(ownerId, projectId, sourceRevision)) throw busy();
    },
  };
}
