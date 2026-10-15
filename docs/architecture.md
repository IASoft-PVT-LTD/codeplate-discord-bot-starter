# Architecture

Huddle is a single Node process: the discord.js client keeps a websocket to Discord's gateway (events in) and calls Discord's HTTP API (replies out). Everything else is in-process: a SQLite file, a scheduler loop, a logger.

```
Discord gateway ──INTERACTION_CREATE──► discord.js Client ──► router (src/core/router.ts)
                 ──GUILD_MEMBER_ADD───►                   ──► events (src/events/)
                                                              │
     src/commands/<name>.ts  ◄── run / components / modals / autocomplete
          │            │
          │            └── bot.scheduler.schedule(...) ──► jobs table ──► scheduler loop ──► jobs in the command file
          ▼
     src/data/<feature>.ts ──► SQLite (.data/bot.db, migrations/)
          │
          ▼
     interaction.reply / update / showModal / channel.send ──► Discord HTTP API
```

## An interaction, step by step

1. A member runs `/poll question:… answers:…`. Discord sends `INTERACTION_CREATE`; discord.js builds a `ChatInputCommandInteraction` and emits `interactionCreate`.
2. `src/bot.ts` passes it to the router. The router finds `poll` in `src/commands/index.ts` (and the subcommand, if any), then:
   1. checks the member's and the bot's permissions in this channel (`memberPermissions`, `botPermissions`) and who the member is (`who: 'manager' | 'owner'`: the manager role the owner picked with `/settings manager-role`, else Manage Server; `src/core/guards.ts`);
   2. parses the options with the zod schemas built by `opt.*` (`src/core/options.ts`) — a bad value gets a private "That didn't work: `answers`: give at least 2 answers";
   3. takes the member's cooldown;
   4. calls `run(ctx, options)` with `ctx = { interaction, guild, bot, log }`.
3. `poll.ts` stores the poll (`src/data/polls.ts`), replies with an embed and buttons whose custom ids are `poll:vote:<id>:<i>` and `poll:close:<id>`, and schedules `poll:close` if it has a duration.
4. A click arrives as a `ButtonInteraction`. The router splits the custom id, finds `components.vote` in `poll.ts`, runs the same checks (components inherit the command's `memberPermissions` and `who` unless `public: true`) and calls it with the args `[pollId, choice]`.
5. If a handler throws a `UserError`, the user sees its message privately. Any other error is logged (`handler failed`, with the command, ids and stack) and the user gets a short apology. Handlers don't catch errors themselves.

## Scheduled work

`bot.scheduler.schedule('remind:fire', dueAt, { reminderId })` inserts a row into `jobs`. The loop (`src/core/scheduler.ts`) sleeps until the next job (at most a minute), runs due jobs one at a time, marks them done, and retries failures (1, 5, 30 minutes; failed after 4 tries). When the bot starts, the `ready` event starts the loop, so jobs that came due while it was offline run at once with `ctx.job.late = true`. The job's payload is checked by its zod schema both when scheduled and when run.

`bot.scheduler.repeat('remind:fire', { every: 'week', day: 1, at: '09:00' }, payload)` makes a repeating job: the same row, with its rule in `jobs.repeat`. The rule is read on the wall clock of the bot's time zone (`BOT.timezone` in `src/config.ts`, `bot.timezone`; helpers in `src/core/time.ts`), so 09:00 stays 09:00 local when the clocks change. After each run the row moves to the next occurrence (`ctx.job.next`). After downtime it runs once, late, and skips the occurrences it missed.

## Data

- `migrations/NNN_*.sql` run in order inside transactions; `schema_migrations` stores each one's checksum, and a changed shipped migration stops the bot with a clear message.
- `src/data/*.ts` hold the SQL as small typed functions that take the `Db`. Commands never write SQL inline.
- Per-server settings are one JSON document per server (`guild_settings`), shaped and defaulted by `GuildSettingsSchema` (`src/core/settings.ts`).

## The fake Discord (checks)

`tests/fake/discord.ts` is an in-memory Discord: servers, channels (with permission overwrites), roles, members and messages. It answers discord.js's REST calls through the client's `rest.makeRequest` option, enforcing the rules that matter (missing permissions, role hierarchy, bulk-delete limits, one response per interaction), and records every request with its JSON body. `tests/fake/harness.ts` starts the real bot (`createBot`) on it with an in-memory database and a `FakeClock`, feeds gateway packets (`READY`, `GUILD_CREATE`, `INTERACTION_CREATE`, `GUILD_MEMBER_ADD`) to the client, and offers helpers that act like members. The screenshot tool (`scripts/preview/`) uses the same harness and draws the recorded messages.

The harness feeds packets through discord.js internals (`client.ws.handlePacket`), pinned to the installed version. When you upgrade discord.js, run the checks: if the harness breaks, the fix is in `tests/fake/harness.ts`, not in the bot.

## What's not covered by the checks

The real gateway (connecting, intents, resumes), Discord's rate limits, command registration against the real API, and how the Discord client finally draws messages. Try those in a test server: `npm run register` then `npm run dev`.
