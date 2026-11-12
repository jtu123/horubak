import { createHash, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

export const SOCIAL_NAMES = { naver: '네이버', google: '구글', apple: '애플' } as const;
export type SocialName = keyof typeof SOCIAL_NAMES;
export interface SocialFlow { state: string; nonce: string; verifier: string }
export interface SocialProfile { subject: string; email?: string; name?: string }
export interface SocialProvider {
  clientId: string;
  authorize(redirectUri: string, flow: SocialFlow): URL;
  profile(redirectUri: string, code: string, flow: SocialFlow): Promise<SocialProfile>;
}
export type SocialProviders = Partial<Record<SocialName, SocialProvider>>;

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_KEYS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export class SocialProviderResponseError extends Error {
  constructor(readonly status: number) { super('Social provider request failed'); }
}

async function providerJson(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new SocialProviderResponseError(response.status);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid social provider response');
  return value as Record<string, unknown>;
}

function tokenRequest(url: string, fields: Record<string, string>) {
  return providerJson(url, { method: 'POST', body: new URLSearchParams(fields) });
}

function requiredString(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('Missing social provider field');
  return value;
}

function authorizationUrl(endpoint: string, clientId: string, redirectUri: string, state: string, parameters: Record<string, string> = {}) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, state, response_type: 'code', ...parameters,
  }).toString();
  return url;
}

interface OidcOptions {
  clientId: string;
  clientSecret(): string | Promise<string>;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  issuers: string[];
  keys: typeof GOOGLE_KEYS;
  scope: string;
  responseMode?: 'form_post';
  pkce?: true;
  prompt?: 'select_account';
}

function oidcProvider(options: OidcOptions): SocialProvider {
  return {
    clientId: options.clientId,
    authorize(redirectUri, flow) {
      return authorizationUrl(options.authorizationEndpoint, options.clientId, redirectUri, flow.state, {
        scope: options.scope,
        nonce: flow.nonce,
        ...(options.prompt && { prompt: options.prompt }),
        ...(options.responseMode && { response_mode: options.responseMode }),
        ...(options.pkce && {
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
        }),
      });
    },
    async profile(redirectUri, code, flow) {
      const tokens = await tokenRequest(options.tokenEndpoint, {
        client_id: options.clientId,
        client_secret: await options.clientSecret(),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
        ...(options.pkce && { code_verifier: flow.verifier }),
      });
      const { payload } = await jwtVerify(requiredString(tokens.id_token), options.keys, {
        issuer: options.issuers,
        audience: options.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
        maxTokenAge: '10 minutes',
        clockTolerance: 30,
      });
      if (payload.nonce !== flow.nonce || (payload.azp !== undefined && payload.azp !== options.clientId) ||
        (Array.isArray(payload.aud) && (payload.aud.length !== 1 || payload.aud[0] !== options.clientId))) {
        throw new Error('Invalid social token claims');
      }
      const verifiedEmail = payload.email_verified === true || payload.email_verified === 'true';
      return {
        subject: requiredString(payload.sub),
        email: verifiedEmail && typeof payload.email === 'string' ? payload.email : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    },
  };
}

function naverProvider(clientId: string, clientSecret: string): SocialProvider {
  return {
    clientId,
    authorize: (redirectUri, flow) => authorizationUrl('https://nid.naver.com/oauth2.0/authorize', clientId, redirectUri, flow.state),
    async profile(_redirectUri, code, flow) {
      const tokens = await tokenRequest('https://nid.naver.com/oauth2.0/token', {
        grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, state: flow.state,
      });
      const result = await providerJson('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: 'Bearer ' + requiredString(tokens.access_token) },
      });
      if (result.resultcode !== '00' || !result.response || typeof result.response !== 'object' || Array.isArray(result.response)) {
        throw new Error('Invalid Naver profile');
      }
      const profile = result.response as Record<string, unknown>;
      return {
        subject: requiredString(profile.id),
        email: typeof profile.email === 'string' ? profile.email : undefined,
        name: typeof profile.nickname === 'string' ? profile.nickname : undefined,
      };
    },
  };
}

export function configureSocialProviders(origin: string, secureCookies: boolean, env: Record<string, string | undefined> = process.env): SocialProviders {
  const host = new URL(origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host.hostname);
  const https = host.protocol === 'https:' && secureCookies;
  if (!https && !loopback) return {};

  const providers: SocialProviders = {};
  const { NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env;

  if (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) providers.naver = naverProvider(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET);
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    providers.google = oidcProvider({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: () => GOOGLE_CLIENT_SECRET,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      keys: GOOGLE_KEYS,
      scope: 'openid email profile',
      pkce: true,
      prompt: 'select_account',
    });
  }
  if (https && !loopback && !isIP(host.hostname.replace(/^\[|\]$/g, '')) && host.hostname.includes('.') &&
    APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY) {
    const key = createPrivateKey(APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('APPLE_PRIVATE_KEY에는 Sign in with Apple의 P-256 개인키가 필요합니다.');
    }
    providers.apple = oidcProvider({
      clientId: APPLE_CLIENT_ID,
      clientSecret: () => new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
        .setIssuer(APPLE_TEAM_ID).setSubject(APPLE_CLIENT_ID)
        .setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key),
      authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
      tokenEndpoint: 'https://appleid.apple.com/auth/token',
      issuers: ['https://appleid.apple.com'],
      keys: APPLE_KEYS,
      scope: 'email',
      responseMode: 'form_post',
    });
  }
  return providers;
}
