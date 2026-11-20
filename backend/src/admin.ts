import type { Express } from 'express';
import { audit } from './database-contract.js';
import type { Database, SqlValue, UserRow } from './database-contract.js';
import { createSecurity, HttpError } from './security.js';
import * as validate from './validation.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SOCIAL_METHODS = ['google', 'naver', 'apple'] as const;
const ACTIVITY_ACTIONS = ['account.signup', 'account.login', 'user.update', 'user.bootstrap-admin', 'project.archive', 'project.restore'];
const PROJECT_STATUSES = ['ready', 'processing', 'completed', 'failed', 'cancelled'];

function searchTerm(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function calendarDay(value: unknown) {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    const midnight = Date.parse(value + 'T00:00:00.000Z');
    if (Number.isFinite(midnight) && new Date(midnight).toISOString().slice(0, 10) === value) return midnight - KST_OFFSET_MS;
  }
  throw new HttpError(400, 'INVALID_DATE_RANGE', '날짜를 확인해 주세요.');
}

type Filter = { sql: string; values: SqlValue[] };
function dateFilters(column: string, query: Record<string, unknown>): Filter[] {
  const from = calendarDay(query.from);
  const to = calendarDay(query.to);
  if (from !== undefined && to !== undefined && from > to) throw new HttpError(400, 'INVALID_DATE_RANGE', '종료일은 시작일 이후여야 합니다.');
  return [
    ...(from === undefined ? [] : [{ sql: `julianday(${column}) >= julianday(?)`, values: [new Date(from).toISOString()] }]),
    ...(to === undefined ? [] : [{ sql: `julianday(${column}) < julianday(?)`, values: [new Date(to + DAY_MS).toISOString()] }]),
  ];
}

function containsAny(q: string, columns: string[]): Filter[] {
  return q ? [{ sql: '(' + columns.map(column => `instr(lower(${column}),lower(?))>0`).join(' OR ') + ')', values: columns.map(() => q) }] : [];
}

function paginate(db: Database, query: Record<string, unknown>, columns: string, from: string, filters: Filter[], order: string) {
  const { page, size, offset } = validate.pagination(query);
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, 'INVALID_INPUT', '페이지 범위를 확인해 주세요.');
  const where = filters.length ? ' WHERE ' + filters.map(filter => filter.sql).join(' AND ') : '';
  const values = filters.flatMap(filter => filter.values);
  const total = (db.prepare('SELECT count(*) AS total ' + from + where).get(...values) as { total: number }).total;
  const items = db.prepare(`SELECT ${columns} ${from}${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, size, offset);
  return { items, total, page, size };
}

const MEMBER_FROM = 'FROM users u LEFT JOIN password_usernames n ON n.user_id=u.id';
const MEMBER_COLUMNS = `u.id,u.name,u.email,u.role,u.status,u.created_at AS createdAt,u.last_login_at AS lastLoginAt,n.username,
  (SELECT count(*) FROM projects p WHERE p.owner_id=u.id AND p.archived_at IS NULL) AS projectCount,
  (SELECT json_group_array(DISTINCT provider) FROM social_identities WHERE user_id=u.id) AS providers`;

function memberMetadata({ providers, ...member }: Record<string, unknown>) {
  const linked: unknown = JSON.parse(String(providers));
  const social = Array.isArray(linked) ? linked : [];
  const loginMethods = [
    ...(member.username === null ? [] : ['password']),
    ...SOCIAL_METHODS.filter(provider => social.includes(provider)),
  ];
  if (member.username === null && social.length === 0) loginMethods.push('legacy');
  return { ...member, loginMethods };
}

const PROJECT_FROM = 'FROM projects p JOIN users u ON u.id=p.owner_id';
const PROJECT_CREATED = "json_extract(p.document,'$.createdAt')";
const PROJECT_UPDATED = "json_extract(p.document,'$.updatedAt')";
const PROJECT_TITLE = "CASE WHEN json_type(p.document,'$.title')='text' AND trim(json_extract(p.document,'$.title'))<>'' THEN json_extract(p.document,'$.title') ELSE '제목 없음' END";
const PROJECT_STATUS = "json_extract(p.document,'$.status')";
const PROJECT_COLUMNS = `p.id,p.owner_id AS ownerId,u.name AS ownerName,u.email AS ownerEmail,p.archived_at AS archivedAt,
  ${PROJECT_TITLE} AS title,
  CASE WHEN ${PROJECT_STATUS} IN ('ready','processing','completed','failed','cancelled') THEN ${PROJECT_STATUS} ELSE 'unknown' END AS status,
  CASE WHEN json_type(p.document,'$.updatedAt')='text' THEN ${PROJECT_UPDATED} END AS updatedAt,
  coalesce(json_array_length(p.document,'$.clips'),0) AS clipCount`;

function validTimestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function mountAdmin(app: Express, db: Database, security: ReturnType<typeof createSecurity>) {
  app.use('/api/admin', (req, _res, next) => { security.admin(req); next(); });
  app.get('/api/admin/overview', (_req, res) => {
    const now = Date.now();
    const checkedAt = new Date(now).toISOString();
    const recentFrom = new Date(now + KST_OFFSET_MS - 6 * DAY_MS).toISOString().slice(0, 10);
    const recentFromUtc = new Date(calendarDay(recentFrom)!).toISOString();
    const members = db.prepare(`SELECT count(*) AS users,
      count(*) FILTER (WHERE status='active') AS activeUsers,
      count(*) FILTER (WHERE role='admin' AND status='active') AS admins,
      count(*) FILTER (WHERE julianday(created_at) BETWEEN julianday(?) AND julianday(?)) AS recentSignups FROM users`)
      .get(recentFromUtc, checkedAt);
    const projects = db.prepare(`SELECT count(*) FILTER (WHERE archived_at IS NULL) AS projects,
      count(*) FILTER (WHERE archived_at IS NOT NULL) AS archivedProjects FROM projects`).get();
    res.json({ ...members, ...projects, database: 'connected', analysis: 'not-connected', rendering: 'not-connected', checkedAt, recentFrom });
  });
  app.get('/api/admin/users', (req, res) => {
    const { status, method } = req.query;
    const filters = [...containsAny(searchTerm(req.query.q), ['u.name', 'u.email', 'n.username']), ...dateFilters('u.created_at', req.query)];
    if (status === 'active' || status === 'suspended') filters.push({ sql: 'u.status=?', values: [status] });
    if (method === 'password') filters.push({ sql: 'n.username IS NOT NULL', values: [] });
    if (method === 'legacy') filters.push({ sql: 'n.username IS NULL AND NOT EXISTS (SELECT 1 FROM social_identities s WHERE s.user_id=u.id)', values: [] });
    const socialMethod = SOCIAL_METHODS.find(provider => provider === method);
    if (socialMethod) {
      filters.push({ sql: 'EXISTS (SELECT 1 FROM social_identities s WHERE s.user_id=u.id AND s.provider=?)', values: [socialMethod] });
    }
    const result = paginate(db, req.query, MEMBER_COLUMNS, MEMBER_FROM, filters, 'u.created_at DESC,u.id');
    res.json({ ...result, items: result.items.map(memberMetadata) });
  });
  app.get('/api/admin/users/:id', (req, res) => {
    const member = db.prepare(`SELECT ${MEMBER_COLUMNS},
      (SELECT count(*) FROM projects p WHERE p.owner_id=u.id AND p.archived_at IS NOT NULL) AS archivedProjectCount
      ${MEMBER_FROM} WHERE u.id=?`).get(String(req.params.id));
    if (!member) throw new HttpError(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
    res.json(memberMetadata(member));
  });
  app.patch('/api/admin/users/:id', (req, res) => {
    const actor = security.admin(req); const id = String(req.params.id); const body = validate.object(req.body);
    const reason = validate.text(body.reason, 300, '변경 사유', 5);
    if ((body.role !== undefined && (typeof body.role !== 'string' || !['user', 'admin'].includes(body.role))) || (body.status !== undefined && (typeof body.status !== 'string' || !['active', 'suspended'].includes(body.status))) || (body.role === undefined && body.status === undefined)) throw new HttpError(400, 'INVALID_INPUT', '역할 또는 상태를 확인해 주세요.');
    db.transaction(() => {
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
    const { ownerId, status } = req.query;
    const filters = [
      { sql: '(p.archived_at IS NOT NULL)=?', values: [req.query.archived === 'true' ? 1 : 0] },
      ...containsAny(searchTerm(req.query.q), [PROJECT_TITLE, 'u.name', 'u.email', 'n.username']),
      ...dateFilters(PROJECT_CREATED, req.query),
    ];
    if (typeof ownerId === 'string' && ownerId) filters.push({ sql: 'p.owner_id=?', values: [ownerId] });
    if (typeof status === 'string' && PROJECT_STATUSES.includes(status)) filters.push({ sql: `${PROJECT_STATUS}=?`, values: [status] });
    const result = paginate(db, req.query, PROJECT_COLUMNS, PROJECT_FROM + ' LEFT JOIN password_usernames n ON n.user_id=u.id', filters,
      `julianday(${PROJECT_UPDATED}) DESC,p.owner_id,p.id`);
    res.json({ ...result, items: result.items.map(item => ({ ...item, updatedAt: validTimestamp(item.updatedAt) })) });
  });
  app.get('/api/admin/projects/:ownerId/:id', (req, res) => {
    const project = db.prepare(`SELECT ${PROJECT_COLUMNS},
      CASE WHEN json_extract(p.document,'$.source') IN ('sample','file','url') THEN json_extract(p.document,'$.source') END AS source,
      CASE WHEN json_type(p.document,'$.duration') IN ('integer','real') AND json_extract(p.document,'$.duration') >= 0
        THEN json_extract(p.document,'$.duration') END AS duration,
      CASE WHEN json_type(p.document,'$.createdAt')='text' THEN ${PROJECT_CREATED} END AS createdAt
      ${PROJECT_FROM} WHERE p.owner_id=? AND p.id=?`).get(String(req.params.ownerId), String(req.params.id));
    if (!project) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    res.json({ ...project, updatedAt: validTimestamp(project.updatedAt), createdAt: validTimestamp(project.createdAt) });
  });
  app.patch('/api/admin/projects/:ownerId/:id', (req, res) => {
    const actor = security.admin(req); const ownerId = String(req.params.ownerId); const id = String(req.params.id); const body = validate.object(req.body);
    const reason = validate.text(body.reason, 300, '변경 사유', 5);
    if (typeof body.archived !== 'boolean') throw new HttpError(400, 'INVALID_INPUT', '보관 상태를 확인해 주세요.');
    db.transaction(() => {
      if (!db.prepare('SELECT id FROM projects WHERE owner_id=? AND id=?').get(ownerId, id)) throw new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      db.prepare('UPDATE projects SET archived_at=? WHERE owner_id=? AND id=?').run(body.archived ? new Date().toISOString() : null, ownerId, id);
      db.prepare('UPDATE users SET workspace_version=workspace_version+1 WHERE id=?').run(ownerId);
      audit(db, actor.id, body.archived ? 'project.archive' : 'project.restore', ownerId + '/' + id, reason);
    });
    res.json({ success: true });
  });
  app.get('/api/admin/activity', (req, res) => {
    const { action, target } = req.query;
    const filters = [
      ...containsAny(searchTerm(req.query.actor), ['u.name', 'u.email', 'n.username', 'a.actor_id']),
      ...dateFilters('a.created_at', req.query),
    ];
    if (typeof target === 'string' && target) filters.push({ sql: 'a.target_id=?', values: [target] });
    if (action === 'user.update') filters.push({ sql: "a.action GLOB 'user.update:*'", values: [] });
    else if (typeof action === 'string' && ACTIVITY_ACTIONS.includes(action)) filters.push({ sql: 'a.action=?', values: [action] });
    const columns = `a.id,a.action,a.target_id AS targetId,a.reason,a.created_at AS createdAt,a.actor_id AS actorId,u.name AS actorName,u.email AS actorEmail,
      CASE WHEN a.action IN ('account.signup','account.login','user.bootstrap-admin') OR a.action GLOB 'user.update:*' THEN 'user'
        WHEN a.action IN ('project.archive','project.restore') THEN 'project' END AS targetKind`;
    res.json(paginate(db, req.query, columns, 'FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN password_usernames n ON n.user_id=u.id',
      filters, 'a.created_at DESC,a.id'));
  });
}
