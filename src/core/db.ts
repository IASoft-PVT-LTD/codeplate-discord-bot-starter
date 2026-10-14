// The database: SQLite through Node's built-in `node:sqlite` (no native build,
// no server). Schema changes are numbered SQL files in migrations/:
//   migrations/001_init.sql, 002_add_birthdays.sql, ...
// They run in order, once each, inside a transaction. Each applied file's
// checksum is stored: editing a migration that already ran is an error (add a
// new one instead). See docs/recipes/add-a-database-table.md.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Db = DatabaseSync;

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const out: Migration[] = [];
  for (const file of files) {
    const m = FILE.exec(file);
    if (!m) throw new Error(`migrations/${file}: name it NNN_snake_case.sql (e.g. 004_add_birthdays.sql)`);
    // Line endings don't count, so a checkout with CRLF has the same checksum.
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    out.push({ version: Number(m[1]), name: m[2]!, file, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) });
  }
  out.forEach((mig, i) => {
    if (mig.version !== i + 1) throw new Error(`migrations/${mig.file}: expected number ${String(i + 1).padStart(3, '0')} (no gaps, no duplicates)`);
  });
  return out;
}

export function migrate(db: Db, migrations = loadMigrations()): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Map(
    (db.prepare('SELECT version, checksum FROM schema_migrations').all() as { version: number; checksum: string }[]).map((r) => [r.version, r.checksum]),
  );
  const ran: number[] = [];
  for (const mig of migrations) {
    const sum = applied.get(mig.version);
    if (sum !== undefined) {
      if (sum !== mig.checksum) {
        throw new Error(`migrations/${mig.file} changed after it was applied. Revert it and add a new migration instead.`);
      }
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(mig.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        mig.version,
        mig.name,
        mig.checksum,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migrations/${mig.file} failed: ${(err as Error).message}`, { cause: err });
    }
    ran.push(mig.version);
  }
  return ran;
}

// Opens (or creates) the database file and brings its schema up to date.
// ':memory:' gives a throwaway database (tests, previews).
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

// Runs fn inside a transaction (all or nothing).
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
