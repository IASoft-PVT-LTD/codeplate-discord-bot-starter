# Sharding and scale

Use this when the bot will be in many servers (hundreds or more) or very busy ones. A bot in a handful of servers, even large ones, needs none of this: don't add it early.

## What changes with size

- **Sharding:** Discord requires it at 2,500 servers (one gateway connection, a "shard", per ~1,000-2,500 servers), and it helps before that. Plan for it around 1,500 servers.
- **Privileged intents:** a bot in 100+ servers must be verified by Discord, and privileged intents (Server Members, Message Content) need approval with a reason. Keep `INTENTS` minimal.
- **Rate limits:** discord.js queues requests per route and handles 429s. Avoid bursts you cause yourself: don't message every server at once (spread jobs over time), don't edit a message on every click in very busy polls (update at most every few seconds).
- **Memory:** discord.js caches guilds, channels, roles and members. With many servers, limit caches (`makeCache` and `sweepers` in the `Client` options in `src/bot.ts`), and don't cache members you don't need.
- **Database:** SQLite handles thousands of writes per second from one process. With shards in **separate processes**, they'd share one file: fine for light writes (WAL mode is on), but move to Postgres when several processes write a lot.

## Steps

1. **Measure first.** Log the server count at `ready` (already done) and watch memory (`process.memoryUsage().rss`) and event-loop delay. Note them in `docs/project.md`.

2. **Shards in one process** (simplest, up to a few thousand servers): add `shards: 'auto'` to the `Client` options in `src/bot.ts`. discord.js opens the recommended number of shards in the same process; nothing else changes (one database, one scheduler).

3. **Shards in several processes** (`ShardingManager`): create `src/shard.ts` that starts `new ShardingManager('src/index.ts', { token, totalShards: 'auto', execArgv: [] })` and spawns them; each child runs the bot for its shards. Then:
   - **Only one process may run the scheduler**, or jobs would run twice: start it only on shard 0 (`client.shard?.ids.includes(0)`), and make job handlers fetch channels through REST (`client.channels.fetch`) since the channel may belong to another shard.
   - Cross-shard numbers (/about's server count) need `client.shard.fetchClientValues('guilds.cache.size')`.
   - Consider Postgres (next step) because several processes write.

4. **Move to Postgres** (only if needed): replace `src/core/db.ts` with a Postgres client (e.g. `postgres` or `pg`, pinned), translate the migrations (`INTEGER PRIMARY KEY AUTOINCREMENT` → `bigint generated always as identity`, `ON CONFLICT` works the same), and make the `src/data/` functions async. Keep an in-memory SQLite or a test Postgres for the checks. This is a large change: do it as its own project step.

5. **Cache limits** example in `src/bot.ts`:

   ```ts
   makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 50, GuildMemberManager: { maxSize: 200, keepOverLimit: (m) => m.id === m.client.user.id } }),
   sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 3600, lifetime: 1800 } },
   ```

   The welcome panel reads `guild.members.me` (always kept above) and roles/channels (not limited here).

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS` (tests run without shards; keep it that way).
2. With several processes, a test or a manual run shows a scheduled job runs once, not once per shard.
3. In production, the logs show every shard reaching `ready`, and memory stays flat over a day. Record the shard setup in `docs/project.md`.
