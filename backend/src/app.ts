import 'dotenv/config';
import { openDatabase } from './database.js';
import { createApp } from './server.js';
import { configureSocialProviders } from './social-providers.js';

async function start() {
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173').origin;
  const secureCookies = process.env.COOKIE_SECURE === 'true';
  if (process.env.NODE_ENV === 'production' && (!secureCookies || !origin.startsWith('https://'))) throw new Error('운영 환경에는 HTTPS APP_ORIGIN과 COOKIE_SECURE=true가 필요합니다.');
  const db = openDatabase(process.env.DATABASE_PATH ?? './data/horubak.sqlite');
  const app = await createApp(db, { origin, secureCookies, trustProxy: process.env.TRUST_PROXY === '1', staticDirectory: process.env.FRONTEND_DIST, socialProviders: configureSocialProviders(origin, secureCookies) });
  const port = Number(process.env.PORT ?? 8080); const host = process.env.HOST ?? '127.0.0.1';
  const server = app.listen(port, host, () => console.log(`Horubak API: http://${host}:${port}`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
start().catch(error => { console.error(error instanceof Error ? error.message : 'Server startup failed'); process.exitCode = 1; });
