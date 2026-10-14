// Polls and votes (tables: polls, poll_votes in migrations/002_polls.sql).
import type { Db } from '../core/db.ts';

export interface Poll {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  authorId: string;
  question: string;
  choices: string[];
  closesAt: number | null;
  closedAt: number | null;
  createdAt: number;
}

interface PollRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  author_id: string;
  question: string;
  choices: string;
  closes_at: number | null;
  closed_at: number | null;
  created_at: number;
}

const toPoll = (r: PollRow): Poll => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  messageId: r.message_id,
  authorId: r.author_id,
  question: r.question,
  choices: JSON.parse(r.choices) as string[],
  closesAt: r.closes_at,
  closedAt: r.closed_at,
  createdAt: r.created_at,
});

export function createPoll(db: Db, p: Omit<Poll, 'id' | 'messageId' | 'closedAt'>): Poll {
  const r = db
    .prepare('INSERT INTO polls (guild_id, channel_id, author_id, question, choices, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(p.guildId, p.channelId, p.authorId, p.question, JSON.stringify(p.choices), p.closesAt, p.createdAt);
  return getPoll(db, Number(r.lastInsertRowid))!;
}

export function getPoll(db: Db, id: number): Poll | null {
  const r = db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as PollRow | undefined;
  return r ? toPoll(r) : null;
}

export function setPollMessage(db: Db, id: number, messageId: string): void {
  db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, id);
}

export function closePoll(db: Db, id: number, at: number): boolean {
  return Number(db.prepare('UPDATE polls SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(at, id).changes) > 0;
}

// Sets (or changes) a member's vote. Returns the choice they had before, if any.
export function vote(db: Db, pollId: number, userId: string, choice: number, at: number): number | null {
  const before = db.prepare('SELECT choice FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollId, userId) as { choice: number } | undefined;
  db.prepare(
    'INSERT INTO poll_votes (poll_id, user_id, choice, voted_at) VALUES (?, ?, ?, ?) ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = excluded.choice, voted_at = excluded.voted_at',
  ).run(pollId, userId, choice, at);
  return before ? before.choice : null;
}

export function removeVote(db: Db, pollId: number, userId: string): boolean {
  return Number(db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, userId).changes) > 0;
}

// Votes per choice, in choice order.
export function tally(db: Db, poll: Poll): number[] {
  const counts = poll.choices.map(() => 0);
  const rows = db.prepare('SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice').all(poll.id) as { choice: number; n: number }[];
  for (const r of rows) if (r.choice in counts) counts[r.choice] = r.n;
  return counts;
}
