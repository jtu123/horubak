import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Database, UserRow } from './database-contract.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false;
  const expected = Buffer.from(parts[5]!, 'hex');
  const actual = await derive(password, parts[4]!);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
interface Session { token_hash: string; user_id: string | null; csrf: string; expires_at: number }
export interface SecurityOptions { origin: string; secureCookies: boolean; rateLimit?: number }
export function createSecurity(db: Database, options: SecurityOptions) {
  const cookieName = options.secureCookies ? '__Host-horubak_session' : 'horubak_session';
  function session(req: Request) {
    const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hashToken(token), Date.now()) as Session | undefined;
  }
  function issue(req: Request, res: Response, userId: string | null) {
    const previous = session(req);
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
    const token = secret(); const csrf = secret(); const age = userId ? 12 * 60 * 60 : 30 * 60;
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token), userId, csrf, Date.now() + age * 1000);
    res.cookie(cookieName, token, { httpOnly: true, secure: options.secureCookies, sameSite: 'lax', path: '/', maxAge: age * 1000 });
    return csrf;
  }
  function user(req: Request) {
    const current = session(req);
    if (!current?.user_id) throw new HttpError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요.');
    const row = db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(current.user_id) as UserRow | undefined;
    if (!row) throw new HttpError(401, 'UNAUTHENTICATED', '다시 로그인해 주세요.');
    return row;
  }
  function admin(req: Request) {
    const row = user(req);
    if (row.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    return row;
  }
  function mutation(req: Request, _res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('origin') !== options.origin || req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'ORIGIN_REJECTED', '허용된 사이트에서 다시 시도해 주세요.');
    if (!req.is('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'JSON 요청이 필요합니다.');
    const current = session(req); const csrf = req.get('x-csrf-token');
    if (!current || !csrf || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf))) throw new HttpError(403, 'CSRF_REJECTED', '페이지를 새로고침한 뒤 다시 시도해 주세요.');
    next();
  }
  function limitRates(buckets: ReadonlyArray<readonly [string, number]>) {
    const now = Date.now(); db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
    for (const [bucket, limit] of buckets) {
      const key = hashToken(bucket);
      const row = db.prepare('SELECT attempts FROM rate_limits WHERE key=?').get(key) as { attempts: number } | undefined;
      if (row && row.attempts >= limit) throw new HttpError(429, 'RATE_LIMITED', '시도가 너무 많습니다. 15분 후 다시 시도해 주세요.');
      db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, now + 15 * 60 * 1000);
    }
  }
  function rate(req: Request, email: string) {
    limitRates([[`ip:${req.ip}`, options.rateLimit ?? 30], [`email:${email}`, options.rateLimit ?? 10]]);
  }
  function rateAnonymousSession(req: Request) {
    limitRates([[`anonymous-session:${req.ip}`, options.rateLimit ?? 60]]);
  }
  function logout(req: Request, res: Response) {
    const current = session(req);
    if (current) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(current.token_hash);
    res.clearCookie(cookieName, { httpOnly: true, secure: options.secureCookies, sameSite: 'lax', path: '/' });
  }
  return { session, issue, user, admin, mutation, rate, rateAnonymousSession, logout };
}
