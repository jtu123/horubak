import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import express from 'express';
import { callService } from '../../src/analysis.js';
import { HttpError } from '../../src/security.js';

interface Env {
  UPSTREAM_ORIGIN: string;
  DIAGNOSTIC_TOKEN: string;
  PROBE: DurableObjectNamespace<AnalysisProbe>;
}

export class AnalysisProbe extends DurableObject<Env> {
  private readonly ready: Promise<ReturnType<typeof httpServerHandler>>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ready = state.blockConcurrencyWhile(async () => {
      const app = express();
      app.get('/probe', async (req, res) => {
        const scenario = String(req.query.scenario);
        if (!['success', 'redirect302', 'redirect307', 'unauthorized', 'forbidden', 'timeout'].includes(scenario)) {
          res.status(400).end(); return;
        }
        try {
          const value = await callService({ baseUrl: env.UPSTREAM_ORIGIN, serviceToken: env.DIAGNOSTIC_TOKEN },
            '/' + scenario, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'fixture.mp4', size: 1024 }) },
            scenario === 'timeout' ? 60 : 2000);
          res.json({ ok: true, value });
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          res.status(error.status).json({ ok: false, code: error.code });
        }
      });
      return httpServerHandler(createServer(app));
    });
  }

  async fetch(request: Request) { return (await this.ready).fetch(request); }
}

export default {
  fetch(request: Request, env: Env) {
    return env.PROBE.getByName('analysis-transport-test').fetch(request);
  },
};
