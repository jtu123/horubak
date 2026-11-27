import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import type { AnalysisOptions } from '../src/analysis.js';

async function fixture(t: TestContext, options?: AnalysisOptions) {
  const db = openDatabase(':memory:');
  const sessions = { admin: 'a'.repeat(64), user: 'b'.repeat(64) };
  for (const role of ['admin', 'user'] as const) {
    const id = randomUUID();
    db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, role, id + '@example.test', 'unused', role, new Date().toISOString());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(sessions[role]).digest('hex'), id, 'c'.repeat(64), Date.now() + 60000);
  }
  const app = await createApp(db, { origin: 'http://127.0.0.1:5173', secureCookies: false, analysis: options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const base = `http://127.0.0.1:${address.port}/api/admin/analysis/connectivity`;
  return (role?: keyof typeof sessions) => fetch(base, { headers: role ? { Cookie: 'horubak_session=' + sessions[role] } : {} });
}

test('analysis connectivity requires an administrator and does not equate missing configuration with verification', async t => {
  const check = await fixture(t);
  assert.equal((await check()).status, 401);
  assert.equal((await check('user')).status, 403);
  const missing = await check('admin');
  assert.equal(missing.status, 503);
  assert.equal((await missing.json() as { code: string }).code, 'ANALYSIS_NOT_CONFIGURED');
  assert.equal(missing.headers.get('cache-control'), 'no-store');
});

test('analysis connectivity verifies only an authenticated no-op and rejects invalid upstream responses', async t => {
  let status = 200; let payload: unknown = { status: 'ok', internal: 'must-not-be-returned' };
  const calls: { path: string; method: string; authenticated: boolean; bytes: number }[] = [];
  const upstream = createServer(async (req, res) => {
    let bytes = 0; for await (const chunk of req) bytes += chunk.length;
    calls.push({ path: req.url!, method: req.method!, authenticated: req.headers.authorization === 'Bearer ' + 'd'.repeat(32), bytes });
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const check = await fixture(t, { baseUrl: `http://127.0.0.1:${address.port}`, serviceToken: 'd'.repeat(32) });
  const response = await check('admin');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'scope', 'status']);
  assert.equal(result.status, 'verified'); assert.equal(result.scope, 'authenticated-service');
  assert.ok(Number.isFinite(Date.parse(String(result.checkedAt))));
  assert.deepEqual(calls, [{ path: '/api/health', method: 'GET', authenticated: true, bytes: 0 }]);
  payload = { status: 'private-status-marker', message: 'private-body-marker', token: 'd'.repeat(32) };
  const warnings: unknown[][] = []; const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    const invalid = await check('admin');
    assert.equal(invalid.status, 502);
    const failure = await invalid.json() as { code: string; requestId: string };
    assert.equal(failure.code, 'ANALYSIS_RESPONSE_INVALID');
    assert.match(failure.requestId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(warnings, [['analysis_request_failed', { requestId: failure.requestId, code: 'ANALYSIS_RESPONSE_INVALID', status: 502, errorName: 'Error' }]]);
    assert.doesNotMatch(JSON.stringify({ failure, warnings }), /private-status-marker|private-body-marker|dddddddd|Bearer/);
  } finally { console.warn = originalWarn; }
  status = 401; payload = { detail: 'private upstream message' };
  const unauthorized = await check('admin');
  assert.equal(unauthorized.status, 502);
  const failure = await unauthorized.json() as { code: string; requestId: string };
  assert.equal(failure.code, 'ANALYSIS_AUTH_FAILED');
  assert.match(failure.requestId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(failure), /private upstream message|dddddddd/);
  status = 503;
  assert.equal((await check('admin')).status, 503);
});
