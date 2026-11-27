import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { callService, revision } from '../src/analysis.js';
import { project as validateProject } from '../src/validation.js';
import { jobResult, providerUrl, sourceResult } from '../src/full-tracking-contract.js';

const origin = 'http://127.0.0.1:5173';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const serviceToken = 'a'.repeat(48);
const now = () => new Date().toISOString();

async function playbackFixture(t: TestContext) {
  const db = openDatabase(':memory:');
  const owner = randomUUID(); const other = randomUUID(); const projectId = randomUUID();
  const token = 'e'.repeat(64); const otherToken = 'f'.repeat(64);
  for (const id of [owner, other]) db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, '테스트', id + '@example.invalid', 'unused', now());
  for (const [value, id] of [[token, owner], [otherToken, other]]) db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(value!), id!, 'a'.repeat(64), Date.now() + 600000);
  const metadata = { source: 'file', sourceName: 'source.mp4', duration: 60, fileSize: 1024 };
  db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?)').run(owner, projectId, JSON.stringify(metadata));
  const replaceSource = (uploadId = randomUUID()) => {
    const source = { uploadId, filename: metadata.sourceName, size: metadata.fileSize, duration: metadata.duration, width: 1280, height: 720,
      objectKey: `originals/${owner}/${projectId}/${uploadId}`, generation: '123', checksum: 'crc32-value' };
    db.prepare('DELETE FROM tracking_source_uploads WHERE owner_id=? AND project_id=?').run(owner, projectId);
    db.prepare('INSERT INTO tracking_source_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(owner, projectId, uploadId, revision(metadata), metadata.sourceName,
      metadata.fileSize, 'video/mp4', '{}', JSON.stringify(source), now(), now());
    return source;
  };
  const source = replaceSource();
  let providerOrigin = ''; let providerCalls = 0; let legacyCalls = 0;
  let afterPlayback: (() => void) | undefined;
  const provider = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + serviceToken);
    assert.equal(req.url, '/api/full-tracking/source/playback');
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body); providerCalls++;
    afterPlayback?.();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: providerOrigin + '/media/' + input.source.uploadId }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string');
  providerOrigin = 'http://127.0.0.1:' + providerAddress.port;
  const app = await createApp(db, { origin, secureCookies: false, analysis: { baseUrl: providerOrigin, serviceToken, fullTrackingEnabled: true },
    mountSources: app => { app.get('/api/projects/:id/source', (_req, res) => { legacyCalls++; res.status(204).end(); }); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]); db.close(); });
  return { db, owner, projectId, metadata, source, otherToken, replaceSource, providerOrigin,
    afterPlayback: (action: () => void) => { afterPlayback = action; },
    providerCalls: () => providerCalls, legacyCalls: () => legacyCalls,
    request: (query = '', session = token) => fetch(`http://127.0.0.1:${address.port}/api/projects/${projectId}/source` + query,
      { headers: session ? { Cookie: 'horubak_session=' + session } : {}, redirect: 'manual' }) };
}

test('원본 재생은 단일 업로드 버전을 검증하고 미지정 요청은 유지한다', async t => {
  const fixture = await playbackFixture(t);
  const correct = await fixture.request('?version=' + fixture.source.uploadId);
  assert.equal(correct.status, 307); assert.equal(correct.headers.get('location'), fixture.providerOrigin + '/media/' + fixture.source.uploadId);
  assert.equal((await fixture.request()).status, 307);
  for (const query of ['?version=' + randomUUID(), '?version=', '?version=invalid', '?version=' + fixture.source.uploadId + '&version=' + fixture.source.uploadId,
    '?version[uploadId]=' + fixture.source.uploadId, '?version[]=' + fixture.source.uploadId,
    '?version=' + fixture.source.uploadId + '&version[uploadId]=' + fixture.source.uploadId]) {
    const response = await fixture.request(query);
    assert.equal(response.status, 409, query); assert.equal((await response.json()).code, 'SOURCE_CHANGED');
  }
  assert.equal(fixture.providerCalls(), 2); assert.equal(fixture.legacyCalls(), 0);
});

test('버전 재생은 권한과 원본 유무를 확인하고 다른 재생 경로로 넘기지 않는다', async t => {
  const fixture = await playbackFixture(t); const query = '?version=' + fixture.source.uploadId;
  assert.equal((await fixture.request(query, '')).status, 401);
  assert.equal((await fixture.request(query, fixture.otherToken)).status, 404);
  fixture.db.prepare('DELETE FROM tracking_source_uploads WHERE owner_id=? AND project_id=?').run(fixture.owner, fixture.projectId);
  const response = await fixture.request(query);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'SOURCE_CHANGED');
  assert.equal(fixture.providerCalls(), 0); assert.equal(fixture.legacyCalls(), 0);
  assert.equal((await fixture.request()).status, 204); assert.equal(fixture.legacyCalls(), 1);
  const previous = fixture.replaceSource();
  fixture.db.prepare('UPDATE projects SET document=? WHERE owner_id=? AND id=?').run(JSON.stringify({ ...fixture.metadata, sourceName: 'replacement.mp4' }), fixture.owner, fixture.projectId);
  assert.equal((await fixture.request('?version=' + previous.uploadId)).status, 409);
  assert.equal(fixture.providerCalls(), 0); assert.equal(fixture.legacyCalls(), 1);
});

test('같은 메타데이터의 원본 교체 후 구버전 재생 요청은 새 영상을 반환하지 않는다', async t => {
  const fixture = await playbackFixture(t); const replacement = fixture.replaceSource();
  const old = await fixture.request('?version=' + fixture.source.uploadId);
  assert.equal(old.status, 409); assert.equal((await old.json()).code, 'SOURCE_CHANGED');
  assert.equal(fixture.providerCalls(), 0);
  const current = await fixture.request('?version=' + replacement.uploadId);
  assert.equal(current.status, 307); assert.equal(current.headers.get('location'), fixture.providerOrigin + '/media/' + replacement.uploadId);
});

test('재생 URL 발급 대기 중 원본이 교체되면 이전 URL을 반환하지 않는다', async t => {
  const fixture = await playbackFixture(t);
  fixture.afterPlayback(() => { fixture.replaceSource(); });
  const response = await fixture.request('?version=' + fixture.source.uploadId);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'SOURCE_CHANGED');
  assert.equal(response.headers.get('location'), null); assert.equal(fixture.providerCalls(), 1);
});

test('분석 중503은 모델 미준비와 구분하고 Retry-After를 보존한다', async t => {
  let busy = true;
  const server = createServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json', ...(busy ? { 'Retry-After': '15' } : {}) });
    res.end(JSON.stringify({ detail: busy ? '다른 영상을 분석 중' : { code: 'MODEL_UNAVAILABLE', message: 'private internal path' } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options = { baseUrl: 'http://127.0.0.1:' + address.port, serviceToken };
  await assert.rejects(callService(options, '/api/tracking/analyze', {}, 1000), { status: 503, code: 'ANALYSIS_BUSY', retryAfter: 15 });
  busy = false;
  await assert.rejects(callService(options, '/api/tracking/analyze', {}, 1000), (error: any) => error.code === 'MODEL_UNAVAILABLE' && !error.message.includes('private'));
});

test('업로드 미완료409 코드와 상태를 보존하며 내부 메시지는 노출하지 않는다',async t=>{
  const server=createServer((_req,res)=>{res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({detail:{code:'UPLOAD_INCOMPLETE',message:'private bucket path secret'}}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  await assert.rejects(callService({baseUrl:'http://127.0.0.1:'+address.port,serviceToken},'/api/full-tracking/uploads/complete',{},1000),
    (error:any)=>error.status===409&&error.code==='UPLOAD_INCOMPLETE'&&!error.message.includes('secret'));
});

test('프로젝트 등록은10시간까지 허용하고 초과 길이를 거부한다', () => {
  const document = { id: randomUUID(), title: '영상', source: 'file', sourceName: 'source.mp4', genre: 'general',
    status: 'ready', duration: 36000, progress: 100, favorite: false, createdAt: now(), updatedAt: now() };
  assert.equal(validateProject(document).duration, 36000);
  assert.throws(() => validateProject({ ...document, duration: 36000.001 }), { code: 'INVALID_PROJECT' });
});

test('기존 장시간 원본의 편집정보는 보존하되 새등록·원본교체 우회는 거부한다',async t=>{
  const db=openDatabase(':memory:'); const owner=randomUUID();const token='a'.repeat(64);const csrf='b'.repeat(64);
  db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(owner,'기존사용자',owner+'@example.invalid','unused',now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),owner,csrf,Date.now()+600000);
  const legacy={id:randomUUID(),title:'기존 12시간 영상',source:'file',sourceName:'legacy.mp4',fileSize:1024,genre:'general',status:'ready',duration:43200,
    progress:100,favorite:false,createdAt:now(),updatedAt:now(),clips:[{id:'clip',title:'편집',edit:{start:43100,end:43130,subtitle:'보존'}}]};
  db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?)').run(owner,legacy.id,JSON.stringify(legacy));
  const app=await createApp(db,{origin,secureCookies:false});const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  const save=(version:number,projects:unknown[])=>fetch('http://127.0.0.1:'+address.port+'/api/workspace/session',{method:'PUT',
    headers:{Cookie:'horubak_session='+token,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({ownerId:owner,version,projects})});
  assert.equal((await save(0,[{...legacy,title:'편집 제목 변경'}])).status,200);
  assert.equal((await save(1,[{...legacy,sourceName:'replacement.mp4'}])).status,400);
  assert.equal((await save(1,[{...legacy,id:randomUUID()}])).status,400);
  assert.equal(JSON.parse(String(db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=?').get(owner,legacy.id)?.document)).clips[0].edit.start,43100);
});

test('4GiB·10시간·원본객체·작업완료·재생URL의 경계를 검증한다', () => {
  const ownerId=randomUUID(); const projectId=randomUUID(); const uploadId=randomUUID();
  const source={uploadId,filename:'source.mp4',size:4*1024**3,duration:36000,width:3840,height:2160,
    objectKey:`originals/${ownerId}/${projectId}/${uploadId}`,generation:'123',checksum:'crc=='};
  assert.equal(sourceResult(source).duration,36000);
  assert.throws(()=>sourceResult({...source,size:source.size+1}),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  assert.throws(()=>sourceResult({...source,duration:36000.01}),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  assert.throws(()=>sourceResult({...source,objectKey:'originals/../../private'}),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  assert.throws(()=>sourceResult({...source,objectKey:`originals/${randomUUID()}/${projectId}/${uploadId}`},{ownerId,projectId,uploadId,filename:'source.mp4',size:source.size}),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  const job={id:randomUUID(),source,state:'completed',duration:36000,processedSeconds:36000,sampleFps:2,chunkSeconds:60,
    completedChunks:600,totalChunks:600,sourceSha256:'a'.repeat(64),error:null,createdAt:now(),updatedAt:now()};
  assert.equal(jobResult(job,job.id,source).completedChunks,600);
  assert.throws(()=>jobResult({...job,completedChunks:599},job.id,source),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  assert.throws(()=>jobResult({...job,sourceSha256:null},job.id,source),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  const options={baseUrl:'http://127.0.0.1:18000',serviceToken};
  assert.equal(providerUrl('https://storage.googleapis.com/private/source?X-Goog-Signature=abc',options),'https://storage.googleapis.com/private/source?X-Goog-Signature=abc');
  for(const url of ['https://evil.invalid/upload','http://127.0.0.1:9999/upload','https://user:password@storage.googleapis.com/source','javascript:alert(1)']) {
    assert.throws(()=>providerUrl(url,options),{code:'FULL_TRACKING_RESPONSE_INVALID'});
  }
});

test('전체 영상 원본·작업·창·선택·취소·재개를 실제 인증HTTP와 임시DB로 검증한다', async t => {
  const db = openDatabase(':memory:');
  const owner = randomUUID(); const other = randomUUID(); const projectId = randomUUID();
  const token = 'b'.repeat(64); const otherToken = 'c'.repeat(64); const csrf = 'd'.repeat(64);
  for (const id of [owner, other]) db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, '테스트', id + '@example.invalid', 'unused', now());
  for (const [sessionToken, id] of [[token, owner], [otherToken, other]]) db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(sessionToken!), id!, csrf, Date.now() + 600000);
  const metadata = { source: 'file', sourceName: 'source.mp4', duration: 600, fileSize: 30 * 1024 * 1024 };
  const writeProject = (value = metadata) => db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET document=excluded.document').run(owner, projectId, JSON.stringify(value));
  writeProject();
  let fullSource: any; let job: any; let dispatches = 0; let windowsReady = false; let providerBusy = false;
  let sourceDuration = 600; let afterProvider: ((action:string) => void | Promise<void>) | undefined;
  let providerOrigin = '';
  const provider = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + serviceToken);
    let body = ''; for await (const data of req) body += data;
    const input = JSON.parse(body || '{}'); const action = req.url!.split('/api/full-tracking/')[1];
    if (providerBusy) { res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '15' }); res.end('{"detail":"busy"}'); return; }
    let value: unknown;
    if (action === 'uploads/init') {
      assert.equal(input.ownerId, owner); assert.equal(input.projectId, projectId); assert.equal(input.origin, origin);
      value = { uploadUrl: providerOrigin + '/resumable/opaque-token', chunkBytes: 8 * 1024 * 1024, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    } else if (action === 'uploads/complete') {
      fullSource = { uploadId: input.uploadId, filename: input.filename, size: input.size, duration: sourceDuration, width: 1920, height: 1080,
        objectKey: `originals/${owner}/${projectId}/${input.uploadId}`, generation: '123456', checksum: 'crc32c-value' };
      value = fullSource;
    } else if (action === 'source/playback') value = { url: providerOrigin + '/media/opaque-playback', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    else if (action === 'jobs/create') {
      if (job?.id !== input.jobId) job = { id: input.jobId, state: 'queued', source: input.source, duration: input.source.duration, processedSeconds: 0, sampleFps: 2,
        chunkSeconds: 60, completedChunks: 0, totalChunks: Math.ceil(input.source.duration / 60), sourceSha256: null, error: null, createdAt: now(), updatedAt: now() };
      value = job;
    } else if (action === 'jobs/dispatch') { dispatches++; job.state = 'running'; value = { executionId: randomUUID() }; }
    else if (action === 'jobs/status') value = job;
    else if (action === 'jobs/cancel') { job.state = 'cancelling'; value = job; }
    else if (action === 'jobs/resume') { job.state = 'queued'; value = job; }
    else if (action === 'jobs/window') {
      const start = Math.floor(input.start / 60) * 60;
      if(windowsReady&&job.processedSeconds===0){job.processedSeconds=60;job.completedChunks=1;job.sourceSha256='f'.repeat(64);}
      value = { result: windowsReady ? { schemaVersion: 1, sourceSha256: 'f'.repeat(64), source: { duration: 600, width: 1920, height: 1080 },
        range: { start, end: Math.min(start + 60, 600), sampleFps: 2 }, model: { name: 'nanodet', version: 'pinned', sha256: 'e'.repeat(64) },
        scenes: [{ id: 's1', start, end: start + 60 }], tracks: [{ id: start === 0 ? 'global-t1' : 'global-t2', sceneId: 's1', classId: 0, label: 'person',
          start, end: start + 1, meanConfidence: .9, observations: [start, start + .5, start + 1].map(time => ({ time, bbox: [.1,.2,.2,.4], confidence:.9 })), gaps: [] }],
        recommendations: [], warnings: [] } : null };
    } else { res.writeHead(404); res.end('{}'); return; }
    await afterProvider?.(String(action));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string'); providerOrigin = 'http://127.0.0.1:' + providerAddress.port;
  const app = await createApp(db, { origin, secureCookies: false, rateLimit: 1000, analysis: { baseUrl: providerOrigin, serviceToken, fullTrackingEnabled: true } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const serverOrigin = 'http://127.0.0.1:' + address.port;
  const base = serverOrigin + '/api/tracking/projects/' + projectId;
  t.after(async () => { await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]); db.close(); });
  const headers = (session = token) => ({ Cookie: 'horubak_session=' + session, Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' });
  const send = (path: string, method = 'GET', body?: unknown, session = token) => fetch(base + path, { method, headers: headers(session), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const init = { filename: metadata.sourceName, size: metadata.fileSize, contentType: 'video/mp4' };
  assert.equal((await fetch(base + '/source')).status, 401);
  assert.equal((await send('/source', 'GET', undefined, otherToken)).status, 404);
  assert.equal((await fetch(base + '/source', { method:'POST', headers: { ...headers(), 'X-CSRF-Token':'' }, body:JSON.stringify(init) })).status,403);
  assert.equal((await send('/source', 'POST', { ...init, size: 4 * 1024 ** 3 + 1 })).status,413);
  assert.equal((await send('/source', 'POST', { ...init, filename:'other.mp4' })).status,409);
  const uploadResponse = await send('/source','POST',init); assert.equal(uploadResponse.status,201);
  const upload: any = await uploadResponse.json(); assert.match(upload.uploadId,/^[a-f0-9-]{36}$/); assert.equal(upload.chunkBytes,8*1024*1024);
  const pending: any = await (await send('/source')).json(); assert.equal(pending.source,null); assert.equal(pending.upload.uploadId,upload.uploadId);
  sourceDuration = 36001;
  assert.equal((await send('/source/'+upload.uploadId+'/complete','POST',{})).status,502);
  sourceDuration = 600;
  const completed: any = await (await send('/source/'+upload.uploadId+'/complete','POST',{})).json(); assert.equal(completed.source.size,metadata.fileSize);
  assert.equal(JSON.parse(String(db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=?').get(owner,projectId)?.document)).sourceUploaded,true);
  const saved=await fetch(serverOrigin+'/api/workspace/session',{method:'PUT',headers:headers(),body:JSON.stringify({ownerId:owner,version:0,projects:[{
    ...metadata,id:projectId,title:'서버 원본',genre:'general',status:'ready',progress:100,favorite:false,createdAt:now(),updatedAt:now(),sourceUploaded:false,
  }]})});
  assert.equal(saved.status,200);
  assert.equal(JSON.parse(String(db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=?').get(owner,projectId)?.document)).sourceUploaded,true);
  const playback = await fetch(serverOrigin+'/api/projects/'+projectId+'/source',{ headers:headers(),redirect:'manual' });
  assert.equal(playback.status,307); assert.equal(playback.headers.get('location'),providerOrigin+'/media/opaque-playback');
  const createdResponse=await send('/jobs','POST',{}); assert.equal(createdResponse.status,202); const created:any=await createdResponse.json(); assert.equal(created.job.duration,600);
  const duplicate:any=await (await send('/jobs','POST',{})).json(); assert.equal(duplicate.job.id,created.job.id); assert.equal(dispatches,1);
  assert.equal((await send('/source','POST',init)).status,409);
  const jobPath='/jobs/'+created.job.id;
  assert.equal((await send(jobPath,'GET',undefined,otherToken)).status,404);
  const windowMissing:any=await (await send(jobPath+'/window?start=0')).json(); assert.equal(windowMissing.result,null);
  // The first chunk commits between the provider status and window reads.
  windowsReady=true;
  const window:any=await (await send(jobPath+'/window?start=0')).json(); assert.equal(window.result.analysisId,created.job.id); assert.equal(window.result.range.end,60);
  const choose={windowStart:0,sourceRevision:window.result.sourceRevision,sceneId:'s1',trackId:'global-t1'};
  assert.equal((await send(jobPath+'/selection','PUT',{...choose,sourceRevision:'outdated'})).status,409);
  assert.equal((await send(jobPath+'/selection','PUT',{...choose,trackId:'missing'})).status,422);
  assert.equal((await send(jobPath+'/selection','PUT',choose)).status,200);
  assert.deepEqual((await (await send(jobPath+'/window?start=0')).json() as any).selections,[{sceneId:'s1',trackId:'global-t1'}]);
  job.processedSeconds=120; job.completedChunks=2;
  assert.deepEqual((await (await send(jobPath+'/window?start=60')).json() as any).selections,[]);
  const cancelled:any=await (await send(jobPath+'/cancel','POST',{})).json(); assert.equal(cancelled.job.state,'cancelling');
  job.state='cancelled';
  const resumed:any=await (await send(jobPath+'/resume','POST',{})).json(); assert.equal(resumed.job.processedSeconds,120); assert.equal(dispatches,2);
  providerBusy=true;
  const busy=await send(jobPath); assert.equal(busy.status,503); assert.equal(busy.headers.get('retry-after'),'15'); assert.equal((await busy.json()).code,'ANALYSIS_BUSY');
  providerBusy=false;
  // A status response cannot be applied after a source change during the request.
  afterProvider=()=>{writeProject({...metadata,sourceName:'replacement.mp4'});};
  assert.equal((await send(jobPath)).status,409);
  afterProvider=undefined;writeProject();
  // Two requests that both observed the old completed job must reserve one new job.
  job.state='completed';job.processedSeconds=600;job.completedChunks=10;
  let statusCalls=0;let releaseStatus!:()=>void;
  const bothStatuses=new Promise<void>(resolve=>{releaseStatus=resolve;});
  afterProvider=async action=>{if(action==='jobs/status'){statusCalls++;if(statusCalls===2)releaseStatus();await bothStatuses;}};
  const [newA,newB]=await Promise.all([send('/jobs','POST',{}),send('/jobs','POST',{})]);
  afterProvider=undefined;
  assert.equal(newA.status,202);assert.equal(newB.status,202);
  const [bodyA,bodyB]:any[]=await Promise.all([newA.json(),newB.json()]);
  assert.equal(bodyA.job.id,bodyB.job.id);assert.equal(dispatches,3);
  writeProject({...metadata,sourceName:'replacement.mp4'});
  assert.equal((await send(jobPath)).status,409);
  assert.deepEqual(await (await send('/source')).json(),{source:null,upload:null});
  writeProject(); db.prepare('DELETE FROM projects WHERE owner_id=? AND id=?').run(owner,projectId);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM tracking_full_jobs').get() as any).count,0);
});
