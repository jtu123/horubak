import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { hashPassword, verifyPassword } from '../src/security.js';
import { signupPassword, signupUsername } from '../src/validation.js';

const origin = 'http://127.0.0.1:5173';
const password = 'Test' + randomUUID().replaceAll('-', '').slice(0, 11);
const memberUsername = 'member2026';

test('가입 정책은 아이디 3~10자와 비밀번호 7~15자의 경계를 검사한다', () => {
  assert.equal(signupUsername('aB1'), 'ab1');
  assert.equal(signupUsername('1234567890'), '1234567890');
  for (const invalid of ['ab', 'abcdefghijk', 'new_user', ' newuser', 'newuser\n', '\u212Ainvalid']) {
    assert.throws(() => signupUsername(invalid), { code: 'INVALID_USERNAME' });
  }
  for (const valid of ['abcdefg', 'ABCDEFG', '1234567', 'aB12345', 'a'.repeat(15)]) {
    assert.equal(signupPassword(valid), valid);
  }
  for (const invalid of ['abcdef', 'a'.repeat(16), 'abcdef!', 'abc defg', 'abcdefg\n', 'abcde한글']) {
    assert.throws(() => signupPassword(invalid), { code: 'INVALID_PASSWORD' });
  }
});

test('실제 인증과 관리자 API의 권한·저장·복구', async t => {
  const path = join(tmpdir(), 'horubak-test-' + randomUUID() + '.sqlite');
  const db = openDatabase(path);
  const app = await createApp(db, { origin, secureCookies: false, rateLimit: 200 });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  class Client {
    cookie = ''; csrf = '';
    async send(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
      const response = await fetch(base + path, { method, headers: { Cookie: this.cookie, Origin: origin, ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0]!;
      const data = await response.json() as any;
      if (data.csrfToken) this.csrf = data.csrfToken;
      return { response, data };
    }
    async init() { return this.send('/api/auth/csrf'); }
    async signup(email: string, username = email.split('@')[0]) { await this.init(); return this.send('/api/auth/username/signup', 'POST', { email, username, name: '테스트 회원', password, role: 'admin' }); }
    async login(username: string) { await this.init(); return this.send('/api/auth/username/login', 'POST', { username, password }); }
  }
  const admin = new Client(); const member = new Client(); const stranger = new Client();
  let adminId = ''; let memberId = '';
  const project = { id: 'owned-project', title: '실제 저장 검증', genre: 'general', status: 'ready', duration: 120, progress: 100, favorite: false, source: 'url', sourceName: '영상 주소', sourceUrl: 'https://example.com/video.mp4', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), clips: [] };
  try {
    await t.test('익명 접근·출처·CSRF 검증과 HttpOnly 쿠키', async () => {
      assert.equal((await stranger.send('/api/admin/users')).response.status, 401);
      const init = await stranger.init();
      const cookie = init.response.headers.get('set-cookie')!;
      assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
      const form = { name: '외부 입력', email: 'bad@example.com', username: 'external', password };
      assert.equal((await stranger.send('/api/auth/username/signup', 'POST', form, { 'X-CSRF-Token': '' })).response.status, 403);
      assert.equal((await stranger.send('/api/auth/username/signup', 'POST', form, { 'X-CSRF-Token': 'Z'.repeat(64) })).response.status, 403);
      assert.equal((await stranger.send('/api/auth/username/signup', 'POST', form, { Origin: 'https://evil.example' })).response.status, 403);
    });
    await t.test('회원가입·기본 역할·비밀번호 해시·중복/약한 입력', async () => {
      const first = await admin.signup('admin@test.example'); adminId = first.data.user.id;
      assert.equal(first.response.status, 201); assert.equal(first.data.user.role, 'user');
      const second = await member.signup('member@test.example', 'Member2026'); memberId = second.data.user.id;
      assert.equal(second.response.status, 201);
      assert.equal(second.data.user.username, memberUsername);
      assert.equal((await member.send('/api/auth/me')).data.user.username, memberUsername);
      assert.equal((await stranger.send('/api/auth/username/login', 'POST', { username: 'MEMBER2026', password: password.toLowerCase() })).response.status, 401);
      assert.equal((await stranger.send('/api/auth/username/login', 'POST', { email: 'member@test.example', password })).response.status, 400);
      const oldLogin = await stranger.send('/api/auth/login', 'POST', { email: 'member@test.example', password });
      const oldSignup = await stranger.send('/api/auth/signup', 'POST', { name: '구형 화면', email: 'old@test.example', password });
      for (const { response, data } of [oldLogin, oldSignup]) {
        assert.equal(response.status, 409);
        assert.equal(data.code, 'AUTH_CLIENT_OUTDATED');
        assert.equal(response.headers.get('set-cookie'), null);
      }
      assert.equal((await stranger.signup('MEMBER@test.example')).response.status, 409);
      const taken = await stranger.signup('different@test.example', 'MEMBER2026');
      assert.equal(taken.response.status, 409);
      assert.equal(taken.data.code, 'USERNAME_EXISTS');
      assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get('different@test.example'), undefined);
      const invalid = await stranger.signup('different@test.example', '\u212Ainvalid');
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.data.code, 'INVALID_USERNAME');
      const legacyUsername = await stranger.signup('different@test.example', 'member_1');
      assert.equal(legacyUsername.response.status, 400);
      assert.equal(legacyUsername.data.code, 'INVALID_USERNAME');
      for (const invalidPassword of ['abcdef', 'abcdef!', 'a'.repeat(16)]) {
        const rejected = await stranger.send('/api/auth/username/signup', 'POST', { name: '회원', email: 'weak@test.example', username: 'weak', password: invalidPassword });
        assert.equal(rejected.response.status, 400);
        assert.equal(rejected.data.code, 'INVALID_PASSWORD');
      }
      const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(memberId) as { password_hash: string };
      assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$/); assert.ok(!row.password_hash.includes(password));
      assert.ok(!JSON.stringify(second.data).includes('password'));
      const hash = await hashPassword(password); assert.notEqual(hash, row.password_hash);
      assert.equal(await verifyPassword(password, hash), true); assert.equal(await verifyPassword('incorrect', hash), false);
    });
    await t.test('일반 회원의 관리자 API 차단과 서버 CLI 관리자 지정', async () => {
      assert.equal((await member.send('/api/admin/overview')).response.status, 403);
      assert.equal((await member.send('/api/admin/users')).response.status, 403);
      assert.equal((await member.send('/api/admin/projects')).response.status, 403);
      assert.equal((await member.send('/api/admin/activity')).response.status, 403);
      const adminCli = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/admin.ts', '--', ...args], { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' });
      assert.equal(adminCli(['admin@test.example']).status, 1);
      assert.equal((await admin.send('/api/auth/me')).data.user.role, 'user');
      const cli = adminCli(['--verified-account', adminId]);
      assert.equal(cli.status, 0, cli.stderr);
      assert.equal((await admin.send('/api/auth/me')).response.status, 401);
      const login = await admin.login('ADMIN');
      assert.equal(login.response.status, 200); assert.equal(login.data.user.role, 'admin');
      assert.equal((await admin.send('/api/admin/overview')).response.status, 200);
    });
    await t.test('사용자별 프로젝트 격리·저장 버전·요청 검증', async () => {
      const sourceUrl = 'https://example.com/video.mp4?key=' + 'x'.repeat(2800);
      const draft = { ...project, sourceName: sourceUrl, sourceUrl, clips: [{ id: 'draft', title: '초안', edit: { start: 95, end: 40, subtitle: '' } }] };
      const request = { ownerId: memberId, version: 0, projects: [draft] };
      const switchedAccount = await admin.send('/api/workspace/session', 'PUT', request);
      assert.equal(switchedAccount.response.status, 409);
      assert.equal(switchedAccount.data.code, 'WORKSPACE_ACCOUNT_CHANGED');
      assert.deepEqual((await admin.send('/api/workspace')).data, { ownerId: adminId, version: 0, projects: [] });
      const oldClient = await member.send('/api/workspace', 'PUT', { version: 0, projects: [] });
      assert.equal(oldClient.response.status, 409);
      assert.equal(oldClient.data.code, 'WORKSPACE_CLIENT_OUTDATED');
      assert.equal((await member.send('/api/workspace/session', 'PUT', request)).response.status, 200);
      const saved = await member.send('/api/workspace');
      assert.deepEqual(saved.data, { ownerId: memberId, version: 1, projects: [draft] });
      assert.equal((await admin.send('/api/projects/' + project.id)).response.status, 404);
      assert.equal((await member.send('/api/projects/' + project.id)).response.status, 200);
      assert.deepEqual((await admin.send('/api/workspace')).data.projects, []);
      assert.equal((await member.send('/api/workspace/session', 'PUT', { ownerId: memberId, version: 0, projects: [] })).response.status, 409);
      assert.equal((await member.send('/api/workspace/session', 'PUT', { ownerId: memberId, version: 1, projects: [{ ...project, status: 'made-up' }] })).response.status, 400);
      assert.equal((await member.send('/api/workspace/session', 'PUT', { ownerId: memberId, version: 1, projects: [{ ...project, sourceUrl: 'javascript:alert(1)' }] })).response.status, 400);
      assert.equal((await member.send('/api/admin/users/' + adminId, 'PATCH', { role: 'user', reason: '권한 위조 시도' })).response.status, 403);
    });
    await t.test('관리자 회원 검색·페이지·비밀정보 제외·자기 보호', async () => {
      const users = await admin.send('/api/admin/users?q=member');
      assert.equal(users.data.total, 1); assert.equal(users.data.items[0].id, memberId); assert.equal(users.data.items[0].projectCount, 1);
      assert.ok(!JSON.stringify(users.data).includes('password')); assert.ok(!JSON.stringify(users.data).includes('token'));
      assert.equal((await admin.send('/api/admin/users?page=-1')).response.status, 400);
      assert.equal((await admin.send('/api/admin/users/' + adminId, 'PATCH', { role: 'user', reason: '자신의 권한 제거' })).response.status, 409);
      assert.equal((await admin.send('/api/admin/users/' + adminId, 'PATCH', { status: 'suspended', reason: '자신의 이용 정지' })).response.status, 409);
      assert.equal((await admin.send('/api/admin/users/' + memberId, 'PATCH', { status: 'suspended', reason: '짧음' })).response.status, 400);
      assert.equal((await admin.send('/api/admin/users/' + memberId, 'PATCH', { role: ['admin'], reason: '잘못된 배열 역할 입력' })).response.status, 400);
    });
    await t.test('프로젝트 보관·복원과 오래된 저장의 부활 방지', async () => {
      const path = `/api/admin/projects/${memberId}/${project.id}`;
      assert.equal((await admin.send(path, 'PATCH', { archived: true, reason: '운영 검증을 위한 보관' })).response.status, 200);
      assert.equal((await member.send('/api/workspace')).data.projects.length, 0);
      assert.equal((await member.send('/api/projects/' + project.id)).response.status, 404);
      assert.equal((await member.send('/api/workspace/session', 'PUT', { ownerId: memberId, version: 1, projects: [project] })).response.status, 409);
      assert.equal((await member.send('/api/workspace/session', 'PUT', { ownerId: memberId, version: 2, projects: [project] })).response.status, 409);
      assert.equal((await admin.send('/api/admin/projects?archived=true')).data.total, 1);
      assert.equal((await admin.send(path, 'PATCH', { archived: false, reason: '운영 검증 후 원상 복원' })).response.status, 200);
      assert.equal((await member.send('/api/workspace')).data.projects.length, 1);
    });
    await t.test('이용 정지 시 기존 세션 무효화·복구 후 재로그인', async () => {
      const secondDevice = new Client(); await secondDevice.login(memberUsername);
      await admin.send('/api/admin/users/' + memberId, 'PATCH', { status: 'suspended', reason: '정지 세션 무효화 검증' });
      assert.equal((await member.send('/api/auth/me')).response.status, 401);
      assert.equal((await secondDevice.send('/api/workspace')).response.status, 401);
      assert.equal((await member.login(memberUsername)).response.status, 401);
      await admin.send('/api/admin/users/' + memberId, 'PATCH', { status: 'active', reason: '이용 복구 검증 완료' });
      assert.equal((await secondDevice.send('/api/auth/me')).response.status, 401);
      assert.equal((await member.login(memberUsername)).response.status, 200);
    });
    await t.test('권한 변경 후 세션 재인증·감사 이력·정상 로그아웃', async () => {
      await admin.send('/api/admin/users/' + memberId, 'PATCH', { role: 'admin', reason: '관리 권한 변경 검증' });
      assert.equal((await member.send('/api/auth/me')).response.status, 401);
      assert.equal((await member.login(memberUsername)).data.user.role, 'admin');
      await admin.send('/api/admin/users/' + memberId, 'PATCH', { role: 'user', reason: '일반 회원 권한 복원' });
      assert.equal((await member.send('/api/admin/overview')).response.status, 401);
      const log = await admin.send('/api/admin/activity?size=100');
      assert.ok(log.data.items.some((item: any) => item.action === 'project.archive' && item.reason === '운영 검증을 위한 보관'));
      assert.ok(!JSON.stringify(log.data).includes(password)); assert.ok(!JSON.stringify(log.data).includes('password_hash'));
      const oldCookie = admin.cookie;
      assert.equal((await admin.send('/api/auth/logout', 'POST', {})).data.code, 'WORKSPACE_CLIENT_OUTDATED');
      const switched = await admin.send('/api/auth/session/logout', 'POST', { ownerId: memberId });
      assert.equal(switched.response.status, 409);
      assert.equal(switched.data.code, 'WORKSPACE_ACCOUNT_CHANGED');
      assert.equal(switched.response.headers.get('set-cookie'), null);
      assert.equal((await admin.send('/api/auth/me')).data.user.id, adminId);
      assert.equal((await admin.send('/api/auth/session/logout', 'POST', { ownerId: adminId })).response.status, 200);
      admin.cookie = oldCookie; assert.equal((await admin.send('/api/auth/me')).response.status, 401);
    });
    await t.test('파일 DB를 다른 연결에서 읽을 수 있고 세션 만료를 거부', async () => {
      await member.login(memberUsername);
      const copy = openDatabase(path);
      try {
        assert.equal((copy.prepare('SELECT count(*) AS count FROM users').get() as any).count, 2);
        const restored = await createApp(copy, { origin, secureCookies: false });
        const restarted = restored.listen(0, '127.0.0.1'); await new Promise<void>(resolve => restarted.once('listening', resolve));
        try {
          const address = restarted.address(); assert.ok(address && typeof address !== 'string');
          const response = await fetch('http://127.0.0.1:' + address.port + '/api/auth/me', { headers: { Cookie: member.cookie } });
          assert.equal(response.status, 200); assert.equal((await response.json() as any).user.id, memberId);
        } finally { await new Promise<void>(resolve => restarted.close(() => resolve())); }
      } finally { copy.close(); }
      db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(memberId);
      assert.equal((await member.send('/api/auth/me')).response.status, 401);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close(); for (const file of [path, path + '-wal', path + '-shm']) if (existsSync(file)) unlinkSync(file);
  }
});

test('로그인 호출 제한과 운영용 Secure 쿠키', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp(db, { origin, secureCookies: true, rateLimit: 2 });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
  try {
    const response = await fetch(base + '/api/auth/csrf'); const data = await response.json() as any;
    assert.match(response.headers.get('set-cookie')!, /__Host-horubak_session/); assert.match(response.headers.get('set-cookie')!, /; Secure/);
    const headers = { Origin: origin, Cookie: response.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken };
    for (const expected of [401, 401, 429]) {
      const attempt = await fetch(base + '/api/auth/username/login', { method: 'POST', headers, body: JSON.stringify({ username: 'unknown_user', password }) });
      assert.equal(attempt.status, expected);
    }
    assert.equal((await fetch(base + '/api/auth/csrf')).status, 200);
    assert.equal((await fetch(base + '/api/auth/csrf')).status, 429);
    const existing = await fetch(base + '/api/auth/csrf', { headers: { Cookie: headers.Cookie } });
    assert.equal(existing.status, 200);
    assert.equal((await existing.json() as { csrfToken: string }).csrfToken, data.csrfToken);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
