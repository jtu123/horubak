import type { Express } from 'express';
import { audit, transaction } from './database-contract.js';
import type { Database, UserRow } from './database-contract.js';
import { createSecurity, HttpError } from './security.js';
import * as validate from './validation.js';

export function mountAdmin(app: Express, db: Database, security: ReturnType<typeof createSecurity>) {
  app.use('/api/admin', (req, _res, next) => { security.admin(req); next(); });
  app.get('/api/admin/overview', (_req, res) => {
    const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
    res.json({ users: count('SELECT count(*) AS count FROM users'), activeUsers: count("SELECT count(*) AS count FROM users WHERE status='active'"), admins: count("SELECT count(*) AS count FROM users WHERE role='admin' AND status='active'"), projects: count('SELECT count(*) AS count FROM projects WHERE archived_at IS NULL'), archivedProjects: count('SELECT count(*) AS count FROM projects WHERE archived_at IS NOT NULL'), database: 'connected', analysis: 'not-connected', rendering: 'not-connected' });
  });
  app.get('/api/admin/users', (req, res) => {
    const { page, size, offset } = validate.pagination(req.query); const q = String(req.query.q ?? '').trim().slice(0, 200);
    const status = req.query.status === 'active' || req.query.status === 'suspended' ? req.query.status : '';
    const where = " WHERE (?='' OR instr(lower(u.name),lower(?))>0 OR instr(lower(u.email),lower(?))>0) AND (?='' OR u.status=?)";
    const args = [q, q, q, status, status];
    const total = (db.prepare('SELECT count(*) AS total FROM users u' + where).get(...args) as { total: number }).total;
    const items = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.status,u.created_at AS createdAt,u.last_login_at AS lastLoginAt,
      (SELECT count(*) FROM projects p WHERE p.owner_id=u.id AND p.archived_at IS NULL) AS projectCount FROM users u${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).all(...args, size, offset);
    res.json({ items, total, page, size });
  });
  app.patch('/api/admin/users/:id', (req, res) => {
    const actor = security.admin(req); const id = String(req.params.id); const body = validate.object(req.body);
    const reason = validate.text(body.reason, 300, '변경 사유', 5);
    if ((body.role !== undefined && (typeof body.role !== 'string' || !['user', 'admin'].includes(body.role))) || (body.status !== undefined && (typeof body.status !== 'string' || !['active', 'suspended'].includes(body.status))) || (body.role === undefined && body.status === undefined)) throw new HttpError(400, 'INVALID_INPUT', '역할 또는 상태를 확인해 주세요.');
    transaction(db, () => {
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow | undefined;
      if (!target) throw new HttpError(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
      const role = body.role === undefined ? target.role : String(body.role); const status = body.status === undefined ? target.status : String(body.status);
      if (actor.id === id && (role !== 'admin' || status !== 'active')) throw new HttpError(409, 'SELF_PROTECTED', '자신의 관리자 권한과 활성 상태는 변경할 수 없습니다.');
      if (target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active')) {
        const admins = db.prepare("SELECT count(*) AS count FROM users WHERE role='admin' AND status='active'").get() as { count: number };
        if (admins.count <= 1) throw new HttpError(409, 'LAST_ADMIN', '활성 관리자 한 명은 유지해야 합니다.');
      }
      db.prepare('UPDATE users SET role=?,status=? WHERE id=?').run(role, status, id);
      if (role !== target.role || status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(db, actor.id, `user.update:${target.role}/${target.status}->${role}/${status}`, id, reason);
    });
    res.json({ success: true });
  });
  app.get('/api/admin/projects', (req, res) => {
    const { page, size, offset } = validate.pagination(req.query); const q = String(req.query.q ?? '').trim().slice(0, 200);
    const archived = req.query.archived === 'true' ? 1 : 0;
    const where = " WHERE (p.archived_at IS NOT NULL)=? AND (?='' OR instr(lower(json_extract(p.document,'$.title')),lower(?))>0 OR instr(lower(u.email),lower(?))>0)";
    const args = [archived, q, q, q];
    const total = (db.prepare('SELECT count(*) AS total FROM projects p JOIN users u ON u.id=p.owner_id' + where).get(...args) as { total: number }).total;
    const items = db.prepare(`SELECT p.id,p.owner_id AS ownerId,u.name AS ownerName,u.email AS ownerEmail,p.archived_at AS archivedAt,
      json_extract(p.document,'$.title') AS title,json_extract(p.document,'$.status') AS status,json_extract(p.document,'$.updatedAt') AS updatedAt,
      coalesce(json_array_length(p.document,'$.clips'),0) AS clipCount FROM projects p JOIN users u ON u.id=p.owner_id${where}
      ORDER BY json_extract(p.document,'$.updatedAt') DESC,p.id LIMIT ? OFFSET ?`).all(...args, size, offset);
    res.json({ items, total, page, size });
  });
  app.patch('/api/admin/projects/:ownerId/:id', (req, res) => {
    const actor = security.admin(req); const ownerId = String(req.params.ownerId); const id = String(req.params.id); const body = validate.object(req.body);
    const reason = validate.text(body.reason, 300, '변경 사유', 5);
    if (typeof body.archived !== 'boolean') throw new HttpError(400, 'INVALID_INPUT', '보관 상태를 확인해 주세요.');
    transaction(db, () => {
      if (!db.prepare('SELECT id FROM projects WHERE owner_id=? AND id=?').get(ownerId, id)) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      db.prepare('UPDATE projects SET archived_at=? WHERE owner_id=? AND id=?').run(body.archived ? new Date().toISOString() : null, ownerId, id);
      db.prepare('UPDATE users SET workspace_version=workspace_version+1 WHERE id=?').run(ownerId);
      audit(db, actor.id, body.archived ? 'project.archive' : 'project.restore', ownerId + '/' + id, reason);
    });
    res.json({ success: true });
  });
  app.get('/api/admin/activity', (req, res) => {
    const { page, size, offset } = validate.pagination(req.query);
    const total = (db.prepare('SELECT count(*) AS total FROM audit_log').get() as { total: number }).total;
    const items = db.prepare('SELECT a.id,a.action,a.target_id AS targetId,a.reason,a.created_at AS createdAt,u.name AS actorName,u.email AS actorEmail FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?').all(size, offset);
    res.json({ items, total, page, size });
  });
}
