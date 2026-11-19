import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import type { Express, Request } from 'express';
import type { Database } from './database-contract.js';
import { createSecurity, HttpError } from './security.js';

export interface AnalysisOptions { baseUrl?: string; serviceToken?: string }
interface ProjectSource { source: string; sourceName: string; duration: number; fileSize?: number; sourceUrl?: string; sportsSampleId?: string }
interface TranscriptSegment { id: string; segmentIndex: number; startSeconds: number; endSeconds: number; text: string }
interface TranscriptRow { source_revision: string; source_sha256: string; segments: string }
type Security = ReturnType<typeof createSecurity>;
const MAX_REQUEST_BYTES = 95 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_STORED_BYTES = 750 * 1024;

export function analysisConfigured(options?: AnalysisOptions) {
  return Boolean(options?.baseUrl && options.serviceToken && options.serviceToken.length >= 32);
}

function service(options?: AnalysisOptions) {
  if (!analysisConfigured(options)) throw new HttpError(503, 'ANALYSIS_NOT_CONFIGURED', '분석 서버가 아직 연결되지 않았습니다.');
  const url = new URL(options!.baseUrl!);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new HttpError(503, 'ANALYSIS_CONFIG_INVALID', '분석 서버 연결 설정을 확인해 주세요.');
  }
  return { url, token: options!.serviceToken! };
}

function ownedProject(db: Database, ownerId: string, projectId: string): ProjectSource {
  const row = db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=? AND archived_at IS NULL').get(ownerId, projectId) as { document: string } | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  const source = JSON.parse(row.document) as ProjectSource;
  if (!Number.isFinite(source.duration) || source.duration <= 0) throw new HttpError(409, 'SOURCE_DURATION_REQUIRED', '원본 영상의 길이를 먼저 확인해 주세요.');
  return source;
}

function revision(source: ProjectSource) {
  return createHash('sha256').update(JSON.stringify([source.source, source.sourceName, source.duration, source.fileSize ?? null, source.sourceUrl ?? null, source.sportsSampleId ?? null])).digest('hex');
}

function dictionary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(502, 'ANALYSIS_RESPONSE_INVALID', '분석 서버의 응답 형식을 확인하지 못했습니다.');
  return value as Record<string, unknown>;
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

async function responseJson(response: globalThis.Response) {
  if (!response.ok) {
    await response.body?.cancel();
    const status = [400, 413, 422, 429, 503, 504].includes(response.status) ? response.status : 502;
    const messages: Record<number, string> = {
      400: '분석할 영상과 구간을 확인해 주세요.', 413: '데모에서 분석할 수 있는 파일 크기를 초과했습니다.',
      422: '영상 또는 전사 구간을 분석하지 못했습니다.', 429: '분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
      503: '분석 모델 또는 API 연결이 준비되지 않았습니다.', 504: '분석 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.',
      502: '분석 서버에 연결하지 못했습니다.',
    };
    throw new HttpError(status, 'ANALYSIS_SERVICE_FAILED', messages[status]!);
  }
  if (!response.body) throw new HttpError(502, 'ANALYSIS_RESPONSE_INVALID', '분석 서버의 응답이 비어 있습니다.');
  const reader = response.body.getReader(); let total = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      total += item.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new HttpError(502, 'ANALYSIS_RESPONSE_TOO_LARGE', '분석 결과가 저장 한도를 초과했습니다.');
      chunks.push(item.value);
    }
    const bytes = Buffer.concat(chunks);
    try { return dictionary(JSON.parse(bytes.toString('utf8'))); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, 'ANALYSIS_RESPONSE_INVALID', '분석 서버의 응답을 읽지 못했습니다.'); }
  } finally { await reader.cancel().catch(() => undefined); }
}

async function callService(options: AnalysisOptions | undefined, path: string, init: RequestInit, timeout: number) {
  const target = service(options);
  try {
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${target.token}`);
    const response = await fetch(new URL(path, target.url), { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    return await responseJson(response);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new HttpError(504, 'ANALYSIS_TIMEOUT', '분석 시간이 초과됐습니다.');
    throw new HttpError(502, 'ANALYSIS_UNREACHABLE', '분석 서버에 연결하지 못했습니다.');
  }
}

// The video is streamed to the private service. It is never buffered in the
// Worker or placed in publicly accessible storage.
async function multipartStream(req: Request, filename: string) {
  const contentType = req.get('content-type') ?? '';
  const boundary = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundary || (boundary[1] ?? boundary[2]!).length > 200) throw new HttpError(415, 'MULTIPART_REQUIRED', '원본 영상 파일을 선택해 주세요.');
  const length = Number(req.get('content-length'));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', '데모에서는 94MB 이하 파일을 분석할 수 있습니다.');
  const iterator = req[Symbol.asyncIterator](); const initial: Uint8Array[] = []; let bytes = 0; let header = Buffer.alloc(0);
  try {
    while (!header.includes('\r\n\r\n')) {
      const part = await iterator.next();
      if (part.done) throw new HttpError(400, 'INVALID_UPLOAD', '원본 영상 파일이 비어 있습니다.');
      const chunk = Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value);
      bytes += chunk.byteLength;
      if (bytes > MAX_REQUEST_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', '데모에서는 94MB 이하 파일을 분석할 수 있습니다.');
      initial.push(chunk); header = Buffer.concat([header, chunk]);
      const headerEnd = header.indexOf('\r\n\r\n');
      if ((headerEnd < 0 && header.length > 16 * 1024) || headerEnd > 16 * 1024) throw new HttpError(400, 'INVALID_UPLOAD', '파일 요청 형식을 확인해 주세요.');
    }
    const prefix = header.subarray(0, header.indexOf('\r\n\r\n')).toString('utf8');
    const disposition = /content-disposition:\s*form-data;\s*name="file";\s*filename="((?:\\.|[^"\r\n])*)"/i.exec(prefix);
    const actualFilename = disposition?.[1]?.replace(/\\([\\"])/g, '$1').normalize('NFC');
    if (!disposition || actualFilename !== filename.normalize('NFC') || !prefix.startsWith(`--${boundary[1] ?? boundary[2]}\r\n`)) {
      throw new HttpError(409, 'SOURCE_MISMATCH', '이 프로젝트에 등록한 원본 파일을 선택해 주세요.');
    }
  } catch (error) { req.resume(); throw error; }
  let index = 0;
  let failure: HttpError | undefined;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index < initial.length) { controller.enqueue(initial[index++]!); return; }
        const part = await iterator.next();
        if (part.done) { controller.close(); return; }
        const chunk = Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value);
        bytes += chunk.byteLength;
        if (bytes > MAX_REQUEST_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', '데모에서는 94MB 이하 파일을 분석할 수 있습니다.');
        controller.enqueue(chunk);
      } catch (error) { if (error instanceof HttpError) failure = error; controller.error(error); req.resume(); }
    },
    cancel() { req.resume(); },
  });
  return { body, contentType, failure: () => failure, release: () => req.resume() };
}

function transcript(payload: Record<string, unknown>, duration: number): TranscriptSegment[] {
  if (!Array.isArray(payload.segments) || payload.segments.length > 10_000) throw new HttpError(502, 'TRANSCRIPT_INVALID', '전사 결과 형식을 확인하지 못했습니다.');
  let previousStart = -1;
  const segments = payload.segments.map((value, segmentIndex) => {
    const row = dictionary(value);
    if (!finite(row.start) || !finite(row.end) || row.start < 0 || row.end <= row.start || row.start < previousStart || row.start >= duration || row.end > duration + 0.5 || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 4000) {
      throw new HttpError(502, 'TRANSCRIPT_INVALID', '전사의 시간 정보가 원본과 맞지 않습니다.');
    }
    previousStart = row.start;
    return { id: randomUUID(), segmentIndex, startSeconds: row.start, endSeconds: Math.min(row.end, duration), text: row.text.trim() };
  });
  if (Buffer.byteLength(JSON.stringify(segments), 'utf8') > MAX_STORED_BYTES) throw new HttpError(422, 'TRANSCRIPT_TOO_LARGE', '전사가 데모 저장 한도를 초과했습니다. 더 짧은 영상을 사용해 주세요.');
  return segments;
}

function contextResult(payload: Record<string, unknown>, start: number, end: number, duration: number) {
  const status = payload.status;
  if (typeof status !== 'string' || !['keep', 'expand', 'review'].includes(status) || typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.length > 2000 || !finite(payload.originalStartSeconds) || !finite(payload.originalEndSeconds) || Math.abs(payload.originalStartSeconds - start) > 0.000001 || Math.abs(payload.originalEndSeconds - end) > 0.000001) {
    throw new HttpError(502, 'CONTEXT_RESPONSE_INVALID', '맥락 검토 결과가 현재 구간과 맞지 않습니다.');
  }
  let suggestion: { startSeconds: number; endSeconds: number; durationSeconds: number } | null = null;
  if (payload.suggestion !== null && payload.suggestion !== undefined) {
    const range = dictionary(payload.suggestion);
    if (!finite(range.startSeconds) || !finite(range.endSeconds) || !finite(range.durationSeconds) || range.startSeconds < 0 || range.endSeconds > duration || range.startSeconds > start || range.endSeconds < end || range.endSeconds - range.startSeconds < 30 || range.endSeconds - range.startSeconds > 60 || Math.abs(range.durationSeconds - (range.endSeconds - range.startSeconds)) > 0.01) {
      throw new HttpError(502, 'CONTEXT_RESPONSE_INVALID', '보정안의 시간 범위를 확인하지 못했습니다.');
    }
    suggestion = { startSeconds: range.startSeconds, endSeconds: range.endSeconds, durationSeconds: range.durationSeconds };
  }
  if ((status === 'expand') !== Boolean(suggestion)) throw new HttpError(502, 'CONTEXT_RESPONSE_INVALID', '보정안의 상태를 확인하지 못했습니다.');
  return { status, reason: payload.reason, originalStartSeconds: start, originalEndSeconds: end, suggestion };
}

export function mountAnalysis(app: Express, db: Database, security: Security, options?: AnalysisOptions) {
  const inFlight = new Set<string>();
  const prefix = '/api/transcripts/projects/:id';
  app.get(prefix, (req, res) => {
    const owner = security.user(req); const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId);
    const row = db.prepare('SELECT source_revision,source_sha256,segments FROM project_transcripts WHERE owner_id=? AND project_id=?').get(owner.id, projectId) as unknown as TranscriptRow | undefined;
    res.json(row?.source_revision === revision(source) ? JSON.parse(row.segments) : []);
  });
  app.post(prefix + '/analyze', async (req, res) => {
    const owner = security.user(req); security.verifyMutation(req);
    const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId); const sourceRevision = revision(source);
    service(options);
    if (source.source !== 'file' || !source.sourceName) throw new HttpError(409, 'FILE_SOURCE_REQUIRED', '파일로 등록한 원본 영상을 선택해 주세요.');
    if (source.duration > 3600) throw new HttpError(422, 'VIDEO_TOO_LONG', '데모에서는 60분 이하 영상을 분석할 수 있습니다.');
    const key = `${owner.id}:${projectId}`;
    if (inFlight.has(key)) throw new HttpError(409, 'ANALYSIS_IN_PROGRESS', '이 영상의 분석이 진행 중입니다.');
    security.rate(req, `analysis:${owner.id}`); inFlight.add(key);
    try {
      const upload = await multipartStream(req, source.sourceName);
      let payload: Record<string, unknown>;
      try { payload = await callService(options, '/api/stt/transcribe', { method: 'POST', headers: { 'Content-Type': upload.contentType }, body: upload.body, duplex: 'half' } as RequestInit, 15 * 60_000); }
      catch (error) { throw upload.failure() ?? error; }
      finally { upload.release(); }
      const segments = transcript(payload, source.duration);
      if (typeof payload.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sourceSha256)) throw new HttpError(502, 'SOURCE_DIGEST_INVALID', '분석한 원본의 정보를 확인하지 못했습니다.');
      if (security.user(req).id !== owner.id || revision(ownedProject(db, owner.id, projectId)) !== sourceRevision) throw new HttpError(409, 'SOURCE_CHANGED', '분석 중 원본이 변경됐습니다. 다시 분석해 주세요.');
      db.prepare('INSERT INTO project_transcripts(owner_id,project_id,source_revision,source_sha256,segments,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,project_id) DO UPDATE SET source_revision=excluded.source_revision,source_sha256=excluded.source_sha256,segments=excluded.segments,updated_at=excluded.updated_at')
        .run(owner.id, projectId, sourceRevision, payload.sourceSha256, JSON.stringify(segments), new Date().toISOString());
      res.json(segments);
    } finally { inFlight.delete(key); }
  });
  app.post(prefix + '/context-check', (req, _res, next) => {
    security.user(req); security.verifyMutation(req);
    if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.');
    next();
  }, express.json({ limit: '1kb' }), async (req, res) => {
    const owner = security.user(req); security.verifyMutation(req);
    if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.');
    const projectId = String(req.params.id); const source = ownedProject(db, owner.id, projectId); const sourceRevision = revision(source);
    const start = typeof req.query.start === 'string' && req.query.start.trim() ? Number(req.query.start) : NaN;
    const end = typeof req.query.end === 'string' && req.query.end.trim() ? Number(req.query.end) : NaN;
    if (!finite(start) || !finite(end) || start < 0 || end > source.duration || end - start < 30 || end - start > 60) throw new HttpError(400, 'INVALID_CLIP_RANGE', '맥락 검토는 원본 안의 30~60초 구간에서 사용할 수 있습니다.');
    const row = db.prepare('SELECT source_revision,source_sha256,segments FROM project_transcripts WHERE owner_id=? AND project_id=?').get(owner.id, projectId) as unknown as TranscriptRow | undefined;
    if (!row || row.source_revision !== sourceRevision) throw new HttpError(409, 'TRANSCRIPT_REQUIRED', '현재 원본의 전사를 먼저 생성해 주세요.');
    const segments = JSON.parse(row.segments) as TranscriptSegment[];
    if (!segments.length) throw new HttpError(422, 'TRANSCRIPT_EMPTY', '전사에서 검토할 발화를 찾지 못했습니다.');
    security.rate(req, `context:${owner.id}`);
    const payload = await callService(options, '/api/highlights/context-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startSeconds: start, endSeconds: end, segments: segments.map(({ segmentIndex, startSeconds, endSeconds, text }) => ({ segmentIndex, startSeconds, endSeconds, text })) }) }, 120_000);
    if (security.user(req).id !== owner.id || revision(ownedProject(db, owner.id, projectId)) !== sourceRevision) throw new HttpError(409, 'SOURCE_CHANGED', '검토 중 원본이 변경됐습니다. 다시 검토해 주세요.');
    const current = db.prepare('SELECT source_sha256,segments FROM project_transcripts WHERE owner_id=? AND project_id=?').get(owner.id, projectId) as { source_sha256: string; segments: string } | undefined;
    if (current?.source_sha256 !== row.source_sha256 || current.segments !== row.segments) throw new HttpError(409, 'TRANSCRIPT_CHANGED', '검토 중 전사가 변경됐습니다. 다시 검토해 주세요.');
    res.json(contextResult(payload, start, end, source.duration));
  });
}
