// Reminders (table: reminders in migrations/003_reminders.sql, `repeat` from
// 005_repeating_jobs.sql). Each one has a scheduler job ("remind:fire") that
// sends it; a repeating one keeps its job and moves `due_at` on after each run.
import type { Db } from '../core/db.ts';
import { RepeatSchema } from '../core/time.ts';
import type { Repeat } from '../core/time.ts';

export interface Reminder {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  text: string;
  dueAt: number;
  jobId: number | null;
  sentAt: number | null;
  createdAt: number;
  repeat: Repeat | null; // null: once
}

interface Row {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  text: string;
  due_at: number;
  job_id: number | null;
  sent_at: number | null;
  created_at: number;
  repeat: string | null;
}

const toReminder = (r: Row): Reminder => ({
  id: r.id,
  guildId: r.guild_id,
  channelId: r.channel_id,
  userId: r.user_id,
  text: r.text,
  dueAt: r.due_at,
  jobId: r.job_id,
  sentAt: r.sent_at,
  createdAt: r.created_at,
  repeat: r.repeat === null ? null : RepeatSchema.parse(JSON.parse(r.repeat)),
});

export function addReminder(db: Db, r: Omit<Reminder, 'id' | 'jobId' | 'sentAt' | 'repeat'> & { repeat?: Repeat | null }): Reminder {
  const res = db
    .prepare('INSERT INTO reminders (guild_id, channel_id, user_id, text, due_at, created_at, repeat) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(r.guildId, r.channelId, r.userId, r.text, r.dueAt, r.createdAt, r.repeat ? JSON.stringify(r.repeat) : null);
  return getReminder(db, Number(res.lastInsertRowid))!;
}

export function setReminderJob(db: Db, id: number, jobId: number): void {
  db.prepare('UPDATE reminders SET job_id = ? WHERE id = ?').run(jobId, id);
}

export function getReminder(db: Db, id: number): Reminder | null {
  const r = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Row | undefined;
  return r ? toReminder(r) : null;
}

export function pendingReminders(db: Db, guildId: string, userId: string): Reminder[] {
  return (db.prepare('SELECT * FROM reminders WHERE guild_id = ? AND user_id = ? AND sent_at IS NULL ORDER BY due_at').all(guildId, userId) as unknown as Row[]).map(
    toReminder,
  );
}

// A repeating reminder was sent: it's due again at `next`.
export function setReminderDue(db: Db, id: number, next: number): void {
  db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?').run(next, id);
}

export function markSent(db: Db, id: number, at: number): void {
  db.prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').run(at, id);
}

export function deleteReminder(db: Db, id: number): void {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
}
