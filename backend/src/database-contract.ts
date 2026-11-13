import { randomUUID } from 'node:crypto';

export interface UserRow {
  id: string; name: string; email: string; password_hash: string;
  role: 'user' | 'admin'; status: 'active' | 'suspended';
  created_at: string; last_login_at: string | null; workspace_version: number;
}

export type SqlValue = string | number | null;
type SqlRow = Record<string, unknown>;

export interface Database {
  prepare(sql: string): {
    get(...values: SqlValue[]): SqlRow | undefined;
    all(...values: SqlValue[]): SqlRow[];
    run(...values: SqlValue[]): void;
  };
  transaction<T>(run: () => T): T;
}

export function audit(db: Database, actor: string | null, action: string, target: string, reason = '') {
  db.prepare('INSERT INTO audit_log(id,actor_id,action,target_id,reason,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), actor, action, target, reason, new Date().toISOString());
}

export function publicUser(row: UserRow, username?: string) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, guest: false as const, ...(username && { username }) };
}

export const DATABASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    created_at TEXT NOT NULL, last_login_at TEXT, workspace_version INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS password_usernames (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    CHECK(length(username) BETWEEN 3 AND 24 AND username GLOB '[a-z0-9]*' AND username NOT GLOB '*[^a-z0-9_]*')
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS social_identities (
    provider TEXT NOT NULL, client_id TEXT NOT NULL, subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(provider, client_id, subject)
  );
  CREATE TABLE IF NOT EXISTS social_login_flows (
    state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, browser_hash TEXT NOT NULL,
    session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS social_login_flows_session ON social_login_flows(session_hash, provider);
  CREATE INDEX IF NOT EXISTS social_login_flows_expiry ON social_login_flows(expires_at);
  CREATE TABLE IF NOT EXISTS projects (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
    archived_at TEXT, PRIMARY KEY(owner_id,id)
  );
  CREATE TABLE IF NOT EXISTS project_sources (
    owner_id TEXT NOT NULL, project_id TEXT NOT NULL, filename TEXT NOT NULL,
    PRIMARY KEY(owner_id, project_id),
    FOREIGN KEY(owner_id, project_id) REFERENCES projects(owner_id, id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
    target_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
  );
`;
