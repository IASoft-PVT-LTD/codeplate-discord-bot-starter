// Jobs that run later and survive restarts: reminders, closing polls, anything
// "in 2 hours" or "every Monday at 9:00". Each job is a row in the `jobs` table
// with a kind ("<command>:<job>", declared under `jobs` in the command file), a
// time and a JSON payload (checked by the job's zod schema).
//
//   const id = bot.scheduler.schedule('remind:fire', dueAt, { reminderId });
//   const id = bot.scheduler.repeat('remind:fire', { every: 'week', day: 1, at: '09:00' }, { reminderId });
//   bot.scheduler.cancel(id);
//
// When the bot starts, jobs that came due while it was offline run right away
// with `ctx.job.late = true`. A job that throws is retried (1, 5, then 30
// minutes later) and marked failed after MAX_ATTEMPTS.
//
// Repeating jobs read their rule on the wall clock of the bot's time zone
// (BOT.timezone), so "09:00" stays 09:00 when the clocks change. After each
// run (or after its last retry fails) the same row moves to the next
// occurrence; `ctx.job.next` says when that is. Catch-up: if the bot was
// offline over several occurrences, the job runs once (late), then continues
// from the next occurrence after now; missed ones are not replayed. Cancelling
// the id stops the series. See docs/recipes/scheduled-jobs.md.
import type { Bot, Job } from './command.ts';
import type { Clock } from './clock.ts';
import type { Db } from './db.ts';
import type { Logger } from './log.ts';
import type { Repeat } from './time.ts';
import { RepeatSchema, nextOccurrence } from './time.ts';

export const MAX_ATTEMPTS = 4;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000];
// The loop wakes at least this often, so a job added by another process (or a
// clock jump) is never missed for long.
const MAX_SLEEP_MS = 60_000;
// A job that runs this much after its time counts as late.
const LATE_MS = 60_000;

export interface JobRow {
  id: number;
  kind: string;
  run_at: number;
  payload: string;
  status: 'pending' | 'done' | 'failed' | 'cancelled';
  attempts: number;
  last_error: string | null;
  repeat: string | null; // a JSON Repeat rule, or null for a one-off job
}

export interface Scheduler {
  schedule(kind: string, runAt: number, payload: unknown): number;
  // A job that runs at every occurrence of `rule` (in the bot's time zone),
  // first at the next one after now. Returns its id (the same for every run).
  repeat(kind: string, rule: Repeat, payload: unknown): number;
  cancel(id: number): boolean;
  pending(kind?: string): JobRow[];
  // Runs every job that is due now. Returns how many ran.
  runDue(): Promise<number>;
  start(): void;
  stop(): void;
  // Resolves when no run is in progress (tests).
  idle(): Promise<void>;
}

export function createScheduler(opts: { db: Db; clock: Clock; log: Logger; jobs: Map<string, Job>; bot: () => Bot; timezone?: string }): Scheduler {
  const { db, clock, log, jobs } = opts;
  const zone = opts.timezone ?? 'UTC';
  let cancelTimer: (() => void) | null = null;
  let running: Promise<number> | null = null;
  let started = false;

  const insert = db.prepare('INSERT INTO jobs (kind, run_at, payload, created_at, repeat) VALUES (?, ?, ?, ?, ?)');
  const due = db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 50");
  const next = db.prepare("SELECT MIN(run_at) AS at FROM jobs WHERE status = 'pending'");
  const finish = db.prepare('UPDATE jobs SET status = ?, attempts = attempts + 1, last_error = ?, finished_at = ? WHERE id = ?');
  const retry = db.prepare('UPDATE jobs SET attempts = attempts + 1, last_error = ?, run_at = ? WHERE id = ?');
  // A repeating job moves on to its next occurrence (with its attempts reset).
  const again = db.prepare("UPDATE jobs SET status = 'pending', attempts = 0, last_error = ?, run_at = ?, finished_at = ? WHERE id = ?");

  function checkPayload(kind: string, payload: unknown): string {
    const def = jobs.get(kind);
    if (!def) throw new Error(`Unknown job kind "${kind}". Declare it under \`jobs\` in its command file.`);
    return JSON.stringify(def.payload.parse(payload));
  }

  function arm() {
    cancelTimer?.();
    cancelTimer = null;
    if (!started) return;
    const at = (next.get() as { at: number | null }).at;
    const wait = at === null ? MAX_SLEEP_MS : Math.min(Math.max(at - clock.now(), 0), MAX_SLEEP_MS);
    cancelTimer = clock.setTimer(() => void tick(), wait);
  }

  async function tick() {
    await scheduler.runDue();
    arm();
  }

  async function runOne(row: JobRow) {
    const def = jobs.get(row.kind);
    const jlog = log.child({ job: row.kind, jobId: row.id });
    if (!def) {
      jlog.error('no handler for job kind; marking it failed');
      finish.run('failed', `unknown job kind ${row.kind}`, clock.now(), row.id);
      return;
    }
    const parsed = def.payload.safeParse(JSON.parse(row.payload));
    if (!parsed.success) {
      jlog.error('job payload is invalid; marking it failed', { issues: parsed.error.issues.map((i) => i.message) });
      finish.run('failed', 'invalid payload', clock.now(), row.id);
      return;
    }
    let rule: Repeat | null = null;
    if (row.repeat !== null) {
      const r = RepeatSchema.safeParse(JSON.parse(row.repeat));
      if (!r.success) {
        jlog.error('repeat rule is invalid; marking the job failed', { repeat: row.repeat });
        finish.run('failed', 'invalid repeat rule', clock.now(), row.id);
        return;
      }
      rule = r.data;
    }
    const late = clock.now() - row.run_at > LATE_MS;
    const following = rule ? nextOccurrence(rule, clock.now(), zone) : null;
    try {
      await def.run({ bot: opts.bot(), log: jlog, job: { id: row.id, runAt: row.run_at, late, next: following } }, parsed.data);
      if (following !== null) again.run(null, following, clock.now(), row.id);
      else finish.run('done', null, clock.now(), row.id);
      jlog.debug('job done', { late, next: following });
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = String((err as Error)?.message ?? err);
      if (attempts >= MAX_ATTEMPTS) {
        if (rule) {
          // Give up on this occurrence, not on the series.
          const after = nextOccurrence(rule, clock.now(), zone);
          jlog.error('repeating job failed for good this time; it runs again at its next time', { err, attempts, next: after });
          again.run(message, after, clock.now(), row.id);
        } else {
          jlog.error('job failed for good', { err, attempts });
          finish.run('failed', message, clock.now(), row.id);
        }
      } else {
        const wait = RETRY_MS[attempts - 1] ?? RETRY_MS.at(-1)!;
        jlog.warn('job failed; will retry', { err, attempts, retryInMs: wait });
        retry.run(message, clock.now() + wait, row.id);
      }
    }
  }

  const scheduler: Scheduler = {
    schedule(kind, runAt, payload) {
      const r = insert.run(kind, Math.round(runAt), checkPayload(kind, payload), clock.now(), null);
      arm();
      return Number(r.lastInsertRowid);
    },
    repeat(kind, rule, payload) {
      const checked = RepeatSchema.parse(rule);
      const r = insert.run(kind, nextOccurrence(checked, clock.now(), zone), checkPayload(kind, payload), clock.now(), JSON.stringify(checked));
      arm();
      return Number(r.lastInsertRowid);
    },
    cancel(id) {
      const r = db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'pending'").run(clock.now(), id);
      return Number(r.changes) > 0;
    },
    pending(kind) {
      return (
        kind
          ? db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND kind = ? ORDER BY run_at").all(kind)
          : db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY run_at").all()
      ) as unknown as JobRow[];
    },
    async runDue() {
      // One run at a time: a second call waits for the first, then runs again.
      while (running) await running;
      running = (async () => {
        let count = 0;
        for (;;) {
          const rows = due.all(clock.now()) as unknown as JobRow[];
          if (!rows.length) break;
          for (const row of rows) {
            await runOne(row);
            count++;
          }
        }
        return count;
      })();
      try {
        return await running;
      } finally {
        running = null;
      }
    },
    start() {
      started = true;
      void tick();
    },
    stop() {
      started = false;
      cancelTimer?.();
      cancelTimer = null;
    },
    async idle() {
      while (running) await running;
    },
  };
  return scheduler;
}
