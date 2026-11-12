import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { audit } from './database-contract.js';
import type { Database, UserRow } from './database-contract.js';
import { hashPassword, hashToken, HttpError } from './security.js';
import type { createSecurity, SecurityOptions } from './security.js';
import { SOCIAL_NAMES, SocialProviderResponseError } from './social-providers.js';
import type { SocialName, SocialProfile, SocialProvider, SocialProviders } from './social-providers.js';
import { email as validateEmail } from './validation.js';

const FLOW_AGE = 10 * 60 * 1000;
const FLOW_TOKEN = /^[a-f0-9]{64}$/;
const SOCIAL_PATH = '/api/auth/social';
type CallbackError = 'cancelled' | 'expired' | 'email-required' | 'email-in-use' | 'blocked' | 'failed';
interface FlowRow { session_hash: string; nonce: string; verifier: string }
type Security = ReturnType<typeof createSecurity>;

function randomToken() {
  return randomBytes(32).toString('hex');
}

function socialName(value: unknown): SocialName | undefined {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOCIAL_NAMES, value)) return value as SocialName;
}

function callbackPath(provider: SocialName) {
  return `${SOCIAL_PATH}/${provider}/callback`;
}

function redirectError(res: Response, error: CallbackError) {
  res.redirect(303, '/login?social=' + error);
}

async function findOrCreateUser(db: Database, provider: SocialName, configuration: SocialProvider, profile: SocialProfile, sessionHash: string) {
  if (!profile.subject || profile.subject.length > 255 || /[\s\u0000-\u001f\u007f]/u.test(profile.subject)) {
    return { error: 'failed' } as const;
  }
  const linkedUser = () => db.prepare(`
    SELECT users.* FROM social_identities JOIN users ON users.id=social_identities.user_id
    WHERE provider=? AND client_id=? AND subject=?
  `).get(provider, configuration.clientId, profile.subject) as UserRow | undefined;

  // Social accounts have no usable password. Keep the existing users schema and hash format.
  const passwordHash = linkedUser() ? undefined : await hashPassword(randomToken());

  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id IS NULL AND expires_at>?').get(sessionHash, Date.now())) {
      return { error: 'expired' } as const;
    }

    let user = linkedUser();
    const now = new Date().toISOString();
    if (!user) {
      let email: string;
      try { email = validateEmail(profile.email); }
      catch { return { error: 'email-required' } as const; }
      // Provider email never grants access to an existing account or its role.
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return { error: 'email-in-use' } as const;
      if (!passwordHash) return { error: 'failed' } as const;

      const id = randomUUID();
      const name = profile.name?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 50) || SOCIAL_NAMES[provider] + ' 사용자';
      db.prepare('INSERT INTO users(id,name,email,password_hash,created_at,last_login_at) VALUES(?,?,?,?,?,?)')
        .run(id, name, email, passwordHash, now, now);
      db.prepare('INSERT INTO social_identities(provider,client_id,subject,user_id) VALUES(?,?,?,?)')
        .run(provider, configuration.clientId, profile.subject, id);
      audit(db, id, 'account.signup', id, provider);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow;
    }
    if (user.status !== 'active') return { error: 'blocked' } as const;

    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now, user.id);
    audit(db, user.id, 'account.login', user.id, provider);
    // Apple does not send the site's SameSite=Lax session cookie on its form POST.
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash);
    return { userId: user.id } as const;
  });
}

export function mountSocialAuth(app: Express, db: Database, security: Security, options: SecurityOptions & { socialProviders?: SocialProviders }) {
  const providers = options.socialProviders ?? {};
  const redirectUri = (provider: SocialName) => new URL(callbackPath(provider), options.origin).href;
  const cookieName = (provider: SocialName) => `${options.secureCookies ? '__Host-' : ''}horubak_social_${provider}`;
  const cookieOptions = (provider: SocialName) => ({
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: provider === 'apple' ? 'none' as const : 'lax' as const,
    path: '/',
  });

  app.post(SOCIAL_PATH + '/:provider/start', express.json({ limit: '1kb' }), security.mutation, (req, res) => {
    const provider = socialName(req.params.provider);
    if (!provider) throw new HttpError(404, 'UNKNOWN_PROVIDER', '지원하는 로그인 방식을 선택해 주세요.');
    const configuration = providers[provider];
    if (!configuration || (provider === 'apple' && !options.secureCookies)) {
      throw new HttpError(503, 'SOCIAL_UNAVAILABLE', `${SOCIAL_NAMES[provider]} 로그인 연결을 준비 중이에요.`);
    }
    const session = security.session(req);
    if (!session || session.user_id) throw new HttpError(409, 'SESSION_ACTIVE', '로그아웃한 뒤 다시 시도해 주세요.');
    security.rate(req, 'social:' + req.ip);

    const flow = { state: randomToken(), nonce: randomToken(), verifier: randomBytes(32).toString('base64url') };
    const browserToken = randomToken();
    const authorizationUrl = configuration.authorize(redirectUri(provider), flow).href;
    db.transaction(() => {
      db.prepare('DELETE FROM social_login_flows WHERE expires_at<=? OR (session_hash=? AND provider=?)')
        .run(Date.now(), session.token_hash, provider);
      db.prepare(`INSERT INTO social_login_flows(state_hash,provider,browser_hash,session_hash,nonce,verifier,expires_at)
        VALUES(?,?,?,?,?,?,?)`).run(hashToken(flow.state), provider, hashToken(browserToken), session.token_hash,
        flow.nonce, flow.verifier, Date.now() + FLOW_AGE);
    });
    res.cookie(cookieName(provider), browserToken, { ...cookieOptions(provider), maxAge: FLOW_AGE });
    res.json({ authorizationUrl });
  });

  async function callback(provider: SocialName, input: Record<string, unknown>, req: Request, res: Response) {
    res.set('Referrer-Policy', 'no-referrer');
    const configuration = providers[provider];
    const state = input.state;
    const prefix = cookieName(provider) + '=';
    const cookies = (req.headers.cookie ?? '').split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(prefix));
    const browserToken = cookies.length === 1 ? cookies[0]!.slice(prefix.length) : '';
    if (!configuration || typeof state !== 'string' || !FLOW_TOKEN.test(state) || !FLOW_TOKEN.test(browserToken)) {
      return redirectError(res, 'expired');
    }
    if (security.session(req)?.user_id) return redirectError(res, 'expired');

    // Consume the state only when this browser presents its matching short-lived cookie.
    const flow = db.prepare(`DELETE FROM social_login_flows
      WHERE state_hash=? AND provider=? AND browser_hash=? AND expires_at>?
        AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=session_hash AND user_id IS NULL AND expires_at>?)
      RETURNING session_hash, nonce, verifier`)
      .get(hashToken(state), provider, hashToken(browserToken), Date.now(), Date.now()) as FlowRow | undefined;
    if (!flow) return redirectError(res, 'expired');
    res.clearCookie(cookieName(provider), cookieOptions(provider));
    if (input.error === 'access_denied' || input.error === 'user_cancelled_authorize') return redirectError(res, 'cancelled');
    const code = input.code;
    if (typeof code !== 'string' || code.length === 0 || code.length > 4096 || input.error !== undefined) return redirectError(res, 'failed');

    let profile: SocialProfile;
    try {
      profile = await configuration.profile(redirectUri(provider), code, { state, nonce: flow.nonce, verifier: flow.verifier });
    } catch (error) {
      console.warn('OAuth profile verification failed', {
        provider,
        category: error instanceof Error ? error.name : 'UnknownError',
        status: error instanceof SocialProviderResponseError ? error.status : undefined,
      });
      return redirectError(res, 'failed');
    }
    const result = await findOrCreateUser(db, provider, configuration, profile, flow.session_hash);
    if (result.error) return redirectError(res, result.error);
    security.issue(req, res, result.userId);
    res.redirect(303, '/projects');
  }

  app.get(SOCIAL_PATH + '/:provider/callback', (req, res) => {
    const provider = socialName(req.params.provider);
    if (!provider || provider === 'apple') return redirectError(res, 'failed');
    return callback(provider, req.query, req, res);
  });
  // Apple is the sole cross-site POST exception. Its state and cookie bind the response to the initiating browser.
  app.post(callbackPath('apple'), express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 12 }), (req, res) => {
    if (!options.secureCookies || !req.is('application/x-www-form-urlencoded')) return redirectError(res, 'failed');
    return callback('apple', req.body ?? {}, req, res);
  });
}
