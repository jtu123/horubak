import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { validateTrackingResult } from '../src/tracking-validation.js';

const origin = 'http://127.0.0.1:5173';
const source = { source: 'file', sourceName: 'source.mp4', duration: 60, fileSize: 10 };
const range = { start: 0, end: 10, sampleFps: 2 };
function result() {
  return { schemaVersion: 1, sourceSha256: 'a'.repeat(64), source: { duration: 60, width: 640, height: 360 }, range,
    model: { name: 'opencv-zoo-nanodet', version: '2022nov', sha256: 'b'.repeat(64) },
    scenes: [{ id: 's1', start: 0, end: 10 }],
    tracks: [{ id: 's1-t1', sceneId: 's1', classId: 0, label: 'person', start: 0, end: 1, meanConfidence: 0.9,
      observations: [0, 0.5, 1].map(time => ({ time, bbox: [0.1 + time / 10, 0.2, 0.2, 0.5], confidence: 0.9 })), gaps: [] }],
    recommendations: [{ sceneId: 's1', trackId: 's1-t1', reason: '가장 지속적으로 관측된 대상' }], warnings: [] };
}

test('추적 외부 응답의 크기·시간·좌표·ID 참조를 거부한다', () => {
  assert.equal(validateTrackingResult(result(), 60, range).tracks.length, 1);
  const invalid = (mutate: (value: any) => void) => {
    const payload = result(); mutate(payload);
    assert.throws(() => validateTrackingResult(payload, 60, range), { code: 'TRACKING_RESPONSE_INVALID' });
  };
  invalid(value => { value.tracks[0].observations[0].bbox = [0.9, 0.2, 0.2, 0.5]; });
  invalid(value => { value.tracks[0].observations[0].bbox[0] = NaN; });
  invalid(value => { value.tracks[0].observations.reverse(); });
  invalid(value => { value.tracks[0].sceneId = 'missing'; });
  invalid(value => { value.tracks[0].classId = 80; });
  invalid(value => { value.tracks.push(structuredClone(value.tracks[0])); });
  invalid(value => { value.tracks = Array.from({ length: 13 }, (_, index) => ({ ...value.tracks[0], id: 't' + index })); });
  invalid(value => { value.recommendations[0].trackId = 'missing'; });
  invalid(value => { value.tracks = Array.from({ length: 65 }, (_, index) => ({ ...value.tracks[0], id: 't' + index })); });
  invalid(value => { value.range = { ...range, end: 11 }; });
  invalid(value => { value.source.duration = 120; });
  invalid(value => { value.sourceSha256 = 'invalid'; });
  invalid(value => { value.warnings = [{ code: 'X', message: 'x'.repeat(1_600_000) }]; });
  const empty = result(); empty.tracks = []; empty.recommendations = [];
  assert.equal(validateTrackingResult(empty, 60, range).tracks.length, 0);
  const singleton = result(); singleton.tracks[0].end = 0; singleton.tracks[0].observations = [singleton.tracks[0].observations[0]!];
  assert.equal(validateTrackingResult(singleton, 60, range).tracks[0]!.end, 0);
});

test('추적 인증·결과 저장·선택·원본 변경·재분석 충돌을 실제 HTTP와 임시 DB로 검증한다', async t => {
  const db = openDatabase(':memory:');
  const owner = randomUUID(); const other = randomUUID();
  const token = 'c'.repeat(64); const otherToken = 'd'.repeat(64); const csrf = 'e'.repeat(64);
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  for (const id of [owner, other]) db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, '테스트', id + '@example.test', 'not-used-for-password-login', new Date().toISOString());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), owner, csrf, Date.now() + 600_000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(otherToken), other, csrf, Date.now() + 600_000);
  const projectId = randomUUID();
  const writeSource = (value = source) => db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET document=excluded.document').run(owner, projectId, JSON.stringify(value));
  writeSource();
  let payload: unknown = result(); let afterUpload: (() => void | Promise<void>) | undefined;
  const received: { path: string; auth: boolean; bytes: number }[] = [];
  const python = createServer(async (req, res) => {
    let bytes = 0; for await (const chunk of req) bytes += chunk.length;
    received.push({ path: req.url!, auth: req.headers.authorization === 'Bearer ' + 'f'.repeat(32), bytes });
    await afterUpload?.();
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => python.listen(0, '127.0.0.1', resolve));
  const pythonAddress = python.address(); assert.ok(pythonAddress && typeof pythonAddress !== 'string');
  const app = await createApp(db, { origin, secureCookies: false, rateLimit: 200,
    analysis: { baseUrl: 'http://127.0.0.1:' + pythonAddress.port, serviceToken: 'f'.repeat(32) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/tracking/projects/' + projectId;
  t.after(async () => { await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => python.close(() => resolve()))]); db.close(); });
  const headers = (session = token) => ({ Cookie: 'horubak_session=' + session, Origin: origin, 'X-CSRF-Token': csrf });
  const form = (filename = 'source.mp4') => { const body = new FormData(); body.set('file', new Blob(['video-body']), filename); return body; };
  const analyze = (session = token, query = '?start=0&end=10&sampleFps=2', filename = 'source.mp4', extra: Record<string, string> = {}) => fetch(base + '/analyze' + query, { method: 'POST', headers: { ...headers(session), ...extra }, body: form(filename) });
  const select = (body: unknown, session = token) => fetch(base + '/selection', { method: 'PUT', headers: { ...headers(session), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await analyze('')).status, 401);
  assert.equal((await fetch(base, { headers: headers(otherToken) })).status, 404);
  assert.equal((await analyze(otherToken)).status, 404);
  assert.equal((await analyze(token, undefined, undefined, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await analyze(token, '?start=0&end=121&sampleFps=2')).status, 422);
  assert.equal((await analyze(token, undefined, 'different.mp4')).status, 409);
  assert.deepEqual(await (await fetch(base, { headers: headers() })).json(), { state: 'missing', result: null, selections: [] });
  const response = await analyze(); assert.equal(response.status, 200);
  const ready: any = await response.json();
  assert.equal(ready.state, 'ready'); assert.match(ready.result.analysisId, /^[a-f0-9-]{36}$/);
  assert.equal(ready.result.sourceSha256, 'a'.repeat(64));
  assert.equal(received.length, 1); assert.equal(received[0]!.auth, true); assert.ok(received[0]!.bytes > 10);
  assert.equal(received[0]!.path, '/api/tracking/analyze?start=0&end=10&sampleFps=2');
  const selection = { analysisId: ready.result.analysisId, sourceRevision: ready.result.sourceRevision, sourceSha256: ready.result.sourceSha256, selections: [{ sceneId: 's1', trackId: 's1-t1' }] };
  assert.equal((await select(selection)).status, 200);
  assert.equal((await select(selection, otherToken)).status, 404);
  assert.equal((await select({ ...selection, sourceSha256: '0'.repeat(64) })).status, 409);
  assert.equal((await select({ ...selection, selections: [{ sceneId: 's1', trackId: 'unknown' }] })).status, 422);
  assert.equal((await select({ ...selection, selections: [...selection.selections, ...selection.selections] })).status, 422);
  const restored: any = await (await fetch(base, { headers: headers() })).json(); assert.deepEqual(restored.selections, selection.selections);
  payload = result(); (payload as any).tracks[0].observations[0].bbox = [-1, 0, 0.2, 0.2];
  assert.equal((await analyze()).status, 502);
  assert.equal((await (await fetch(base, { headers: headers() })).json() as any).result.analysisId, ready.result.analysisId);
  payload = result();
  afterUpload = () => { writeSource({ ...source, sourceName: 'changed.mp4' }); };
  assert.equal((await analyze()).status, 409);
  assert.deepEqual(await (await fetch(base, { headers: headers() })).json(), { state: 'stale', result: null, selections: [] });
  afterUpload = undefined; writeSource();
  const newer: any = await (await analyze()).json(); assert.notEqual(newer.result.analysisId, ready.result.analysisId); assert.deepEqual(newer.selections, []);
  assert.equal((await select(selection)).status, 409);
  // A second HTTP request cannot overwrite the same project's in-flight result.
  let release!: () => void; let reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  afterUpload = async () => { reached(); await hold; };
  const first = analyze(); await entered;
  assert.equal((await analyze()).status, 409); release(); assert.equal((await first).status, 200);
  afterUpload = undefined;
  // Public sample bytes use the same owner, filename, range and hash checks.
  writeSource({ ...source, source: 'sample' });
  assert.equal((await analyze()).status, 200);
  afterUpload = () => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); };
  assert.equal((await analyze()).status, 401);
  assert.notEqual((db.prepare('SELECT analysis_id FROM project_tracking WHERE owner_id=? AND project_id=?').get(owner, projectId) as any).analysis_id, ready.result.analysisId);
  db.prepare('DELETE FROM projects WHERE owner_id=? AND id=?').run(owner, projectId);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM project_tracking').get() as any).count, 0);
});
