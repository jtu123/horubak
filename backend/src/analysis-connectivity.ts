import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { callService } from './analysis.js';
import type { AnalysisOptions } from './analysis.js';
import { createSecurity, HttpError } from './security.js';

export function mountAnalysisConnectivity(app: Express, security: ReturnType<typeof createSecurity>, options?: AnalysisOptions) {
  app.get('/api/admin/analysis/connectivity', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    security.admin(req);
    const result = await callService(options, '/api/health', { method: 'GET' }, 5000);
    if (result.status !== 'ok') {
      const error = new HttpError(502, 'ANALYSIS_RESPONSE_INVALID', '분석 서버의 연결 확인 응답을 확인하지 못했습니다.');
      error.requestId = randomUUID();
      console.warn('analysis_request_failed', { requestId: error.requestId, code: error.code, status: error.status, errorName: error.name });
      throw error;
    }
    res.json({ status: 'verified', scope: 'authenticated-service', checkedAt: new Date().toISOString() });
  });
}
