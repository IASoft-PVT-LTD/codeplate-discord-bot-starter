// The scheduler with a fake clock: due jobs run once, late jobs are flagged,
// failures retry, invalid payloads are refused.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { z } from 'zod';
import type { Bot, Job, JobCtx } from '../../src/core/command.ts';
import { FakeClock } from '../../src/core/clock.ts';
import { openDb } from '../../src/core/db.ts';
import { memoryLogger } from '../../src/core/log.ts';
import { MAX_ATTEMPTS, createScheduler } from '../../src/core/scheduler.ts';

function setup(run: (ctx: JobCtx, p: { n: number }) => Promise<void>) {
  const db = openDb(':memory:');
  const clock = new FakeClock();
  const log = memoryLogger();
  const jobs = new Map<string, Job>([['test:job', { payload: z.object({ n: z.number() }), run } as Job]]);
  const scheduler = createScheduler({ db, clock, log, jobs, bot: () => ({}) as Bot });
  return { db, clock, log, scheduler };
}

const MIN = 60_000;

describe('scheduler', () => {
  test('runs a job when its time comes (timers on the fake clock), once', async () => {
    const ran: number[] = [];
    const { clock, scheduler } = setup(async (_ctx, p) => {
      ran.push(p.n);
    });
    scheduler.start();
    scheduler.schedule('test:job', clock.now() + 10 * MIN, { n: 1 });
    scheduler.schedule('test:job', clock.now() + 5 * MIN, { n: 2 });
    // The loop sleeps at most a minute at a time; walk the clock forward in
    // 30-second steps, letting each wake-up finish.
    const walk = async (ms: number) => {
      for (let done = 0; done < ms; done += 30_000) {
        clock.advance(30_000);
        await new Promise((r) => setImmediate(r));
        await scheduler.idle();
        await new Promise((r) => setImmediate(r));
      }
    };
    await walk(4 * MIN);
    assert.deepEqual(ran, []);
    await walk(1 * MIN);
    assert.deepEqual(ran, [2]);
    await walk(6 * MIN);
    assert.deepEqual(ran, [2, 1]);
    assert.equal(scheduler.pending().length, 0);
    scheduler.stop();
  });

  test('a job that is more than a minute overdue runs with late = true', async () => {
    const seen: boolean[] = [];
    const { clock, scheduler } = setup(async (ctx) => {
      seen.push(ctx.job.late);
    });
    scheduler.schedule('test:job', clock.now() + MIN, { n: 1 });
    scheduler.schedule('test:job', clock.now() + 2 * MIN, { n: 2 });
    clock.advance(2 * MIN + 30_000);
    await scheduler.runDue();
    assert.deepEqual(seen, [true, false]);
  });

  test('retries a failing job, then marks it failed', async () => {
    let calls = 0;
    const { clock, scheduler, db, log } = setup(async () => {
      calls++;
      throw new Error('discord is down');
    });
    const id = scheduler.schedule('test:job', clock.now(), { n: 1 });
    for (let i = 0; i < 10; i++) {
      await scheduler.runDue();
      clock.advance(31 * MIN);
    }
    assert.equal(calls, MAX_ATTEMPTS);
    const row = db.prepare('SELECT status, attempts, last_error FROM jobs WHERE id = ?').get(id) as { status: string; attempts: number; last_error: string };
    assert.deepEqual({ ...row }, { status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'discord is down' });
    assert.ok(log.lines.some((l) => l.level === 'error' && l.msg === 'job failed for good'));
  });

  test('refuses unknown kinds and bad payloads when scheduling; cancel works', async () => {
    const { clock, scheduler } = setup(async () => {});
    assert.throws(() => scheduler.schedule('nope:job', clock.now(), {}), /Unknown job kind/);
    assert.throws(() => scheduler.schedule('test:job', clock.now(), { n: 'one' }));
    const id = scheduler.schedule('test:job', clock.now() + MIN, { n: 1 });
    assert.equal(scheduler.cancel(id), true);
    assert.equal(scheduler.cancel(id), false);
    clock.advance(2 * MIN);
    assert.equal(await scheduler.runDue(), 0);
  });
});

// Repeating jobs: "every Monday at 09:00" in a time zone, kept in the database.
// The fake clock starts on Wednesday 14 October 2026, 12:00 UTC (13:00 in London).
describe('repeating jobs', () => {
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const monday9 = { every: 'week', day: 1, at: '09:00' } as const;

  function repeating(run: (ctx: JobCtx, p: { n: number }) => Promise<void>, db = openDb(':memory:'), clock = new FakeClock()) {
    const log = memoryLogger();
    const jobs = new Map<string, Job>([['test:job', { payload: z.object({ n: z.number() }), run } as Job]]);
    const scheduler = createScheduler({ db, clock, log, jobs, bot: () => ({}) as Bot, timezone: 'Europe/London' });
    return { db, clock, log, scheduler };
  }

  test('runs at every occurrence, at 09:00 local before and after the clocks change, with the same id', async () => {
    const runs: { at: number; next: number | null; id: number }[] = [];
    const { clock, scheduler } = repeating(async (ctx) => {
      runs.push({ at: clock.now(), next: ctx.job.next, id: ctx.job.id });
    });
    const id = scheduler.repeat('test:job', monday9, { n: 1 });
    assert.equal(scheduler.pending()[0]!.run_at, Date.UTC(2026, 9, 19, 8), 'Mon 19 Oct 09:00 BST');
    for (let i = 0; i < 3 * 7 * 24; i++) {
      clock.advance(HOUR);
      await scheduler.runDue();
    }
    assert.deepEqual(
      runs.map((r) => r.at),
      [Date.UTC(2026, 9, 19, 8), Date.UTC(2026, 9, 26, 9), Date.UTC(2026, 10, 2, 9)],
      'BST, then GMT: always 09:00 in London',
    );
    assert.deepEqual(runs.map((r) => r.id), [id, id, id]);
    assert.equal(runs[0]!.next, Date.UTC(2026, 9, 26, 9), 'ctx.job.next is the following run');
    assert.equal(scheduler.pending().length, 1, 'one row, waiting for the next Monday');
  });

  test('survives a restart; after a long outage it runs once (late), then carries on', async () => {
    const db = openDb(':memory:');
    const clock = new FakeClock();
    const first = repeating(async () => {}, db, clock);
    const id = first.scheduler.repeat('test:job', monday9, { n: 1 });
    first.scheduler.stop();
    clock.advance(20 * DAY); // offline over three Mondays
    const seen: { late: boolean; id: number }[] = [];
    const second = repeating(async (ctx) => void seen.push({ late: ctx.job.late, id: ctx.job.id }), db, clock);
    assert.equal(await second.scheduler.runDue(), 1, 'missed runs are not replayed');
    assert.deepEqual(seen, [{ late: true, id }]);
    assert.equal(second.scheduler.pending()[0]!.run_at, Date.UTC(2026, 10, 9, 9), 'the next Monday after now');
  });

  test('a failing run is retried, then skipped; the series goes on. Cancel stops it', async () => {
    let calls = 0;
    const { clock, scheduler, log, db } = repeating(async () => {
      calls++;
      throw new Error('discord is down');
    });
    const id = scheduler.repeat('test:job', { every: 'day', at: '09:00' }, { n: 1 });
    clock.advance(DAY);
    for (let i = 0; i < 10; i++) {
      await scheduler.runDue();
      clock.advance(31 * MIN);
    }
    assert.equal(calls, MAX_ATTEMPTS);
    assert.ok(log.lines.some((l) => l.level === 'error' && /next time/.test(l.msg)));
    const row = db.prepare('SELECT status, attempts, run_at FROM jobs WHERE id = ?').get(id) as { status: string; attempts: number; run_at: number };
    assert.deepEqual({ ...row }, { status: 'pending', attempts: 0, run_at: Date.UTC(2026, 9, 16, 8) });
    assert.equal(scheduler.cancel(id), true);
    clock.advance(2 * DAY);
    assert.equal(await scheduler.runDue(), 0);
  });

  test('refuses a bad rule', () => {
    const { scheduler } = repeating(async () => {});
    assert.throws(() => scheduler.repeat('test:job', { every: 'week', day: 7, at: '09:00' }, { n: 1 }));
    assert.throws(() => scheduler.repeat('test:job', { every: 'day', at: '9am' }, { n: 1 }));
  });
});
