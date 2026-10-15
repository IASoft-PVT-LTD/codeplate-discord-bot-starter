// Tags: saved answers, one name per server (table: tags in migrations/004_tags_and_quotes.sql).
import type { Db } from '../core/db.ts';

export interface Tag {
  guildId: string;
  name: string;
  content: string;
  authorId: string;
  uses: number;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  guild_id: string;
  name: string;
  content: string;
  author_id: string;
  uses: number;
  created_at: number;
  updated_at: number;
}

const toTag = (r: Row): Tag => ({
  guildId: r.guild_id,
  name: r.name,
  content: r.content,
  authorId: r.author_id,
  uses: r.uses,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const TAG_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export function getTag(db: Db, guildId: string, name: string): Tag | null {
  const r = db.prepare('SELECT * FROM tags WHERE guild_id = ? AND name = ?').get(guildId, normalizeTagName(name)) as Row | undefined;
  return r ? toTag(r) : null;
}

// Creates the tag, or replaces its content if it exists. Returns true if it was new.
export function saveTag(db: Db, t: { guildId: string; name: string; content: string; authorId: string; at: number }): boolean {
  const existed = getTag(db, t.guildId, t.name) !== null;
  db.prepare(
    `INSERT INTO tags (guild_id, name, content, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(t.guildId, normalizeTagName(t.name), t.content, t.authorId, t.at, t.at);
  return !existed;
}

export function useTag(db: Db, guildId: string, name: string): void {
  db.prepare('UPDATE tags SET uses = uses + 1 WHERE guild_id = ? AND name = ?').run(guildId, normalizeTagName(name));
}

export function deleteTag(db: Db, guildId: string, name: string): boolean {
  return Number(db.prepare('DELETE FROM tags WHERE guild_id = ? AND name = ?').run(guildId, normalizeTagName(name)).changes) > 0;
}

export function listTags(db: Db, guildId: string): Tag[] {
  return (db.prepare('SELECT * FROM tags WHERE guild_id = ? ORDER BY name').all(guildId) as unknown as Row[]).map(toTag);
}

// For autocomplete: names starting with (then containing) what was typed.
export function searchTags(db: Db, guildId: string, typed: string, limit = 25): string[] {
  const q = normalizeTagName(typed).replace(/[%_]/g, '');
  const rows = db
    .prepare(
      "SELECT name FROM tags WHERE guild_id = ? AND name LIKE ? ORDER BY (CASE WHEN name LIKE ? THEN 0 ELSE 1 END), uses DESC, name LIMIT ?",
    )
    .all(guildId, `%${q}%`, `${q}%`, limit) as { name: string }[];
  return rows.map((r) => r.name);
}
