# Scheduled jobs

Use this for anything that happens later or repeatedly: "close the poll in 2 hours", "remind me tomorrow at 9", "post the reading schedule every Monday at 9:00", "wish happy birthday at midnight". Jobs are rows in the `jobs` table, so they survive restarts. Never use `setTimeout`/`setInterval` for this.

## Steps

1. **Declare the job in the command file that owns it**, with a zod schema for its payload:

   ```ts
   import { z } from 'zod';
   import { job } from '../core/command.ts';

   jobs: {
     post: job({
       payload: z.object({ guildId: z.string(), channelId: z.string() }),
       async run({ bot, log, job: j }, { guildId, channelId }) {
         const channel = await bot.client.channels.fetch(channelId).catch(() => null);
         if (!channel?.isSendable()) {
           log.warn('weekly post channel is gone', { guildId, channelId });
           return; // done: don't retry something that can't work
         }
         await channel.send({ embeds: [weeklyEmbed(bot, guildId)] });
         if (j.late) log.info('posted late (the bot was offline)');
       },
     }),
   },
   ```

   The job's kind is `"<command>:<name>"` (here `schedule:post`).

2. **Schedule it** from a handler (or another job): `const id = bot.scheduler.schedule('schedule:post', when, { guildId, channelId })`. `when` is Unix milliseconds from `bot.clock.now()`. Keep the returned id (e.g. in your table) if the user can cancel it: `bot.scheduler.cancel(id)`.

3. **Repeating jobs** ("every Monday at 09:00"): see **Every day or every week, in the server's time zone** below. Don't reschedule by hand at the end of `run`.

4. **Know the behavior:** a job runs once; a job that throws is retried after 1, 5 and 30 minutes and then marked `failed` (logged as an error). If the bot was offline when it was due, it runs at startup with `ctx.job.late = true` (say so to users, like `/remind` does, or skip stale work).

5. **Test with the fake clock:**

   ```ts
   await t.slash('schedule', { channel: t.general, time: '09:00' }, { sub: 'set', as: t.owner });
   await t.advance(7 * 24 * 60 * 60_000); // runs every job that came due
   assert.match(textOf(t.discord.lastMessage(t.general.id)), /This week/);
   ```

   For "survives a restart", copy the restart test in `tests/commands/remind.test.ts`.

## Every day or every week, in the server's time zone

Times of day belong to a time zone: "Monday 09:00" in London is 08:00 UTC in summer and 09:00 UTC in winter. The template handles this for you:

- **The zone** is `BOT.timezone` in `src/config.ts` (an IANA name: `'UTC'` by default, `'Europe/London'`, `'America/New_York'`, `'Asia/Kolkata'`…), available in handlers as `bot.timezone`. Ask the user for it in the interview and record it in `docs/project.md`. (For a bot in servers in different zones, add a `timezone` setting (`per-server-settings.md`) and pass it instead: every helper takes the zone as an argument. The scheduler's repeating jobs use `bot.timezone`; for per-server zones, schedule one-off jobs with `nextOccurrence(rule, now, zone)` and schedule the next one at the end of `run`.)
- **The helpers** are in `src/core/time.ts`, with tests in `tests/core/time.test.ts`:
  - `parseTime('18:30' | '6:30pm')`, `parseDate('2026-10-20')`, and `parseWhen('tomorrow 9am', now, zone)` for what members type (`/remind me` uses it);
  - `fromLocal({ year, month, day, hour, minute }, zone)` → `{ ms, exact }`, and `toLocal(ms, zone)`;
  - `nextOccurrence(rule, after, zone)`: the next "every Monday at 09:00" after a moment;
  - `formatDateTime(ms, zone)` → `"Wed 14 Oct 2026, 13:00 BST"` for plain text (embed footers, button labels, logs). In message text, prefer Discord's `<t:…>` markup (`discordTime()` in `src/core/text.ts`): each reader sees it in their own zone.
- **Clock changes:** a time that doesn't exist (02:30 on the night the clocks go forward) moves forward by the gap (03:30) and `exact` is `false`: tell the member, like `/remind me` does. A time that happens twice (the night the clocks go back) is the first one, so a daily job runs once.

### Steps

1. **Store the schedule** where it belongs: a setting for one post per server (`schedule: { channelId, day, at }`), or a column in your table for one per item (like `reminders.repeat`, `migrations/005_repeating_jobs.sql`).

2. **Start the series** with a rule (`at` is `"HH:MM"` on the bot's clock; `day` is 0 = Sunday … 6 = Saturday):

   ```ts
   const id = bot.scheduler.repeat('schedule:post', { every: 'week', day: 1, at: '09:00' }, { guildId, channelId });
   // or { every: 'day', at: '18:30' }
   ```

   It first runs at the next occurrence after now. Keep `id`: the same job row (and id) is reused for every run, and `bot.scheduler.cancel(id)` stops the series. To change the time, cancel and `repeat` again. Avoid two copies: before starting one, cancel the pending one (`bot.scheduler.pending('schedule:post')` lists rows; their `payload` is JSON).

3. **In `run`, `ctx.job.next`** is when it runs next (null for one-off jobs): show it ("Next post: <t:…:F>") or store it, like `/remind` updates `due_at`.

4. **The catch-up policy:** if the bot was offline over one or more occurrences, the job runs **once** at startup with `ctx.job.late = true`, then continues from the next occurrence after now; the missed ones are not replayed (nobody wants three "Monday post"s at once). If a late run would be wrong (a "good morning" at 3 pm), check `ctx.job.late` and return without posting: the series still continues. If a run throws, it's retried after 1, 5 and 30 minutes; if every retry fails, that occurrence is skipped (logged as an error) and the series goes on.

5. **Test it** with the zone the user chose, across a clock change. `startTestBot({ timezone: 'Europe/London' })` sets the zone; the fake clock starts on Wednesday 14 October 2026, 12:00 UTC, and London's clocks go back on 25 October:

   ```ts
   const t = await startTestBot({ timezone: 'Europe/London' });
   await t.slash('schedule', { channel: t.general, day: '1', time: '09:00' }, { sub: 'set', as: t.owner });
   await t.advance(5 * DAY - 4 * HOUR); // Monday 19 October, 08:00 UTC = 09:00 BST
   // …assert the post, then a week later it's 09:00 UTC (GMT)
   ```

   `tests/commands/remind.test.ts` (`/remind every`) and `tests/core/scheduler.test.ts` (`repeating jobs`) show both, plus restarts and the catch-up.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS`, with a test that advances the clock past the job and checks what was posted (for a repeating job: two runs, across a clock change if the zone has one).
2. A restart test shows the job still fires (late) after the bot was offline, once.
3. `npm run shots` with a scenario that advances time shows the posted message; times drawn by the preview are in `BOT.timezone`.
