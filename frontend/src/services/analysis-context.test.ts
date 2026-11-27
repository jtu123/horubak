import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisApi } from './analysis';

const expected = { expectedJobId: 'job-a', expectedSourceSha256: 'a'.repeat(64) };
const result = { status: 'expand', reason: '주변 발화 포함', originalStartSeconds: 10, originalEndSeconds: 40,
  suggestion: { startSeconds: 8, endSeconds: 42, durationSeconds: 34 } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('context request transcript identity', () => {
  it('sends the displayed immutable job and source fingerprint with the context request', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (path, init) => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'test-csrf' });
      body = JSON.parse(String(init?.body));
      return Response.json(result);
    }));
    await expect(analysisApi.context('project', 10, 40, 36000, undefined, expected)).resolves.toMatchObject({ status: 'expand' });
    expect(body).toEqual(expected);
  });
  it('rejects an A/B mismatch instead of exposing the latest transcript proposal for application', async () => {
    const applyProposal = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (path, init) => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'test-csrf' });
      const body = JSON.parse(String(init?.body));
      // Another tab has completed B. An unpinned request would silently review B.
      if (body.expectedJobId === expected.expectedJobId) return Response.json({ code: 'TRANSCRIPT_CHANGED', message: '전사가 변경됐어요. 다시 불러와 주세요.' }, { status: 409 });
      return Response.json(result);
    }));
    await expect(analysisApi.context('project', 10, 40, 36000, undefined, expected).then(applyProposal))
      .rejects.toMatchObject({ status: 409, code: 'TRANSCRIPT_CHANGED' });
    expect(applyProposal).not.toHaveBeenCalled();
  });
  it('keeps the legacy context body compatible when no asynchronous transcript job exists', async () => {
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (path, init) => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'test-csrf' });
      body = JSON.parse(String(init?.body)); return Response.json({ ...result, status: 'keep', suggestion: null });
    }));
    await expect(analysisApi.context('legacy-project', 10, 40, 60)).resolves.toMatchObject({ status: 'keep' });
    expect(body).toEqual({});
  });
});
