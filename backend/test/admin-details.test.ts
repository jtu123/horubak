import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { hashToken } from '../src/security.js';

test('관리자 상세와 필터 API는 허용된 메타데이터만 조회한다', async t => {
  const db = openDatabase(':memory:');
  const adminSession = 'a'.repeat(64);
  const memberSession = 'b'.repeat(64);
  const before = '2026-11-13T14:59:59.999Z';
  const first = '2026-11-13T15:00:00.000Z';
  const last = '2026-11-14T14:59:59.999Z';
  const after = '2026-11-14T15:00:00.000Z';
  const members = [
    ['admin', '운영자', 'admin@example.com', 'admin', before],
    ['member', '영상 회원', 'member@example.com', 'user', first],
    ['social', '소셜 회원', 'social@example.com', 'user', last],
    ['legacy', '이전 회원', 'legacy@example.com', 'user', after],
  ];
  for (const [id, name, email, role, createdAt] of members) {
    db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, name, email, 'test-password-hash', role, createdAt);
  }
  db.prepare('INSERT INTO password_usernames(user_id,username) VALUES(?,?),(?,?)').run('admin', 'operator', 'member', 'videolab');
  db.prepare('INSERT INTO social_identities(provider,client_id,subject,user_id) VALUES(?,?,?,?),(?,?,?,?)')
    .run('google', 'private-client', 'private-subject', 'social', 'google', 'another-client', 'another-subject', 'social');
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?),(?,?,?,?)')
    .run(hashToken(adminSession), 'admin', 'secret-csrf', Date.now() + 60000,
      hashToken(memberSession), 'member', 'secret-csrf', Date.now() + 60000);

  const insertProject = db.prepare('INSERT INTO projects(owner_id,id,document,archived_at) VALUES(?,?,?,?)');
  insertProject.run('member', 'project', JSON.stringify({ title: '영상 프로젝트', status: 'ready', source: 'url', duration: 120.5,
    createdAt: first, updatedAt: last, sourceUrl: 'https://example.com/private-video', clips: [{ subtitle: 'private-subtitle' }] }), null);
  insertProject.run('member', 'old', JSON.stringify({ title: '보관 프로젝트', status: 'completed', updatedAt: after }), after);
  insertProject.run('social', 'project', JSON.stringify({ title: '다른 회원의 프로젝트', status: 'failed', createdAt: after, updatedAt: after }), null);
  db.prepare('INSERT INTO audit_log(id,actor_id,action,target_id,reason,created_at) VALUES(?,?,?,?,?,?),(?,?,?,?,?,?),(?,?,?,?,?,?),(?,?,?,?,?,?)')
    .run('log-before', 'admin', 'project.archive', 'member/project', '이전 날짜', before,
      'log-user', 'admin', 'user.update:user/active->user/suspended', 'member', '회원 조치', first,
      'log-project', 'admin', 'project.archive', 'member/project', '프로젝트 조치', last,
      'log-after', null, 'user.bootstrap-admin', 'admin', '다음 날짜', after);

  const app = await createApp(db, { origin: 'http://127.0.0.1:5173', secureCookies: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/admin';
  async function get(path: string, session = adminSession) {
    const response = await fetch(base + path, { headers: session ? { Cookie: 'horubak_session=' + session } : {} });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), data: await response.json() as any };
  }

  await t.test('회원 아이디·로그인 방식 검색, 한국 시간 가입일 경계 및 상세', async () => {
    const users = await get('/users?q=VIDEOLAB&method=password');
    assert.equal(users.status, 200);
    assert.equal(users.data.total, 1);
    assert.equal(users.data.items[0].username, 'videolab');
    assert.deepEqual(users.data.items[0].loginMethods, ['password']);
    const social = await get('/users?method=google&from=2026-11-14&to=2026-11-14');
    assert.equal(social.data.total, 1);
    assert.equal(social.data.items[0].id, 'social');
    assert.deepEqual(social.data.items[0].loginMethods, ['google']);
    const legacy = await get('/users?method=legacy');
    assert.equal(legacy.data.items[0].id, 'legacy');
    assert.equal(legacy.data.items[0].username, null);
    assert.deepEqual(legacy.data.items[0].loginMethods, ['legacy']);
    const day = await get('/users?from=2026-11-14&to=2026-11-14');
    assert.deepEqual(day.data.items.map((item: any) => item.id), ['social', 'member']);
    const detail = await get('/users/member');
    assert.equal(detail.status, 200);
    assert.equal(detail.cacheControl, 'no-store');
    assert.equal(detail.data.projectCount, 1);
    assert.equal(detail.data.archivedProjectCount, 1);
    assert.doesNotMatch(JSON.stringify({ detail, social }), /test-password-hash|private-client|private-subject|another-client|another-subject|secret-csrf/);
  });

  await t.test('복합 키 프로젝트 상세와 소유자·상태·등록일 필터', async () => {
    const result = await get('/projects?ownerId=member&status=ready&q=VIDEOLAB&from=2026-11-14&to=2026-11-14');
    assert.equal(result.data.total, 1);
    assert.equal(result.data.items[0].ownerId, 'member');
    const detail = await get('/projects/member/project');
    assert.equal(detail.status, 200);
    assert.equal(detail.data.ownerId, 'member');
    assert.equal(detail.data.source, 'url');
    assert.equal(detail.data.duration, 120.5);
    assert.equal(detail.data.createdAt, first);
    assert.equal(detail.data.clipCount, 1);
    assert.doesNotMatch(JSON.stringify(detail.data), /sourceUrl|private-video|document|private-subtitle/);
    assert.equal((await get('/projects/social/project')).data.title, '다른 회원의 프로젝트');
    const older = await get('/projects/member/old');
    assert.equal(older.data.createdAt, null);
    assert.equal(older.data.duration, null);
    assert.equal(older.data.source, null);
    assert.equal((await get('/projects/member/missing')).status, 404);
  });

  await t.test('감사 로그 종류·실행자·대상·일자와 페이지 집계를 일치시킨다', async () => {
    const day = await get('/activity?from=2026-11-14&to=2026-11-14&size=1');
    assert.equal(day.data.total, 2);
    assert.deepEqual(day.data.items.map((item: any) => item.id), ['log-project']);
    const userLog = await get('/activity?action=user.update&actor=OPERATOR&target=member');
    assert.equal(userLog.data.total, 1);
    assert.equal(userLog.data.items[0].actorId, 'admin');
    assert.equal(userLog.data.items[0].targetKind, 'user');
    const projectLog = await get('/activity?action=project.archive&actor=admin&target=member%2Fproject');
    assert.equal(projectLog.data.total, 2);
    assert.equal(projectLog.data.items[0].targetKind, 'project');
    assert.equal((await get('/activity?target=project')).data.total, 0);
    const cli = await get('/activity?action=user.bootstrap-admin');
    assert.equal(cli.data.items[0].actorId, null);
    assert.equal(cli.data.items[0].targetKind, 'user');
  });

  await t.test('관리자 권한, 잘못된 날짜, 실제 집계 확인 시각', async () => {
    for (const path of ['/users/member', '/projects/member/project', '/activity?target=member']) {
      assert.equal((await get(path, '')).status, 401);
      assert.equal((await get(path, memberSession)).status, 403);
    }
    assert.equal((await get('/users/missing')).status, 404);
    assert.equal((await get('/users?from=2026-02-30')).status, 400);
    assert.equal((await get('/projects?from=2026-11-15&to=2026-11-14')).status, 400);
    assert.equal((await get('/activity?from=2026-11-13&from=2026-11-14')).status, 400);
    const overview = await get('/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.data.database, 'connected');
    assert.match(overview.data.checkedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(overview.data.recentFrom, /^\d{4}-\d{2}-\d{2}$/);
    const checked = Date.parse(overview.data.checkedAt);
    const sixDaysEarlier = new Date(checked - 6 * 24 * 60 * 60 * 1000);
    const recentFrom = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short' }).format(sixDaysEarlier);
    assert.equal(overview.data.recentFrom, recentFrom);
    const start = Date.parse(recentFrom + 'T00:00:00+09:00');
    assert.equal(overview.data.recentSignups, members.filter(row => Date.parse(row[4]) >= start && Date.parse(row[4]) <= checked).length);
  });
});
