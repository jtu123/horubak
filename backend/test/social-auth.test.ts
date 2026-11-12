import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { configureSocialProviders } from '../src/social-providers.js';
import type { SocialName } from '../src/social-providers.js';

test('소셜 로그인에서 브라우저와 토큰을 검증하고 제공업체 ID로 계정을 복원한다', async t => {
  const origin = 'https://horubak.test.example';
  const jwtKeys = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(jwtKeys.publicKey), kid: 'test-key', alg: 'RS256' };
  const appleKeys = await generateKeyPair('ES256', { extractable: true });
  const environment = {
    NAVER_CLIENT_ID: 'naver-client', NAVER_CLIENT_SECRET: 'naver-test-secret',
    GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-test-secret',
    APPLE_CLIENT_ID: 'apple-service', APPLE_TEAM_ID: 'APPLE_TEAM', APPLE_KEY_ID: 'APPLE_KEY',
    APPLE_PRIVATE_KEY: await exportPKCS8(appleKeys.privateKey),
  };
  assert.equal(configureSocialProviders('http://127.0.0.1:5173', false, environment).apple, undefined);
  assert.deepEqual(configureSocialProviders('http://horubak.test.example', false, environment), {});
  const socialProviders = configureSocialProviders(origin, true, environment);
  const db = openDatabase(':memory:');
  const app = await createApp(db, { origin, secureCookies: true, rateLimit: 100, socialProviders });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const http = globalThis.fetch;
  const authorization = new Map<string, URLSearchParams>();
  let exchanges = 0;

  t.mock.method(globalThis, 'fetch', async (input: URL | Request | string, options?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs' || url === 'https://appleid.apple.com/auth/keys') {
      return Response.json({ keys: [publicJwk] });
    }
    if (url === 'https://openapi.naver.com/v1/nid/me') {
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer naver-test-access');
      return Response.json({ resultcode: '00', response: { id: 'naver-subject', email: 'naver@test.example', nickname: '네이버 테스트' } });
    }
    const params = options?.body as URLSearchParams;
    const code = params.get('code')!;
    const requested = authorization.get(code)!;
    assert.equal(options?.method, 'POST');
    assert.equal(params.get('grant_type'), 'authorization_code');
    exchanges++;
    if (url === 'https://nid.naver.com/oauth2.0/token') {
      assert.equal(params.get('state'), requested.get('state'));
      return Response.json({ access_token: 'naver-test-access' });
    }
    assert.equal(params.get('redirect_uri'), requested.get('redirect_uri'));
    let issuer: string;
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(params.get('client_secret'), environment.GOOGLE_CLIENT_SECRET);
      assert.equal(requested.get('code_challenge_method'), 'S256');
      assert.equal(createHash('sha256').update(params.get('code_verifier')!).digest('base64url'), requested.get('code_challenge'));
      issuer = 'https://accounts.google.com';
    } else {
      assert.equal(url, 'https://appleid.apple.com/auth/token');
      assert.equal(requested.get('response_mode'), 'form_post');
      const { protectedHeader } = await jwtVerify(params.get('client_secret')!, appleKeys.publicKey, {
        algorithms: ['ES256'], issuer: environment.APPLE_TEAM_ID, subject: environment.APPLE_CLIENT_ID, audience: 'https://appleid.apple.com',
      });
      assert.equal(protectedHeader.kid, environment.APPLE_KEY_ID);
      issuer = 'https://appleid.apple.com';
    }
    const token = await new SignJWT({
      nonce: code === 'bad-nonce' ? 'wrong-nonce' : requested.get('nonce'),
      email: code === 'admin-email' ? 'owner@test.example' : code === 'google-again' ? 'changed@test.example' : params.get('client_id') + '@test.example',
      email_verified: issuer === 'https://appleid.apple.com' ? 'true' : true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(code === 'admin-email' ? 'other-subject' : params.get('client_id') + '-subject')
      .setIssuer(issuer).setAudience(params.get('client_id')!).setIssuedAt().setExpirationTime('5m').sign(jwtKeys.privateKey);
    return Response.json({ id_token: token });
  });

  const cookie = (response: Response, name: string) => {
    const value = response.headers.getSetCookie().find(item => item.startsWith(name + '='));
    assert.ok(value);
    return value.split(';')[0]!;
  };
  async function session() {
    const response = await http(base + '/api/auth/csrf');
    return { cookie: cookie(response, '__Host-horubak_session'), csrf: (await response.json()).csrfToken as string };
  }
  async function start(provider: SocialName, code: string) {
    const anonymous = await session();
    const response = await http(base + '/api/auth/social/' + provider + '/start', {
      method: 'POST', headers: { Origin: origin, Cookie: anonymous.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': anonymous.csrf }, body: '{}',
    });
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).authorizationUrl);
    authorization.set(code, url.searchParams);
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/social/' + provider + '/callback');
    const binding = cookie(response, '__Host-horubak_social_' + provider);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; Secure; SameSite=/);
    if (provider === 'apple') assert.match(response.headers.get('set-cookie')!, /SameSite=None/);
    return { state: url.searchParams.get('state')!, binding };
  }
  function callback(provider: SocialName, code: string, state: string, binding = '') {
    const url = base + '/api/auth/social/' + provider + '/callback';
    const data = new URLSearchParams({ code, state });
    return provider === 'apple'
      ? http(url, { method: 'POST', body: data, headers: { Origin: 'https://appleid.apple.com', Cookie: binding }, redirect: 'manual' })
      : http(url + '?' + data, { headers: { Cookie: binding }, redirect: 'manual' });
  }
  async function signedIn(response: Response) {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/projects');
    const authenticated = cookie(response, '__Host-horubak_session');
    const me = await http(base + '/api/auth/me', { headers: { Cookie: authenticated } });
    assert.equal(me.status, 200);
    const { user } = await me.json();
    assert.equal(user.role, 'user');
    const admin = await http(base + '/api/admin/overview', { headers: { Cookie: authenticated } });
    assert.equal(admin.status, 403);
    return user;
  }

  const google = await start('google', 'google-first');
  assert.equal((await callback('google', 'google-first', google.state)).headers.get('location'), '/login?social=expired');
  assert.equal(exchanges, 0);
  const googleUser = await signedIn(await callback('google', 'google-first', google.state, google.binding));
  assert.equal((await callback('google', 'google-first', google.state, google.binding)).headers.get('location'), '/login?social=expired');
  const googleAgain = await start('google', 'google-again');
  const returningUser = await signedIn(await callback('google', 'google-again', googleAgain.state, googleAgain.binding));
  assert.equal(returningUser.id, googleUser.id);

  const badNonce = await start('google', 'bad-nonce');
  assert.equal((await callback('google', 'bad-nonce', badNonce.state, badNonce.binding)).headers.get('location'), '/login?social=failed');

  const owner = await session();
  const signup = await http(base + '/api/auth/signup', {
    method: 'POST', headers: { Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': owner.csrf },
    body: JSON.stringify({ name: '기존 관리자', email: 'owner@test.example', password: 'test-owner-password' }),
  });
  assert.equal(signup.status, 201);
  db.prepare("UPDATE users SET role='admin' WHERE email='owner@test.example'").run();
  const sameEmail = await start('google', 'admin-email');
  assert.equal((await callback('google', 'admin-email', sameEmail.state, sameEmail.binding)).headers.get('location'), '/login?social=email-in-use');

  const naver = await start('naver', 'naver-code');
  const naverUser = await signedIn(await callback('naver', 'naver-code', naver.state, naver.binding));
  assert.equal(naverUser.name, '네이버 테스트');
  const apple = await start('apple', 'apple-code');
  const appleUser = await signedIn(await callback('apple', 'apple-code', apple.state, apple.binding));
  assert.equal(appleUser.email, 'apple-service@test.example');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM social_identities').get()?.total, 3);
});
