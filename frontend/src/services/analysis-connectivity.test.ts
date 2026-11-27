import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('explicit administrator analysis connection check', () => {
  it('does not probe on import and requests only the authenticated connectivity endpoint when invoked', async () => {
    const checkedAt = '2026-11-27T04:00:00.000Z';
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'verified', scope: 'authenticated-service', checkedAt }));
    vi.stubGlobal('fetch', fetch);
    const { checkAnalysisConnectivity } = await import('./api');
    expect(fetch).not.toHaveBeenCalled();
    await expect(checkAnalysisConnectivity()).resolves.toEqual({ status: 'verified', scope: 'authenticated-service', checkedAt });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, options] = fetch.mock.calls[0];
    expect(path).toBe('/api/admin/analysis/connectivity');
    expect(options.credentials).toBe('same-origin');
    expect(options.body).toBeUndefined();
  });

  it.each([
    { status: 'ok', scope: 'authenticated-service', checkedAt: '2026-11-27T04:00:00Z' },
    { status: 'verified', scope: 'full-pipeline', checkedAt: '2026-11-27T04:00:00Z' },
    { status: 'verified', scope: 'authenticated-service', checkedAt: 'invalid' },
  ])('rejects a response that cannot prove the stated connection scope', async payload => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    const { checkAnalysisConnectivity } = await import('./api');
    await expect(checkAnalysisConnectivity()).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_RESPONSE' });
  });

  it('preserves the safe upstream failure message without reporting verification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'ANALYSIS_AUTH_FAILED', message: '분석 서버 인증 설정을 확인해 주세요.' }, { status: 502 })));
    const { checkAnalysisConnectivity } = await import('./api');
    await expect(checkAnalysisConnectivity()).rejects.toMatchObject({ status: 502, code: 'ANALYSIS_AUTH_FAILED', message: '분석 서버 인증 설정을 확인해 주세요.' });
  });
});
