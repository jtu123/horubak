import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import ffprobe from 'ffprobe-static';
import { HttpError } from '../src/security.js';
import { createProjectRouter } from '../src/routes/project.routes.js';
import { probeVideo } from '../src/services/video.service.js';
import type { StagedProject } from '../src/types/project.types.js';
import { openDatabase } from '../src/database.js';
import { mountProjectSources } from '../src/project-sources.js';
import { createApp } from '../src/server.js';

test('Node 파일 등록은 인증 후 디스크에서 분석하고 임시 파일을 정리한다', async t => {
  const uploadDir = await mkdtemp(join(tmpdir(), 'horubak-upload-test-'));
  const original = await readFile('../frontend/public/samples/pl-tottenham-arsenal-2010.mp4');
  const projectId = randomUUID();
  const registered: StagedProject[] = [];
  let rejectRegistration = false;
  const app = express();
  app.use('/api/projects', createProjectRouter({
    uploadDir,
    maxFileSizeMb: 5,
    authorize(req, _res, next) {
      if (req.get('x-test-account') !== 'signed-in') throw new HttpError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요.');
      next();
    },
    async register(project) {
      registered.push(project);
      assert.deepEqual(await readFile(project.file.stagedPath), original);
      if (rejectRegistration) throw new HttpError(409, 'REGISTRATION_CONFLICT', '프로젝트를 등록하지 못했습니다.');
      return { project: { id: project.projectId, title: project.projectName }, version: 1 };
    },
  }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ code: error.code });
  };
  app.use(errors);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(uploadDir, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port + '/api/projects';
  const form = (file: BlobPart, filename = '원본.MP4') => {
    const body = new FormData();
    body.set('projectName', '  경기 영상  ');
    body.set('projectId', projectId);
    body.set('genre', 'general');
    body.set('inputType', 'FILE');
    body.set('contentProfile', JSON.stringify({ purpose: '  하이라이트  ', focus: '  전반  ', signals: ['visual', 'visual'] }));
    body.set('file', new Blob([file]), filename);
    return body;
  };
  const send = (body: FormData) => fetch(url, { method: 'POST', body, headers: { 'x-test-account': 'signed-in' } });

  const unauthorized = await fetch(url, { method: 'POST', body: form('test') });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await readdir(uploadDir), []);

  const invalid = await send(form('not a video'));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_VIDEO');
  assert.equal(registered.length, 0);
  assert.deepEqual(await readdir(join(uploadDir, '.staging')), []);

  const unsupported = await send(form('unsupported', 'video.mkv'));
  assert.equal(unsupported.status, 400);
  assert.equal((await unsupported.json()).code, 'UNSUPPORTED_VIDEO');
  assert.deepEqual(await readdir(join(uploadDir, '.staging')), []);

  const oversized = await send(form(new Uint8Array(5 * 1024 * 1024 + 1)));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'VIDEO_TOO_LARGE');
  assert.deepEqual(await readdir(join(uploadDir, '.staging')), []);

  const partial = request(url, {
    method: 'POST', headers: { 'x-test-account': 'signed-in', 'content-type': 'multipart/form-data; boundary=upload-test' },
  });
  partial.on('error', () => {});
  const stagingDir = join(uploadDir, '.staging');
  partial.write('--upload-test\r\nContent-Disposition: form-data; name="file"; filename="partial.mp4"\r\nContent-Type: video/mp4\r\n\r\n');
  partial.write(original.subarray(0, 128 * 1024));
  try {
    let staged = false;
    for (let attempt = 0; !staged && attempt < 100; attempt++) {
      const [directory] = await readdir(stagingDir);
      staged = !!directory && (await readdir(join(stagingDir, directory))).length > 0;
      if (!staged) await delay(10);
    }
    assert.ok(staged, 'The unfinished upload has reached the disk staging directory');
  } finally { partial.destroy(); }
  for (let attempt = 0; attempt < 100 && (await readdir(stagingDir)).length; attempt++) await delay(10);
  assert.deepEqual(await readdir(stagingDir), []);
  assert.equal(registered.length, 0);

  const media = new Uint8Array(original);
  const valid = await send(form(media));
  assert.equal(valid.status, 201);
  const { data } = await valid.json();
  assert.equal(data.version, 1);
  assert.deepEqual(data.project, { id: projectId, title: '경기 영상' });
  assert.equal(data.metadata.filename, '원본.MP4');
  assert.ok(data.metadata.duration > 0 && data.metadata.width > 0 && data.metadata.height > 0);
  assert.equal(data.file, undefined);
  assert.equal(registered[0].projectId, projectId);
  assert.equal(registered[0].file.size, media.byteLength);
  assert.notEqual(registered[0].file.filename, projectId + '.mp4');
  assert.deepEqual(registered[0].contentProfile, { purpose: '하이라이트', focus: '전반', signals: ['visual'] });
  assert.deepEqual(await readdir(join(uploadDir, '.staging')), []);

  rejectRegistration = true;
  const conflict = await send(form(media));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await readdir(join(uploadDir, '.staging')), []);
});

test('ffprobe가 실행되지 않으면 영상 분석이 오류를 반환한다', async () => {
  const previous = ffprobe.path;
  ffprobe.path = join(tmpdir(), 'horubak-missing-ffprobe-' + randomUUID());
  try {
    await assert.rejects(probeVideo('not-used.mp4'), error => error instanceof HttpError && error.code === 'VIDEO_PROBE_UNAVAILABLE');
  } finally { ffprobe.path = previous; }
});

test('실행 서버에 등록한 원본은 소유자의 작업공간과 범위 재생에 연결된다', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'horubak-source-test-'));
  const db = openDatabase(':memory:');
  const origin = 'http://127.0.0.1:5173';
  const app = await createApp(db, { origin, secureCookies: false, mountSources: mountProjectSources(db, directory) });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  async function signup(email: string) {
    const csrf = await fetch(base + '/api/auth/csrf');
    const response = await fetch(base + '/api/auth/signup', {
      method: 'POST', body: JSON.stringify({ email, name: '원본 검증', password: randomUUID() }),
      headers: { Origin: origin, Cookie: csrf.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': (await csrf.json()).csrfToken, 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 201);
    const { user, csrfToken } = await response.json();
    return { user, csrfToken, cookie: response.headers.getSetCookie()[0].split(';')[0] };
  }
  const owner = await signup('video-owner@example.com');
  const other = await signup('another-owner@example.com');
  const original = await readFile('../frontend/public/samples/pl-tottenham-arsenal-2010.mp4');
  const projectId = randomUUID();
  const form = new FormData();
  form.set('projectId', projectId);
  form.set('projectName', '저장된 원본');
  form.set('genre', 'general');
  form.set('inputType', 'FILE');
  form.set('file', new Blob([new Uint8Array(original)]), 'original.mp4');
  const headers = { Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrfToken, 'X-Workspace-Owner': owner.user.id, 'X-Workspace-Version': '0' };

  assert.equal((await (await fetch(base + '/api/health')).json()).sourceUploads, true);
  const registered = await fetch(base + '/api/projects', { method: 'POST', body: form, headers });
  assert.equal(registered.status, 201);
  const { project, version } = (await registered.json()).data;
  assert.equal(project.id, projectId);
  assert.equal(project.sourceUploaded, true);
  assert.equal(version, 1);
  const workspace = await fetch(base + '/api/workspace', { headers: { Cookie: owner.cookie } });
  assert.deepEqual(await workspace.json(), { ownerId: owner.user.id, version, projects: [project] });

  const playback = base + `/api/projects/${projectId}/source`;
  assert.equal((await fetch(playback, { headers: { Cookie: other.cookie } })).status, 404);
  const ranged = await fetch(playback, { headers: { Cookie: owner.cookie, Range: 'bytes=0-31' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), original.subarray(0, 32));

  const forged = { ...project, sourceName: 'changed.mov', duration: 100, sourceUploaded: false };
  const save = (version: number, projects: unknown[]) => fetch(base + '/api/workspace/session', {
    method: 'PUT', body: JSON.stringify({ ownerId: owner.user.id, version, projects }), headers: { ...headers, 'Content-Type': 'application/json' },
  });
  assert.equal((await save(version, [forged])).status, 200);
  const reloaded = (await (await fetch(base + '/api/workspace', { headers: { Cookie: owner.cookie } })).json()).projects[0];
  assert.equal(reloaded.sourceName, project.sourceName);
  assert.equal(reloaded.duration, project.duration);
  assert.equal(reloaded.sourceUploaded, true);
  assert.equal((await save(version + 1, [])).status, 200);
  assert.equal((await fetch(playback, { headers: { Cookie: owner.cookie } })).status, 404);
});
