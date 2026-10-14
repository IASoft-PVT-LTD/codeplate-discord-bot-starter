# Customization map

"I want to change X" → the file to touch. After any change: `npm run check`; after changing command names, options or descriptions: `npm run register`.

| I want to… | Touch |
|---|---|
| Rename the bot, change its tagline or version | `src/config.ts` (`BOT`), then `README.md`. The name users see in Discord is set in the Developer Portal (Bot → Username). |
| Change embed colors | `src/config.ts` (`BOT.colors`) |
| Change the avatar | `scripts/make-avatar.ts` then `npm run avatar` (it redraws only its own avatar; a picture the user supplied is kept unless `npm run avatar -- --force`), or replace `assets/avatar.png` (512×512) and update `assets.json`; upload it in the Developer Portal |
| Set the time zone ("every Monday at 9:00", typed times, plain-text times) | `BOT.timezone` in `src/config.ts` (IANA name, default `UTC`); helpers in `src/core/time.ts` |
| Change the status line ("Type /help") | `src/bot.ts` (`presence`) |
| Add a command | `src/commands/<name>.ts` + `src/commands/index.ts` + a test + a scenario — `docs/recipes/add-a-command.md` |
| Remove a command | delete its file, its line in `src/commands/index.ts`, its test in `tests/commands/` and its scenarios in `scripts/preview/scenarios.ts`; keep its migration (add a new one that drops tables if wanted); `npm run register` |
| Change a command's wording | the strings in its file in `src/commands/` |
| Change who can use a command | `memberPermissions`, or `who: 'manager'` / `'owner'`, on the command/subcommand/component — `docs/recipes/permissions-and-roles.md` |
| Change who counts as a manager | the server owner runs `/settings manager-role` in Discord; the rule is `isManager()` in `src/core/guards.ts`, the wording in `src/commands/settings.ts` |
| Change a cooldown | `cooldown` (seconds) on the command or subcommand |
| Change option limits (answers per poll, reminder range, tag length) | the `*_LIMITS` constant at the top of the command file, and its test |
| Add buttons, menus or a form | `components` / `modals` in the command file — `docs/recipes/buttons-and-modals.md` |
| Do something later, or every day/week at a time | `jobs` in the command file, `bot.scheduler.schedule` / `.repeat` — `docs/recipes/scheduled-jobs.md` |
| Add a per-server option | `src/core/settings.ts` (`GuildSettingsSchema`) — `docs/recipes/per-server-settings.md` |
| Store new kinds of data | `migrations/NNN_*.sql` + `src/data/<feature>.ts` — `docs/recipes/add-a-database-table.md` |
| React to members joining, leaving, messages… | `src/events/<event>.ts` + `src/events/index.ts`, and `INTENTS` in `src/bot.ts` |
| Change the welcome message default | `src/core/settings.ts` (`welcome.message` default); servers change their own with `/welcome setup` |
| Change how errors look | `src/core/ui.ts` (`errorReply`, `okReply`) and the apology text in `src/core/router.ts` |
| Change what /help shows | `help` lines on commands, `src/commands/help.ts` |
| Add an environment variable | `EnvSchema` in `src/config.ts` + `.env.example` |
| Change logging | `LOG_LEVEL` / `LOG_FORMAT` in `.env`; `src/core/log.ts` |
| Change the invite permissions | `botPermissions` on commands, `BASE_PERMISSIONS` in `src/core/deploy.ts`; `npm run invite` |
| Add AI answers | `docs/recipes/ai-replies.md` |
| Run it 24/7 | `docs/recipes/deploy.md` |
| Test against a new Discord endpoint | `tests/fake/discord.ts` (`route()`) |
| Add a screenshot | `scripts/preview/scenarios.ts` |
