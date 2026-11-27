import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import type { Database } from './database-contract.js';
import { callService, multipartStream, ownedProject, revision, service } from './analysis.js';
import type { AnalysisOptions } from './analysis.js';
import { createSecurity, HttpError } from './security.js';
import { MAX_TRACKING_BYTES, validateTrackingResult } from './tracking-validation.js';
import type { TrackingRange, TrackingResult, TrackingSelection } from './tracking-validation.js';

type Security = ReturnType<typeof createSecurity>;
interface StoredTracking { analysis_id: string; source_revision: string; source_sha256: string; result_json: string; selections_json: string }
const prefix = '/api/tracking/projects/:id';
const read = (db: Database, ownerId: string, projectId: string) => db.prepare('SELECT analysis_id,source_revision,source_sha256,result_json,selections_json FROM project_tracking WHERE owner_id=? AND project_id=?').get(ownerId, projectId) as unknown as StoredTracking | undefined;
const ready = (row: StoredTracking) => ({ state: 'ready' as const, result: JSON.parse(row.result_json) as TrackingResult, selections: JSON.parse(row.selections_json) as TrackingSelection[] });

function analysisRange(query: Record<string, unknown>, duration: number): TrackingRange {
  const parse = (value: unknown) => typeof value === 'string' && value.trim() ? Number(value) : NaN;
  const start = parse(query.start); const end = parse(query.end); const sampleFps = query.sampleFps === undefined ? 2 : parse(query.sampleFps);
  if (![start, end, sampleFps].every(Number.isFinite) || start < 0 || end <= start || end > duration || end - start > 120
    || sampleFps < 1 || sampleFps > 4 || Math.ceil((end - start) * sampleFps) > 240) {
    throw new HttpError(422, 'TRACKING_RANGE_INVALID', '원본 안의 최대 120초·240프레임 구간을 선택해 주세요.');
  }
  return { start, end, sampleFps };
}

export function mountTracking(app: Express, db: Database, security: Security, options?: AnalysisOptions) {
  const inFlight = new Set<string>();
  app.get(prefix, (req, res) => {
    const owner = security.user(req); const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId);
    const row = read(db, owner.id, projectId);
    res.json(!row ? { state: 'missing', result: null, selections: [] }
      : row.source_revision !== revision(source) ? { state: 'stale', result: null, selections: [] } : ready(row));
  });
  app.post(prefix + '/analyze', async (req, res) => {
    const owner = security.user(req); security.verifyMutation(req);
    const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId); const sourceRevision = revision(source);
    const range = analysisRange(req.query, source.duration); service(options);
    if (!['file', 'sample'].includes(source.source) || !source.sourceName) throw new HttpError(409, 'FILE_SOURCE_REQUIRED', '실제 원본 파일이 연결된 영상을 선택해 주세요.');
    if (source.duration > 3600) throw new HttpError(422, 'VIDEO_TOO_LONG', '60분 이하 원본의 구간을 선택해 주세요.');
    const key = `${owner.id}:${projectId}`;
    if (inFlight.has(key)) throw new HttpError(409, 'TRACKING_IN_PROGRESS', '이 영상의 피사체를 분석 중입니다.');
    security.rate(req, `tracking:${owner.id}`); inFlight.add(key);
    try {
      const upload = await multipartStream(req, source.sourceName);
      let payload: Record<string, unknown>;
      try {
        payload = await callService(options, '/api/tracking/analyze?' + new URLSearchParams(Object.entries(range).map(([key, value]) => [key, String(value)])),
          { method: 'POST', headers: { 'Content-Type': upload.contentType }, body: upload.body, duplex: 'half' } as RequestInit, 150_000, MAX_TRACKING_BYTES);
      } catch (error) { throw upload.failure() ?? error; }
      finally { upload.release(); }
      const result: TrackingResult = { ...validateTrackingResult(payload, source.duration, range), analysisId: randomUUID(), sourceRevision, createdAt: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify({ state: 'ready', result, selections: [] }), 'utf8') > MAX_TRACKING_BYTES) throw new HttpError(502, 'TRACKING_RESPONSE_INVALID', '추적 결과가 저장 한도를 초과했습니다.');
      if (security.user(req).id !== owner.id || revision(ownedProject(db, owner.id, projectId)) !== sourceRevision) throw new HttpError(409, 'SOURCE_CHANGED', '분석 중 원본이 변경됐습니다. 다시 분석해 주세요.');
      db.prepare('INSERT INTO project_tracking(owner_id,project_id,analysis_id,source_revision,source_sha256,result_json,selections_json,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,project_id) DO UPDATE SET analysis_id=excluded.analysis_id,source_revision=excluded.source_revision,source_sha256=excluded.source_sha256,result_json=excluded.result_json,selections_json=excluded.selections_json,updated_at=excluded.updated_at')
        .run(owner.id, projectId, result.analysisId, sourceRevision, result.sourceSha256, JSON.stringify(result), '[]', result.createdAt);
      res.json({ state: 'ready', result, selections: [] });
    } finally { inFlight.delete(key); }
  });
  app.put(prefix + '/selection', (req, _res, next) => {
    security.user(req); security.verifyMutation(req);
    if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.');
    next();
  }, express.json({ limit: '16kb' }), (req, res) => {
    const owner = security.user(req); security.verifyMutation(req);
    const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId); const row = read(db, owner.id, projectId);
    if (inFlight.has(`${owner.id}:${projectId}`)) throw new HttpError(409, 'TRACKING_IN_PROGRESS', '분석 완료 후 대상을 선택해 주세요.');
    const body = req.body;
    if (!row || row.source_revision !== revision(source) || !body || typeof body !== 'object' || Array.isArray(body)
      || body.analysisId !== row.analysis_id || body.sourceRevision !== row.source_revision || body.sourceSha256 !== row.source_sha256) {
      throw new HttpError(409, 'TRACKING_CHANGED', '현재 원본의 분석 결과를 다시 불러와 주세요.');
    }
    if (!Array.isArray(body.selections) || body.selections.length > 64) throw new HttpError(422, 'TRACKING_SELECTION_INVALID', '선택한 피사체를 확인해 주세요.');
    const result = JSON.parse(row.result_json) as TrackingResult; const scenes = new Set<string>();
    const selections: TrackingSelection[] = body.selections.map((selection: unknown) => {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new HttpError(422, 'TRACKING_SELECTION_INVALID', '선택한 피사체를 확인해 주세요.');
      const item = selection as Record<string, unknown>;
      if (typeof item.sceneId !== 'string' || typeof item.trackId !== 'string' || scenes.has(item.sceneId)
        || !result.tracks.some(track => track.id === item.trackId && track.sceneId === item.sceneId)) throw new HttpError(422, 'TRACKING_SELECTION_INVALID', '현재 분석에 존재하는 피사체를 장면별로 하나씩 선택해 주세요.');
      scenes.add(item.sceneId); return { sceneId: item.sceneId, trackId: item.trackId };
    });
    db.prepare('UPDATE project_tracking SET selections_json=?,updated_at=? WHERE owner_id=? AND project_id=? AND analysis_id=?')
      .run(JSON.stringify(selections), new Date().toISOString(), owner.id, projectId, row.analysis_id);
    res.json({ state: 'ready', result, selections });
  });
}
