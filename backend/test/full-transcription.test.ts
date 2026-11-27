import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { revision } from '../src/analysis.js';
import { transcriptionJob, transcriptionWindow } from '../src/full-transcription-contract.js';

const origin = 'http://127.0.0.1:5173';
const token = 'test-provider-' + 'a'.repeat(40);
const date = () => new Date().toISOString();

async function fixture(t: TestContext, duration = 36000, size = 4 * 1024 ** 3) {
  const db = openDatabase(':memory:');
  const owner = randomUUID(), other = randomUUID(), projectId = randomUUID();
  const session = 'b'.repeat(64), otherSession = 'c'.repeat(64), csrf = 'd'.repeat(64);
  for (const id of [owner, other]) db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, '테스트', id + '@example.invalid', 'unused', date());
  for (const [value, id] of [[session, owner], [otherSession, other]]) db.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
    .run(createHash('sha256').update(value!).digest('hex'), id!, csrf, Date.now() + 600000);
  const metadata = { source: 'file', sourceName: 'source.mp4', fileSize: size, duration };
  db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?)').run(owner, projectId, JSON.stringify(metadata));
  let source: any;
  const replaceSource = () => {
    const uploadId = randomUUID();
    source = { uploadId, filename: 'source.mp4', size, duration, width: 1920, height: 1080,
      objectKey: `originals/${owner}/${projectId}/${uploadId}`, generation: '123', checksum: 'test-crc==' };
    db.prepare('DELETE FROM tracking_source_uploads WHERE owner_id=? AND project_id=?').run(owner, projectId);
    db.prepare('INSERT INTO tracking_source_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(owner, projectId, uploadId, revision(metadata), 'source.mp4', size, 'video/mp4', '{}', JSON.stringify(source), date(), date());
    return source;
  };
  replaceSource();
  const jobs = new Map<string, any>();
  const calls: { action: string; input: any }[] = [];
  let after: ((action: string, input: any) => void | Promise<void>) | undefined;
  let before: ((action: string, input: any) => void | Promise<void>) | undefined;
  let providerOrigin = '';
  let mutateWindow: ((value: any) => any) | undefined;
  let largeWindow = false;
  let failCreate = false;
  const provider = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    let raw = ''; for await (const part of req) raw += part;
    assert.ok(raw.length < 16 * 1024, 'Original bytes must not enter the control request');
    const input = JSON.parse(raw || '{}');
    const action = req.url!.replace('/api/transcripts/full/jobs/', '');
    calls.push({ action, input });
    await before?.(action, input);
    let value: any;
    if (action === 'create') {
      assert.deepEqual(input.source, source);
      if (!jobs.has(input.jobId)) jobs.set(input.jobId, { id: input.jobId, state: 'queued', source: input.source, duration, processedSeconds: 0,
        chunkSeconds: 300, completedChunks: 0, totalChunks: Math.ceil(duration / 300), segmentCount: 0, sourceSha256: null, error: null, createdAt: date(), updatedAt: date() });
      value = jobs.get(input.jobId);
    } else if (action === 'dispatch') { jobs.get(input.jobId).state = 'running'; value = { executionId: randomUUID() }; }
    else if (action === 'status') value = jobs.get(input.jobId);
    else if (action === 'cancel') { jobs.get(input.jobId).state = 'cancelled'; value = jobs.get(input.jobId); }
    else if (action === 'resume') { jobs.get(input.jobId).state = 'queued'; value = jobs.get(input.jobId); }
    else if (action === 'window') {
      const job = jobs.get(input.jobId); const start = Math.floor(input.start / 300) * 300; const end = Math.min(duration, start + 300);
      value = { state: 'ready', window: { jobId: input.jobId, index: start / 300, start, end, source: structuredClone(source), sourceSha256: job.sourceSha256,
        segments: largeWindow ? Array.from({ length: 500 }, (_, index) => ({ segmentIndex: start / 300 * 500 + index,
          startSeconds: start + index * .5, endSeconds: start + index * .5 + .4, text: '가'.repeat(140) }))
          : [{ segmentIndex: start / 300, startSeconds: start + .1, endSeconds: Math.min(end, start + 2), text: '한국어 전사' }] } };
      if (mutateWindow) value = mutateWindow(value);
    } else if (action === 'context') value = { status: 'keep', reason: '맥락이 유지됩니다.', originalStartSeconds: input.start, originalEndSeconds: input.end, suggestion: null };
    else if (req.url === '/api/full-tracking/uploads/init') value = { uploadUrl: providerOrigin + '/resumable/test', chunkBytes: 8 * 1024 * 1024, expiresAt: new Date(Date.now() + 600000).toISOString() };
    else { res.writeHead(500).end(); return; }
    await after?.(action, input);
    if (action === 'create' && failCreate) {
      failCreate = false; res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: { code: 'FULL_TRANSCRIPTION_STORAGE_FAILED', message: 'private storage detail' } })); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string');
  providerOrigin = 'http://127.0.0.1:' + providerAddress.port;
  const app = await createApp(db, { origin, secureCookies: false, analysis: { baseUrl: providerOrigin, serviceToken: token, fullTrackingEnabled: true } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); provider.closeAllConnections(); await Promise.all([
    new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]); db.close(); });
  const request = (path = '/jobs/latest', method = 'GET', body?: unknown, userSession = session, mutation = true) => fetch(`http://127.0.0.1:${address.port}/api/transcripts/projects/${projectId}` + path,
    { method, headers: { ...(userSession ? { Cookie: 'horubak_session=' + userSession } : {}), ...(method !== 'GET' && { 'Content-Type': 'application/json', ...(mutation && { Origin: origin, 'X-CSRF-Token': csrf }) }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const complete = (id: string) => Object.assign(jobs.get(id), { state: 'completed', processedSeconds: duration, completedChunks: Math.ceil(duration / 300), segmentCount: Math.ceil(duration / 300) * 500, sourceSha256: 'a'.repeat(64), error: null });
  return { db, owner, projectId, metadata, jobs, calls, request, replaceSource, source: () => source, complete,
    after: (value?: typeof after) => { after = value; }, mutateWindow: (value?: typeof mutateWindow) => { mutateWindow = value; }, large: () => { largeWindow = true; },
    before: (value?: typeof before) => { before = value; },
    failNextCreate: () => { failCreate = true; },
    otherSession, session, csrf, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('4GiB·10시간 원본은 파일 본문 없이 비동기 전사를 생성하고 활성 작업에 합류한다', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request()).json(), { job: null });
  const response = await f.request('/jobs', 'POST', {}); assert.equal(response.status, 202);
  const { job } = await response.json(); assert.equal(job.duration, 36000); assert.equal(job.source.size, 4 * 1024 ** 3); assert.equal(job.totalChunks, 120);
  f.mutateWindow(() => ({ state: 'pending', window: null }));
  const pending = await f.request(`/jobs/${job.id}/window?start=0`); assert.equal(pending.status, 200); assert.equal((await pending.json()).state, 'pending');
  f.mutateWindow();
  const joined = await (await f.request('/jobs', 'POST', {})).json(); assert.equal(joined.job.id, job.id);
  assert.equal(f.calls.filter(item => item.action === 'create').length, 1);
  assert.equal(f.calls.filter(item => item.action === 'dispatch').length, 1);
  assert.equal(f.db.prepare('SELECT 1 FROM project_transcripts').get(), undefined);
});

test('전사 작업은 사용자·CSRF·확정 원본을 확인한다', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/jobs/latest', 'GET', undefined, '')).status, 401);
  assert.equal((await f.request('/jobs/latest', 'GET', undefined, f.otherSession)).status, 404);
  assert.equal((await f.request('/jobs', 'POST', {}, f.session, false)).status, 403);
  assert.equal((await f.request('/jobs', 'POST', { source: { objectKey: 'private' } })).status, 400);
  f.db.prepare('DELETE FROM tracking_source_uploads').run();
  assert.equal((await f.request('/jobs', 'POST', {})).status, 409); assert.equal(f.calls.length, 0);
});

test('전사 취소·재개와 마지막 시간창 조회를 제공한다', async t => {
  const f = await fixture(t); const created = await f.request('/jobs', 'POST', {}); assert.equal(created.status, 202);
  const { job } = await created.json();
  assert.equal((await (await f.request(`/jobs/${job.id}/cancel`, 'POST', {})).json()).job.state, 'cancelled');
  assert.equal((await f.request(`/jobs/${job.id}/resume`, 'POST', {})).status, 202);
  f.complete(job.id);
  const result = await f.request(`/jobs/${job.id}/window?start=35999`); assert.equal(result.status, 200);
  const value = await result.json(); assert.equal(value.window.start, 35700); assert.equal(value.window.end, 36000); assert.equal(value.window.segments[0].startSeconds, 35700.1);
  assert.equal(value.sourceRevision, revision(f.metadata));
  assert.equal((await f.request(`/jobs/${job.id}/window?start=36000`)).status, 422);
  assert.equal((await f.request(`/jobs/${randomUUID()}`)).status, 404);
});

test('원본 generation 교체·보관·전환 중 늦은 응답은 전사에 반영하지 않는다', async t => {
  const f = await fixture(t); const response = await f.request('/jobs', 'POST', {}); assert.equal(response.status, 202); const { job } = await response.json();
  f.after(action => { if (action === 'status') f.replaceSource(); });
  assert.equal((await f.request(`/jobs/${job.id}`)).status, 409);
  f.after(); assert.deepEqual(await (await f.request()).json(), { job: null });
  f.db.prepare('UPDATE projects SET archived_at=? WHERE owner_id=? AND id=?').run(date(), f.owner, f.projectId);
  assert.equal((await f.request('/jobs', 'POST', {})).status, 404);
});

test('전사 중 원본 교체를 막고 종료 상태를 갱신하면 다시 허용한다', async t => {
  const f = await fixture(t); const created = await f.request('/jobs', 'POST', {}); assert.equal(created.status, 202); const { job } = await created.json();
  const change = () => fetch(f.baseUrl + `/api/tracking/projects/${f.projectId}/source`, { method: 'POST', headers: {
    Cookie: 'horubak_session=' + f.session, Origin: origin, 'X-CSRF-Token': f.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'source.mp4', size: f.metadata.fileSize, contentType: 'video/mp4' }) });
  const busy = await change(); assert.equal(busy.status, 409); assert.equal((await busy.json()).code, 'TRANSCRIPTION_IN_PROGRESS');
  f.complete(job.id); assert.equal((await change()).status, 201);
});

test('전체 전사가750KiB를 넘더라도 창별로 조회하고 다른 창·지문·시간을 거부한다', async t => {
  const f = await fixture(t); const created = await f.request('/jobs', 'POST', {}); assert.equal(created.status, 202); const { job } = await created.json(); f.complete(job.id); f.large();
  let total = 0;
  for (const start of [0, 300, 600, 900]) { const result = await f.request(`/jobs/${job.id}/window?start=${start}`); assert.equal(result.status, 200); total += Buffer.byteLength(await result.text()); }
  assert.ok(total > 750 * 1024); assert.equal(f.db.prepare('SELECT 1 FROM project_transcripts').get(), undefined);
  for (const mutate of [(value: any) => { value.window.jobId = randomUUID(); return value; },
    (value: any) => { value.window.source.generation = 'different'; return value; },
    (value: any) => { value.window.sourceSha256 = 'b'.repeat(64); return value; },
    (value: any) => { value.window.segments[0].endSeconds = 301; return value; }]) {
    f.mutateWindow(mutate); assert.equal((await f.request(`/jobs/${job.id}/window?start=0`)).status, 502);
  }
  f.mutateWindow(() => ({ state: 'pending', window: null }));
  assert.equal((await f.request(`/jobs/${job.id}/window?start=0`)).status, 502, 'Committed results cannot silently become pending');
});

test('1시간 이후 맥락 검토는 완료 전사 job을 참조하고 검토 중 최신job 변경을 차단한다', async t => {
  const f = await fixture(t); const created = await f.request('/jobs', 'POST', {}); assert.equal(created.status, 202); const { job } = await created.json();
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', {})).status, 409);
  f.complete(job.id);
  const expected = { expectedJobId: job.id, expectedSourceSha256: 'a'.repeat(64) };
  const response = await f.request('/context-check?start=35940&end=36000', 'POST', expected); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'keep');
  assert.deepEqual(f.calls.find(item => item.action === 'context')!.input, { jobId: job.id, start: 35940, end: 36000 });
  // A concurrent original generation change must invalidate the completed answer.
  f.after(action => { if (action === 'context') f.replaceSource(); });
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', expected)).status, 409);
});

test('작업·창 계약은 4GiB·10시간 경계와 전체 결과의 일관성을 검증한다', async t => {
  const f = await fixture(t); const response = await f.request('/jobs', 'POST', {}); const { job } = await response.json(); f.complete(job.id);
  const completed = f.jobs.get(job.id);
  assert.equal(transcriptionJob(completed, job.id, f.source()).totalChunks, 120);
  assert.throws(() => transcriptionJob({ ...job, segmentCount: 1 }, job.id, f.source()), { code: 'TRANSCRIPTION_RESPONSE_INVALID' });
  for (const corrupt of [{ ...completed, source: { ...f.source(), size: 4 * 1024 ** 3 + 1 } },
    { ...completed, source: { ...f.source(), duration: 36000.001 } }, { ...completed, processedSeconds: 35999 },
    { ...completed, completedChunks: 119 }, { ...completed, sourceSha256: null }, { ...completed, segmentCount: 240001 },
    { ...completed, source: { ...f.source(), generation: 'another-generation' } }]) {
    assert.throws(() => transcriptionJob(corrupt, job.id, f.source()));
  }
  const window = { jobId: job.id, index: 0, start: 0, end: 300, source: f.source(), sourceSha256: 'a'.repeat(64),
    segments: [{ segmentIndex: 0, startSeconds: 0, endSeconds: 1, text: '정상' }] };
  assert.equal(transcriptionWindow(window, completed, 0).segments.length, 1);
  assert.equal(transcriptionWindow({ ...window, segments: [] }, completed, 0).segments.length, 0, 'Silent chunks are valid');
  for (const segments of [[{ ...window.segments[0], startSeconds: NaN }], [{ ...window.segments[0], endSeconds: 301 }],
    [{ ...window.segments[0], text: '가'.repeat(2001) }], [window.segments[0], window.segments[0]],
    Array.from({ length: 500 }, (_, index) => ({ segmentIndex: index, startSeconds: index / 2, endSeconds: index / 2 + .1, text: '가'.repeat(400) }))]) {
    assert.throws(() => transcriptionWindow({ ...window, segments }, completed, 0), { code: 'TRANSCRIPTION_RESPONSE_INVALID' });
  }
});

test('동시 시작은 한 번만 실행하고 pending replacement와 검토 중 새 작업을 감지한다', async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request('/jobs', 'POST', {})));
  for (const response of responses) assert.equal(response.status, 202);
  const values = await Promise.all(responses.map(response => response.json()));
  assert.equal(new Set(values.map(value => value.job.id)).size, 1); const id = values[0].job.id;
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 1);
  f.complete(id);
  const uploadId = randomUUID();
  f.db.prepare('INSERT INTO tracking_source_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(f.owner, f.projectId, uploadId, revision(f.metadata), 'source.mp4', f.metadata.fileSize,
    'video/mp4', JSON.stringify({ expiresAt: new Date(Date.now() + 600000).toISOString() }), null, date(), date());
  const pending = await f.request('/jobs', 'POST', {}); assert.equal(pending.status, 409); assert.equal((await pending.json()).code, 'SOURCE_UPLOAD_PENDING');
  f.db.prepare('DELETE FROM tracking_source_uploads WHERE upload_id=?').run(uploadId);
  f.after(action => {
    if (action !== 'context') return;
    const newer = randomUUID(), stamp = date();
    f.db.prepare('INSERT INTO transcript_full_jobs VALUES(?,?,?,?,?,?,?,?,?,?)').run(newer, f.owner, f.projectId, revision(f.metadata), f.source().uploadId,
      JSON.stringify(f.source()), JSON.stringify({ ...f.jobs.get(id), id: newer, state: 'queued' }), 0, stamp, stamp);
  });
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', { expectedJobId: id, expectedSourceSha256: 'a'.repeat(64) })).status, 409);
});

test('맥락 요청은 화면의 전사 job과SHA를 고정하며 다른 탭의 완료 결과와 섞지 않는다', async t => {
  const f = await fixture(t); const first = await (await f.request('/jobs', 'POST', {})).json(); f.complete(first.job.id);
  const firstPin = { expectedJobId: first.job.id, expectedSourceSha256: 'a'.repeat(64) };
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', {})).status, 409);
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', { ...firstPin, expectedSourceSha256: 'b'.repeat(64) })).status, 409);
  const second = await (await f.request('/jobs', 'POST', {})).json(); f.complete(second.job.id);
  const old = await f.request('/context-check?start=35940&end=36000', 'POST', firstPin); assert.equal(old.status, 409); assert.equal((await old.json()).code, 'TRANSCRIPT_CHANGED');
  assert.equal(f.calls.filter(value => value.action === 'context').length, 0);
  const pin = { expectedJobId: second.job.id, expectedSourceSha256: 'a'.repeat(64) };
  assert.equal((await f.request('/context-check?start=35940&end=36000', 'POST', pin)).status, 200);
  f.after(action => {
    if (action !== 'context') return;
    const row = f.db.prepare('SELECT job_json FROM transcript_full_jobs WHERE id=?').get(second.job.id)!;
    f.db.prepare('UPDATE transcript_full_jobs SET job_json=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(String(row.job_json)), sourceSha256: 'b'.repeat(64) }), second.job.id);
  });
  const changed = await f.request('/context-check?start=35940&end=36000', 'POST', pin); assert.equal(changed.status, 409); assert.equal((await changed.json()).code, 'TRANSCRIPT_CHANGED');
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('provider create 응답을 기다리는 동안 취소한 작업은 되살리거나 dispatch하지 않는다', async t => {
  const f = await fixture(t), entered = gate(), blocked = gate();
  t.after(blocked.release);
  f.after(async action => { if (action === 'create') { entered.release(); await blocked.promise; } });
  const creating = f.request('/jobs', 'POST', {}); await entered.promise;
  const id = String(f.db.prepare('SELECT id FROM transcript_full_jobs').get()!.id);
  const cancelled = await f.request(`/jobs/${id}/cancel`, 'POST', {}); assert.equal((await cancelled.json()).job.state, 'cancelled');
  const pendingResume = await f.request(`/jobs/${id}/resume`, 'POST', {}); assert.equal(pendingResume.status, 409); assert.equal((await pendingResume.json()).code, 'JOB_OPERATION_PENDING');
  assert.equal((await (await f.request()).json()).job.state, 'cancelled');
  blocked.release(); const finished = await creating; assert.equal(finished.status, 202); assert.equal((await finished.json()).job.state, 'cancelled');
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 0); assert.equal(f.jobs.get(id).state, 'cancelled');
});

test('provider resume 응답을 기다리는 동안 취소한 작업도 dispatch하지 않는다', async t => {
  const f = await fixture(t); const { job } = await (await f.request('/jobs', 'POST', {})).json();
  await f.request(`/jobs/${job.id}/cancel`, 'POST', {});
  const entered = gate(), blocked = gate(); t.after(blocked.release);
  f.after(async action => { if (action === 'resume') { entered.release(); await blocked.promise; } });
  const resuming = f.request(`/jobs/${job.id}/resume`, 'POST', {}); await entered.promise;
  const cancelled = await f.request(`/jobs/${job.id}/cancel`, 'POST', {}); assert.equal((await cancelled.json()).job.state, 'cancelled');
  blocked.release(); const finished = await resuming; assert.equal(finished.status, 202); assert.equal((await finished.json()).job.state, 'cancelled');
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 1); assert.equal(f.jobs.get(job.id).state, 'cancelled');
});

test('provider 생성 대기 중 원본 교체는 실행 전에 차단한다', async t => {
  const f = await fixture(t);
  f.after(action => { if (action === 'create') f.replaceSource(); });
  const response = await f.request('/jobs', 'POST', {}); assert.equal(response.status, 409);
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 0);
  assert.equal((await f.request('/jobs/' + String(f.db.prepare('SELECT id FROM transcript_full_jobs').get()?.id))).status, 409);
});

test('provider 생성 응답 실패 뒤에도 예약된 작업 ID로 재개한다', async t => {
  const f = await fixture(t); f.failNextCreate();
  const failed = await f.request('/jobs', 'POST', {}); assert.equal(failed.status, 503);
  const value = await failed.json(); assert.equal(JSON.stringify(value).includes('private storage'), false);
  const latest = await (await f.request()).json(); assert.equal(latest.job.state, 'failed');
  const resumed = await f.request(`/jobs/${latest.job.id}/resume`, 'POST', {}); assert.equal(resumed.status, 202);
  assert.equal((await resumed.json()).job.id, latest.job.id);
  assert.equal(f.jobs.size, 1); assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 1);
});

test('미생성 작업 재개에서 create가 다시 실패해도 실패 상태를 복구해 재개할 수 있다', async t => {
  const f = await fixture(t); f.failNextCreate();
  assert.equal((await f.request('/jobs', 'POST', {})).status, 503);
  const { job } = await (await f.request()).json(); assert.equal(job.state, 'failed');
  f.failNextCreate();
  assert.equal((await f.request(`/jobs/${job.id}/resume`, 'POST', {})).status, 503);
  const latest = await (await f.request()).json(); assert.equal(latest.job.state, 'failed'); assert.equal(latest.job.id, job.id);
  assert.equal((await f.request(`/jobs/${job.id}/resume`, 'POST', {})).status, 202);
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 1);
});

test('미생성 작업 재개의 create 실패 응답은 대기 중 취소를 실패로 덮어쓰지 않는다', async t => {
  const f = await fixture(t); f.failNextCreate();
  await f.request('/jobs', 'POST', {}); const { job } = await (await f.request()).json();
  const entered = gate(), blocked = gate(); t.after(blocked.release);
  f.failNextCreate();
  f.after(async action => { if (action === 'create') { entered.release(); await blocked.promise; } });
  const resuming = f.request(`/jobs/${job.id}/resume`, 'POST', {}); await entered.promise;
  const cancelled = await f.request(`/jobs/${job.id}/cancel`, 'POST', {}); assert.equal((await cancelled.json()).job.state, 'cancelled');
  blocked.release(); assert.equal((await resuming).status, 503);
  assert.equal((await (await f.request()).json()).job.state, 'cancelled');
  assert.equal(f.calls.filter(value => value.action === 'dispatch').length, 0);
});

test('취소 완료 작업 조회는 cancel을 재전송하지 않으며 지연된 cancel 중에는 재개하지 않는다', async t => {
  const f = await fixture(t); const { job } = await (await f.request('/jobs', 'POST', {})).json();
  await f.request(`/jobs/${job.id}/cancel`, 'POST', {});
  const cancelCount = f.calls.filter(value => value.action === 'cancel').length;
  await f.request(); await f.request(`/jobs/${job.id}`);
  assert.equal(f.calls.filter(value => value.action === 'cancel').length, cancelCount, 'Read-only terminal requests cannot send cancellation');
  await f.request(`/jobs/${job.id}/resume`, 'POST', {});
  const entered = gate(), blocked = gate(); t.after(blocked.release);
  f.before(async action => { if (action === 'cancel') { entered.release(); await blocked.promise; } });
  const cancelling = f.request(`/jobs/${job.id}/cancel`, 'POST', {}); await entered.promise;
  const resumesBefore = f.calls.filter(value => value.action === 'resume').length;
  assert.equal((await f.request(`/jobs/${job.id}/resume`, 'POST', {})).status, 409);
  assert.equal(f.calls.filter(value => value.action === 'resume').length, resumesBefore);
  blocked.release(); assert.equal((await cancelling).status, 200);
  f.before();
  assert.equal((await f.request(`/jobs/${job.id}/resume`, 'POST', {})).status, 202);
  assert.equal(f.jobs.get(job.id).state, 'running');
});
