import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { callService } from '../src/analysis.js';
import { HttpError } from '../src/security.js';

const token = 'transport-secret-' + 'a'.repeat(40);
const requestPath = '/api/full-tracking/uploads/init?private=must-not-be-logged';
const requestBody = { filename: 'sensitive-person-video.mp4', metadata: 'private-metadata-text' };
const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const diagnosticKeys = new Set(['requestId', 'code', 'status', 'upstreamStatus', 'errorName']);
const errorNames = new Set(['TypeError', 'TimeoutError', 'AbortError', 'Error', 'UnknownError']);

async function provider(t: TestContext, listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { baseUrl: 'http://127.0.0.1:' + address.port, serviceToken: token };
}

function warnings(t: TestContext) {
  const captured: unknown[][] = [];
  t.mock.method(console, 'warn', (...values: unknown[]) => { captured.push(values); });
  return captured;
}

async function failureWithDiagnostic(
  run: () => Promise<unknown>, captured: unknown[][],
  expected: { status: number; code: string; upstreamStatus?: number; errorName?: string; retryAfter?: number },
  privateValues: string[],
) {
  let thrown: unknown;
  try { await run(); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof HttpError, 'Failure must preserve the public HttpError contract');
  assert.equal(thrown.status, expected.status);
  assert.equal(thrown.code, expected.code);
  if (expected.retryAfter !== undefined) assert.equal(thrown.retryAfter, expected.retryAfter);
  assert.equal(captured.length, 1, 'Exactly one structured diagnostic per failed request');
  const entry = captured[0]!;
  assert.equal(entry.length, 2);
  assert.equal(entry[0], 'analysis_request_failed');
  const value = entry[1];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const diagnostic = value as Record<string, unknown>;
  assert.ok(Object.keys(diagnostic).every(key => diagnosticKeys.has(key)), 'Diagnostic fields must be allowlisted');
  assert.equal(diagnostic.code, expected.code);
  assert.equal(diagnostic.status, expected.status);
  assert.equal(diagnostic.upstreamStatus, expected.upstreamStatus);
  if (expected.errorName !== undefined) assert.equal(diagnostic.errorName, expected.errorName);
  if (diagnostic.errorName !== undefined) assert.ok(errorNames.has(String(diagnostic.errorName)));
  assert.equal(typeof diagnostic.requestId, 'string');
  assert.match(String(diagnostic.requestId), uuid);
  assert.equal((thrown as HttpError & { requestId?: string }).requestId, diagnostic.requestId);
  const publicData = JSON.stringify({ warnings: captured, error: { code: thrown.code, message: thrown.message } });
  for (const secret of [token, requestPath, requestBody.filename, requestBody.metadata, ...privateValues]) {
    assert.equal(publicData.includes(secret), false, 'Public diagnostics must not include request/provider private data');
  }
  return diagnostic;
}

test('분석 전송은 실제 JSON POST와 인증 헤더를 전달하고 성공 시 오류 로그를 남기지 않는다', async t => {
  const captured = warnings(t);
  let calls = 0;
  const options = await provider(t, async (req, res) => {
    calls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, requestPath);
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), requestBody);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
  });
  assert.deepEqual(await callService(options, requestPath, request, 1000), { accepted: true });
  assert.equal(calls, 1);
  assert.deepEqual(captured, []);
});

test('분석 서버의 307 이동은 따르지 않고 인증정보를 다른 서버에 전달하지 않는다', async t => {
  const captured = warnings(t);
  let redirectedCalls = 0;
  const sink = await provider(t, (_req, res) => { redirectedCalls++; res.end('{}'); });
  const location = sink.baseUrl + '/private-redirect-destination?token=provider-secret';
  const options = await provider(t, (_req, res) => {
    res.writeHead(307, { Location: location, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ internal: 'provider-secret' }));
  });
  await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
    { status: 502, code: 'ANALYSIS_REDIRECT_REJECTED', upstreamStatus: 307 }, [options.baseUrl, location, 'provider-secret']);
  assert.equal(redirectedCalls, 0);
});

test('분석 서버의 401·403은 인증 연결 오류로 구분하고 원문 응답을 공개하지 않는다', async t => {
  const requestIds = new Set<unknown>();
  for (const status of [401, 403]) {
    await t.test(String(status), async child => {
      const captured = warnings(child);
      const options = await provider(child, (_req, res) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'X-Internal-Secret': 'provider-secret' });
        res.end(JSON.stringify({ detail: 'provider-secret https://private-provider.invalid/?key=provider-secret' }));
      });
      const diagnostic = await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
        { status: 502, code: 'ANALYSIS_AUTH_FAILED', upstreamStatus: status }, [options.baseUrl, 'provider-secret', 'private-provider.invalid']);
      assert.equal(requestIds.has(diagnostic.requestId), false, 'Each request must receive a fresh correlation ID');
      requestIds.add(diagnostic.requestId);
    });
  }
});

test('분석 서버의 500은 기존 공개 오류를 유지하고 안전한 업스트림 상태만 기록한다', async t => {
  const captured = warnings(t);
  const options = await provider(t, (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: { message: 'provider-secret internal stack trace' } }));
  });
  await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
    { status: 502, code: 'ANALYSIS_SERVICE_FAILED', upstreamStatus: 500 }, [options.baseUrl, 'provider-secret', 'internal stack trace']);
});

test('기존 업로드409·분석중503 코드와 Retry-After를 진단 추가 후에도 보존한다', async t => {
  for (const item of [
    { status: 409, code: 'UPLOAD_INCOMPLETE', retryAfter: undefined },
    { status: 503, code: 'ANALYSIS_BUSY', retryAfter: 15 },
  ]) {
    await t.test(item.code, async child => {
      const captured = warnings(child);
      const options = await provider(child, (_req, res) => {
        res.writeHead(item.status, { 'Content-Type': 'application/json', ...(item.retryAfter ? { 'Retry-After': String(item.retryAfter) } : {}) });
        res.end(JSON.stringify({ detail: { code: item.code, message: 'provider-secret' } }));
      });
      await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
        { ...item, upstreamStatus: item.status }, [options.baseUrl, 'provider-secret']);
    });
  }
});

test('잘못된 JSON 응답은 네트워크 단절로 바꾸지 않고 원문 없이 진단한다', async t => {
  const captured = warnings(t);
  const options = await provider(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not-json provider-secret');
  });
  await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
    { status: 502, code: 'ANALYSIS_RESPONSE_INVALID', upstreamStatus: 200 }, [options.baseUrl, 'provider-secret']);
});

test('실제 요청 제한 시간 초과를 구분하고 고정 오류 이름만 기록한다', async t => {
  const captured = warnings(t);
  const options = await provider(t, () => { /* Keep the response open until the client timeout aborts it. */ });
  await failureWithDiagnostic(() => callService(options, requestPath, request, 100), captured,
    { status: 504, code: 'ANALYSIS_TIMEOUT', errorName: 'TimeoutError' }, [options.baseUrl]);
});

test('실제 연결 종료는 전송 오류로 구분하고 원본 예외나 주소를 기록하지 않는다', async t => {
  const captured = warnings(t);
  const options = await provider(t, req => { req.socket.destroy(); });
  await failureWithDiagnostic(() => callService(options, requestPath, request, 1000), captured,
    { status: 502, code: 'ANALYSIS_UNREACHABLE', errorName: 'TypeError' }, [options.baseUrl]);
});
