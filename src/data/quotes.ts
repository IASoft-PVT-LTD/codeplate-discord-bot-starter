// Quotes (table: quotes in migrations/004_tags_and_quotes.sql).
import type { Db } from '../core/db.ts';

export interface Quote {
  id: number;
  guildId: string;
  text: string;
  authorId: string | null;
  authorName: string;
  savedBy: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

interface Row {
  id: number;
  guild_id: string;
  text: string;
  author_id: string | null;
  author_name: string;
  saved_by: string;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
}

const toQuote = (r: Row): Quote => ({
  id: r.id,
  guildId: r.guild_id,
  text: r.text,
  authorId: r.author_id,
  authorName: r.author_name,
  savedBy: r.saved_by,
  channelId: r.channel_id,
  messageId: r.message_id,
  createdAt: r.created_at,
});

export function addQuote(db: Db, q: Omit<Quote, 'id'>): Quote {
  const r = db
    .prepare('INSERT INTO quotes (guild_id, text, author_id, author_name, saved_by, channel_id, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(q.guildId, q.text, q.authorId, q.authorName, q.savedBy, q.channelId, q.messageId, q.createdAt);
  return { ...q, id: Number(r.lastInsertRowid) };
}

export function findQuoteByMessage(db: Db, guildId: string, messageId: string): Quote | null {
  const r = db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND message_id = ?').get(guildId, messageId) as Row | undefined;
  return r ? toQuote(r) : null;
}

// `pick` chooses an index (tests pass a fixed one); defaults to Math.random.
export function randomQuote(db: Db, guildId: string, authorId?: string, pick: (n: number) => number = (n) => Math.floor(Math.random() * n)): Quote | null {
  const rows = (
    authorId
      ? db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND author_id = ? ORDER BY id').all(guildId, authorId)
      : db.prepare('SELECT * FROM quotes WHERE guild_id = ? ORDER BY id').all(guildId)
  ) as unknown as Row[];
  if (!rows.length) return null;
  return toQuote(rows[Math.min(pick(rows.length), rows.length - 1)]!);
}

export function countQuotes(db: Db, guildId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE guild_id = ?').get(guildId) as { n: number }).n;
}

export function deleteQuote(db: Db, guildId: string, id: number): boolean {
  return Number(db.prepare('DELETE FROM quotes WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0;
}

export function getQuote(db: Db, guildId: string, id: number): Quote | null {
  const r = db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND id = ?').get(guildId, id) as Row | undefined;
  return r ? toQuote(r) : null;
}
