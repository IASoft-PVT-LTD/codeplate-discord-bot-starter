// Migrations: numbered, applied once each, in a transaction, never edited after shipping.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { loadMigrations, migrate, openDb } from '../../src/core/db.ts';

function scratch(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('database and migrations', () => {
  test('the shipped migrations apply to an empty database, once', () => {
    const db = new DatabaseSync(':memory:');
    const all = loadMigrations();
    assert.deepEqual(migrate(db), all.map((m) => m.version));
    assert.deepEqual(migrate(db), [], 'running again does nothing');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const want of ['guild_settings', 'jobs', 'poll_votes', 'polls', 'quotes', 'reminders', 'schema_migrations', 'tags']) assert.ok(tables.includes(want), want);
    db.close();
  });

  test('a file database survives reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-db-'));
    try {
      const path = join(dir, 'nested', 'bot.db');
      const a = openDb(path);
      a.prepare("INSERT INTO tags (guild_id, name, content, author_id, created_at, updated_at) VALUES ('1', 'x', 'y', '2', 0, 0)").run();
      a.close();
      const b = openDb(path);
      assert.equal((b.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n, 1);
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('numbering must have no gaps and names must follow NNN_name.sql', () => {
    assert.throws(() => loadMigrations(scratch({ '001_a.sql': 'SELECT 1;', '003_b.sql': 'SELECT 1;' })), /expected number 002/);
    assert.throws(() => loadMigrations(scratch({ '1_a.sql': 'SELECT 1;' })), /NNN_snake_case/);
  });

  test('editing a migration that already ran is an error', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, loadMigrations(scratch({ '001_a.sql': 'CREATE TABLE a (x);' })));
    assert.throws(() => migrate(db, loadMigrations(scratch({ '001_a.sql': 'CREATE TABLE a (x, y);' }))), /changed after it was applied/);
    db.close();
  });

  test('a failing migration rolls back completely', () => {
    const db = new DatabaseSync(':memory:');
    const dir = scratch({ '001_a.sql': 'CREATE TABLE a (x);', '002_b.sql': 'CREATE TABLE b (x); INSERT INTO nope VALUES (1);' });
    assert.throws(() => migrate(db, loadMigrations(dir)), /002_b.sql failed/);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    assert.ok(names.includes('a'));
    assert.ok(!names.includes('b'), 'table b was rolled back');
    db.close();
  });

  test('line endings do not change checksums (CRLF checkouts on Windows)', () => {
    const lf = loadMigrations(scratch({ '001_a.sql': 'CREATE TABLE a (x);\nSELECT 1;\n' }))[0]!;
    const crlf = loadMigrations(scratch({ '001_a.sql': 'CREATE TABLE a (x);\r\nSELECT 1;\r\n' }))[0]!;
    assert.equal(lf.checksum, crlf.checksum);
  });
});
