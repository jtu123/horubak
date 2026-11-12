import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DATABASE_SCHEMA } from './database-contract.js';
export { audit, transaction } from './database-contract.js';

class LocalDatabase extends DatabaseSync {
  transaction<T>(run: () => T): T {
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      this.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new LocalDatabase(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(DATABASE_SCHEMA);
  db.exec('PRAGMA user_version = 2;');
  return db;
}
