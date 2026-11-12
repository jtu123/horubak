import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit, publicUser, transaction } from './database-contract.js';
import type { Database, UserRow } from './database-contract.js';
import { createSecurity, hashPassword, HttpError, verifyPassword } from './security.js';
import type { SecurityOptions } from './security.js';
import * as validate from './validation.js';
import { mountAdmin } from './admin.js';
import { mountSocialAuth } from './social-auth.js';
import type { SocialProviders } from './social-providers.js';

export interface ServerOptions extends SecurityOptions { staticDirectory?: string; trustProxy?: boolean; socialProviders?: SocialProviders }
export async function createApp(db: Database, options: ServerOptions) {
  const app = express(); const security = createSecurity(db, options);
  const dummyHash = await hashPassword(randomUUID());
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next(); });
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    next();
  });
  mountSocialAuth(app, db, security, options);
  app.use('/api', express.json({ limit: '4mb' }), security.mutation);
  app.get('/api/health', (_req, res) => res.json({ success: true, database: 'connected' }));
  app.get('/api/auth/csrf', (req, res) => {
    const session = security.session(req);
    if (!session) security.rateAnonymousSession(req);
    const csrfToken = session?.csrf ?? security.issue(req, res, null);
    res.json({ csrfToken, headerName: 'X-CSRF-Token' });
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(security.user(req)), csrfToken: security.session(req)!.csrf }));
  app.post('/api/auth/signup', async (req, res) => {
    const body = validate.object(req.body); const email = validate.email(body.email);
    const name = validate.text(body.name, 50, '이름'); const password = validate.password(body.password, true);
    security.rate(req, email);
    const passwordHash = await hashPassword(password);
    const row = transaction(db, () => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new HttpError(409, 'EMAIL_EXISTS', '이미 가입된 이메일입니다. 로그인해 주세요.');
      const id = randomUUID(); const now = new Date().toISOString();
      db.prepare('INSERT INTO users(id,name,email,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,?)').run(id, name, email, passwordHash, now, now);
      audit(db, id, 'account.signup', id);
      return db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow;
    });
    res.status(201).json({ user: publicUser(row), csrfToken: security.issue(req, res, row.id) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const body = validate.object(req.body); const email = validate.email(body.email); const password = validate.password(body.password);
    security.rate(req, email);
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as unknown as UserRow | undefined;
    const correct = await verifyPassword(password, row?.password_hash ?? dummyHash);
    if (!correct || !row || row.status !== 'active') throw new HttpError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호를 확인해 주세요.');
    // An administrator may suspend the account while password verification is running.
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(row.id) as unknown as UserRow;
    if (current.status !== 'active') throw new HttpError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호를 확인해 주세요.');
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), current.id);
    audit(db, current.id, 'account.login', current.id);
    res.json({ user: publicUser(current), csrfToken: security.issue(req, res, current.id) });
  });
  app.post('/api/auth/logout', (req, res) => { security.logout(req, res); res.json({ success: true }); });
  app.get('/api/workspace', (req, res) => {
    const owner = security.user(req);
    const rows = db.prepare("SELECT document FROM projects WHERE owner_id=? AND archived_at IS NULL ORDER BY json_extract(document,'$.updatedAt') DESC").all(owner.id) as { document: string }[];
    res.json({ ownerId: owner.id, version: owner.workspace_version, projects: rows.map(row => JSON.parse(row.document)) });
  });
  app.put('/api/workspace', (req, res) => {
    const owner = security.user(req); const body = validate.object(req.body);
    if (typeof body.ownerId !== 'string' || !Number.isSafeInteger(body.version) || !Array.isArray(body.projects) || body.projects.length > 100) throw new HttpError(400, 'INVALID_WORKSPACE', '저장 형식을 확인해 주세요.');
    if (body.ownerId !== owner.id) throw new HttpError(409, 'WORKSPACE_ACCOUNT_CHANGED', '다른 계정으로 로그인했어요. 편집 정보를 백업하고 서버 내용을 다시 불러와 주세요.');
    const documents = body.projects.map(validate.project); const ids = documents.map(doc => doc.id as string);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'DUPLICATE_PROJECT', '중복된 프로젝트가 있습니다.');
    const version = transaction(db, () => {
      const current = db.prepare('SELECT workspace_version FROM users WHERE id=?').get(owner.id) as { workspace_version: number };
      if (current.workspace_version !== body.version) throw new HttpError(409, 'VERSION_CONFLICT', '다른 창 또는 관리자가 변경했습니다. 서버 내용을 다시 불러와 주세요.');
      for (const doc of documents) {
        const existing = db.prepare('SELECT archived_at FROM projects WHERE owner_id=? AND id=?').get(owner.id, doc.id as string) as { archived_at: string | null } | undefined;
        if (existing?.archived_at) throw new HttpError(409, 'VERSION_CONFLICT', '보관된 프로젝트가 있습니다. 서버 내용을 다시 불러와 주세요.');
        db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET document=excluded.document').run(owner.id, doc.id as string, JSON.stringify(doc));
      }
      const active = db.prepare('SELECT id FROM projects WHERE owner_id=? AND archived_at IS NULL').all(owner.id) as { id: string }[];
      for (const row of active) if (!ids.includes(row.id)) db.prepare('UPDATE projects SET archived_at=? WHERE owner_id=? AND id=?').run(new Date().toISOString(), owner.id, row.id);
      db.prepare('UPDATE users SET workspace_version=workspace_version+1 WHERE id=?').run(owner.id);
      return current.workspace_version + 1;
    });
    res.json({ version });
  });
  app.get('/api/projects/:id', (req, res) => {
    const owner = security.user(req);
    const row = db.prepare('SELECT document FROM projects WHERE owner_id=? AND id=? AND archived_at IS NULL').get(owner.id, String(req.params.id)) as { document: string } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    res.json({ project: JSON.parse(row.document) });
  });
  mountAdmin(app, db, security);
  app.use('/api', (_req, _res) => { throw new HttpError(404, 'NOT_FOUND', 'API를 찾을 수 없습니다.'); });
  if (options.staticDirectory) {
    const directory = resolve(options.staticDirectory);
    if (!existsSync(resolve(directory, 'index.html'))) throw new Error('FRONTEND_DIST에 빌드된 index.html이 없습니다.');
    app.use(express.static(directory));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(directory, 'index.html')));
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const known = error instanceof HttpError;
    const parse = error?.type === 'entity.parse.failed'; const large = error?.type === 'entity.too.large';
    if (known && error.status === 429) res.set('Retry-After', '900');
    if (!known && !parse && !large) console.error('API error:', error instanceof Error ? error.message : 'unknown');
    res.status(known ? error.status : parse ? 400 : large ? 413 : 500).json({ code: known ? error.code : 'REQUEST_FAILED', message: known ? error.message : parse ? 'JSON 형식을 확인해 주세요.' : large ? '요청 크기가 너무 큽니다.' : '요청을 처리하지 못했습니다.' });
  };
  app.use(errors);
  return app;
}
