import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const origin = 'http://127.0.0.1:5173';

test('새 가입 규칙 적용 후에도 기존 아이디와 비밀번호로 로그인한다', async t => {
  const db = openDatabase(':memory:');
  let closeServer: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await closeServer?.(); }
    finally { db.close(); }
  });
  const app = await createApp(db, { origin, secureCookies: false, rateLimit: 20 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  closeServer = () => new Promise<void>(resolve => server.close(() => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const previousAccounts = [
    { username: 'legacy_name_longer', password: '이전 계정 비밀번호 secret!' },
    { username: 'previous', password: 'PreviousPassword2026!' },
  ];
  for (const { username, password } of previousAccounts) {
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)')
      .run(id, '기존 회원', `${username}@test.example`, passwordHash, new Date().toISOString());
    db.prepare('INSERT INTO password_usernames(user_id,username) VALUES(?,?)').run(id, username);

    const csrf = await fetch(base + '/api/auth/csrf');
    const login = await fetch(base + '/api/auth/username/login', {
      method: 'POST',
      headers: { Origin: origin, Cookie: csrf.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': (await csrf.json()).csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ` ${username.toUpperCase()} `, password }),
    });

    assert.equal(login.status, 200);
    const { user } = await login.json();
    assert.equal(user.id, id);
    assert.equal(user.username, username);
  }
});

test('아이디 테이블을 추가한 SQLite는 기존 계정·세션·작업공간을 유지한다', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'horubak-username-'));
  let closeServer: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof openDatabase> | undefined;
  t.after(async () => {
    try { await closeServer?.(); }
    finally {
      database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  const path = join(directory, 'existing.sqlite');
  const id = randomUUID();
  const passwordHash = await hashPassword(randomUUID());
  const email = 'legacy@test.example';
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  const project = { id: 'existing-project', title: '이전 작업' };
  const old = new DatabaseSync(path);
  try {
    old.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, last_login_at TEXT, workspace_version INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE projects (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
        document TEXT NOT NULL, archived_at TEXT, PRIMARY KEY(owner_id, id)
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
    `);
    old.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at,workspace_version) VALUES(?,?,?,?,?,?,?)')
      .run(id, '기존 회원', email, passwordHash, 'admin', new Date().toISOString(), 7);
    old.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?)').run(id, project.id, JSON.stringify(project));
    old.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token), id, csrfToken, Date.now() + 60_000);
  } finally { old.close(); }

  const db = database = openDatabase(path);
  const app = await createApp(db, { origin, secureCookies: false, rateLimit: 20 });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  closeServer = () => new Promise<void>(resolve => server.close(() => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Cookie: 'horubak_session=' + token };
  assert.equal(db.prepare('SELECT username FROM password_usernames WHERE user_id=?').get(id), undefined);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(id)?.password_hash, passwordHash);
  const me = await fetch(base + '/api/auth/me', { headers });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: { id, name: '기존 회원', email, role: 'admin', guest: false }, csrfToken });
  const workspace = await fetch(base + '/api/workspace', { headers });
  assert.equal(workspace.status, 200);
  assert.deepEqual(await workspace.json(), { ownerId: id, version: 7, projects: [project] });
});
