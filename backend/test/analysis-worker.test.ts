import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const here = join(__dirname, 'workers');
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test('analysis transport runs in workerd through the Durable Object Node HTTP bridge', { timeout: 30000 }, async t => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'horubak-analysis-worker-'));
  let mf: Miniflare | undefined;
  const servers: Server[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  t.after(async () => {
    await mf?.dispose();
    for (const timer of timers) clearTimeout(timer);
    for (const server of servers) if (server.listening) await close(server);
    const target = resolve(directory);
    assert.equal(dirname(target), tempRoot);
    assert.ok(basename(target).startsWith('horubak-analysis-worker-'));
    await rm(target, { recursive: true, force: true });
  });
  const cli = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  await promisify(execFile)(process.execPath, [cli, 'deploy', '--dry-run', '--config', join(here, 'wrangler.toml'), '--outdir', directory], {
    cwd: resolve(here, '../..'), timeout: 15000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' },
  });

  let receiverCalls = 0;
  const receiver = createServer((req, res) => { receiverCalls++; req.resume(); res.end('unexpected redirect'); });
  servers.push(receiver);
  const receiverOrigin = await listen(receiver);
  const token = randomBytes(32).toString('hex');
  const calls = new Map<string, number>();
  const authenticated = new Map<string, boolean>();
  const upstream = createServer(async (req, res) => {
    const scenario = req.url?.slice(1) ?? '';
    calls.set(scenario, (calls.get(scenario) ?? 0) + 1);
    authenticated.set(scenario, req.headers.authorization === 'Bearer ' + token);
    let body = ''; for await (const chunk of req) body += chunk;
    if (scenario.startsWith('redirect')) {
      res.writeHead(scenario === 'redirect302' ? 302 : 307, { Location: receiverOrigin + '/must-not-receive-credentials' }); res.end();
    } else if (scenario === 'unauthorized' || scenario === 'forbidden') {
      res.writeHead(scenario === 'unauthorized' ? 401 : 403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ detail: 'private upstream diagnostic' }));
    } else if (scenario === 'timeout') {
      const timer = setTimeout(() => { timers.delete(timer); res.end('{}'); }, 500); timers.add(timer);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ accepted: JSON.parse(body).filename === 'fixture.mp4' }));
    }
  });
  servers.push(upstream);
  const upstreamOrigin = await listen(upstream);
  mf = new Miniflare(convertV4MiniflareOptions({
    rootPath: directory, modules: true, scriptPath: join(directory, 'analysis-probe.js'), compatibilityDate: '2026-11-10', compatibilityFlags: ['nodejs_compat'],
    bindings: { UPSTREAM_ORIGIN: upstreamOrigin, DIAGNOSTIC_TOKEN: token },
    durableObjects: { PROBE: { className: 'AnalysisProbe', useSQLite: true } },
  }));
  const invoke = async (scenario: string) => {
    const response = await mf!.dispatchFetch('http://analysis-test.invalid/probe?scenario=' + scenario);
    return { status: response.status, body: await response.json() };
  };

  await t.test('authenticated JSON reaches upstream', async () => {
    const result = await invoke('success');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, value: { accepted: true } });
    assert.equal(calls.get('success'), 1);
    assert.equal(authenticated.get('success'), true);
  });
  for (const status of [302, 307]) await t.test(`HTTP ${status}: no redirect or token forwarding`, async () => {
    const result = await invoke('redirect' + status);
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'ANALYSIS_REDIRECT_REJECTED');
    assert.equal(calls.get('redirect' + status), 1);
    assert.equal(receiverCalls, 0);
  });
  for (const scenario of ['unauthorized', 'forbidden']) await t.test(`${scenario}: upstream authentication error`, async () => {
    const result = await invoke(scenario);
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'ANALYSIS_AUTH_FAILED');
    assert.equal(calls.get(scenario), 1);
  });
  await t.test('slow upstream: workerd timeout', async () => {
    const result = await invoke('timeout');
    assert.equal(result.status, 504);
    assert.equal(result.body.code, 'ANALYSIS_TIMEOUT');
    assert.equal(calls.get('timeout'), 1);
  });
});
