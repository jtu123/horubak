import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { DATABASE_SCHEMA } from '../src/database-contract.js';
import type { Database, SqlValue } from '../src/database-contract.js';
import { createApp } from '../src/server.js';
import { configureSocialProviders } from '../src/social-providers.js';

interface Env {
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_STORE: DurableObjectNamespace<HorubakAuthStore>;
}

function cloudDatabase(storage: DurableObjectStorage): Database {
  storage.sql.exec(DATABASE_SCHEMA);
  return {
    prepare(sql) {
      const rows = (values: SqlValue[]) => storage.sql.exec(sql, ...values);
      return {
        get: (...values) => rows(values).toArray()[0],
        all: (...values) => rows(values).toArray(),
        run: (...values) => { rows(values).toArray(); },
      };
    },
    transaction: run => storage.transactionSync(run),
  };
}

export class HorubakAuthStore extends DurableObject<Env> {
  private readonly ready: Promise<ReturnType<typeof httpServerHandler>>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ready = state.blockConcurrencyWhile(async () => {
      const database = cloudDatabase(state.storage);
      const app = await createApp(database, {
        origin: env.APP_ORIGIN,
        secureCookies: new URL(env.APP_ORIGIN).protocol === 'https:',
        trustProxy: true,
        socialProviders: configureSocialProviders(env.APP_ORIGIN, new URL(env.APP_ORIGIN).protocol === 'https:', {
          GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
        }),
      });
      return httpServerHandler(createServer(app));
    });
  }

  async fetch(request: Request) {
    const handler = await this.ready;
    return handler.fetch(request);
  }
}

export default {
  fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN || !url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 404 });
    }
    const headers = new Headers(request.headers);
    // Only trust the visitor IP supplied by Cloudflare at the Pages boundary.
    const visitorIp = headers.get('cf-connecting-ip');
    headers.delete('x-forwarded-for');
    if (visitorIp && isIP(visitorIp)) headers.set('x-forwarded-for', visitorIp);
    const store = env.AUTH_STORE.getByName('horubak');
    return store.fetch(new Request(request, { headers }));
  },
};
