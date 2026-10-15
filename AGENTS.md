# Discord Bot Starter: agent brief

You are building a Discord bot for the user, starting from this template. This brief tells you how the project works, what to ask before changing anything, the rules that keep it working, and how to check every change. Read it all once. Then follow **Interview** before your first edit.

## Start here

This folder is a complete, working Discord bot called **Huddle** (a placeholder name): a helper for a small community server. It's **TypeScript (strict) run directly by Node 24** (no build step: `node src/index.ts`), **discord.js 14**, **zod** for validation and **SQLite** through Node's built-in `node:sqlite` (a file in `.data/`, no server):

- **`/poll`**: a question with 2-5 answers as buttons, a live tally, one vote per member (change it or take it back), a close button for the author or moderators, and an optional timer that closes it, even across restarts.
- **`/remind me | every | list | cancel`**: "remind me in 2h / at 18:30 / tomorrow 9am to…" and "every Monday at 09:00". Stored jobs fire after restarts (late ones say so) and fall back to a DM if the channel is gone. Times of day are in the bot's time zone (`BOT.timezone`).
- **`/welcome setup | test | off`**: a private setup panel with a channel menu, a role menu, a form for the message (`{user}`, `{name}`, `{server}`, `{count}`), a test button and on/off. New members get the message and the auto-role.
- **`/tag show | list | add | delete`**: saved answers with autocomplete; adding opens a form. **`/quote add | random | delete`** and a right-click **"Save as quote"** message command.
- **`/purge`**: delete recent messages (optionally one member's), with permission checks for the member and the bot, skipping pinned and >14-day-old messages.
- **`/settings show | manager-role`**: the server owner picks the **manager role** in Discord; managers (plus the owner and Administrators; Manage Server until a role is picked) can use `/welcome` and close any poll.
- **`/help`** (built from the command definitions, filtered by what the member may run) and **`/about`**.
- **Under it:** a command registry (one file per command, options declared once with typed, zod-validated values), a router with permission, manager-role and cooldown checks, buttons/select menus/modals routed by custom id, an events folder, per-server settings, a scheduler with one-off and repeating jobs ("every Monday at 09:00" in the bot's time zone, safe across clock changes), numbered SQL migrations and JSON logging.

**The checks need no Discord account, no token and no network.** They run the real discord.js client and the real handlers against a **fake Discord** (`tests/fake/`) that records every request, so a test reads the exact JSON Discord would receive.

**Verify any change** with one command from this folder. It must end with `CODEPLATE CHECKS: PASS`:

```
npm run check
```

Node 24 or newer is required (it runs `.ts` files directly). Running the real bot needs a Discord application and token: `docs/recipes/register-commands-and-invite.md` walks the user through it.

**discord.js changes often, and some of your training data is from older versions.** The installed version's types are the truth: `node_modules/discord.js/typings/index.d.ts` (search for a class, e.g. `class ModalBuilder`) and the builders in `node_modules/@discordjs/builders/dist/index.d.ts`. Read them before using an API you're unsure of. **Common pitfalls** lists what changed.

## Interview

Before you change anything, read `docs/project.md`.

- **If it still contains `<!-- codeplate:project-stub -->`, interview the user first.** Ask only what you need, in one short message, and suggest defaults so they can just say "yes":
  1. **What the bot does.** What is the server about, and what should the bot help with? A name for the bot? Which of Huddle's features to keep (polls, reminders, welcome, tags, quotes, purge), and what's missing?
  2. **The server.** Roughly how many members? One server, or will it be added to several? (Over ~2,000 servers needs sharding: `sharding-and-scale.md`.)
  3. **Commands wanted.** A list in their words ("a /birthday command that wishes people happy birthday"). Suggest names and options.
  4. **Who can use which commands.** Everyone, the managers (a role the server owner picks in Discord with `/settings manager-role`, e.g. "Organizers"; Manage Server until then), or a permission (Manage Messages)? Anything that should be private (only the user sees the reply)?
  5. **Where it runs.** Their PC while testing; then a VPS (systemd), Docker, Railway or Fly.io? It must stay online to answer, and reminders need it running.
  6. **Discord setup.** Do they have an application and a test server yet? (If not, walk them through `register-commands-and-invite.md` when it's time to run it for real; never ask them to paste the token into the chat.)
  7. **Voice and look.** How should it talk (friendly, formal, playful; emoji or not)? Brand color? An avatar? (If they bring their own picture, put it in `assets/avatar.png`; `npm run avatar` won't overwrite it.)
  8. **Time zone.** Where do most members live, for "every Monday at 9:00" and times the bot writes out? Suggest their zone as an IANA name (e.g. `Europe/London`, `America/New_York`); the default is `UTC`. It goes in `BOT.timezone` (`src/config.ts`).

  Then replace the stub in `docs/project.md` with their answers as short decisions, and remove the marker.
- **Otherwise, the project has started.** `docs/project.md` holds the decisions made so far. Follow them, and add new decisions as the user makes them. This file is how the next session knows what was agreed.

Work in small steps. Make one change, verify it with the full `npm run check` (**Verify**), look at the result (**Seeing your work**), then continue. Usual first steps: rename and retheme the bot and set its time zone (`src/config.ts`, `npm run avatar`), remove the features they don't want (delete the command file, its line in `src/commands/index.ts`, its tests and its scenarios), then `add-a-command.md` for each new command.

`README.md` and `codeplate.json` describe the template. Once the user has named their bot, rewrite `README.md` for it (what it does, how to run it), and leave `codeplate.json` and `LICENSE.md` in place. `LICENSE.md` (the CodePlate Free License) asks for the credit "Built with CodePlate (codeplate.io)" where the bot describes itself: it's already in `/about` and in the footer of `/help` (from `BOT.credit` in `src/config.ts`). **Keep the credit**; `tests/commands/credit.test.ts` checks it. If the user removes `/help` or `/about`, put the credit in another place the bot describes itself and move the test with it.

## Architecture

A command is one file that owns its feature: options, handler, buttons, forms, autocomplete and scheduled jobs. The router (`src/core/router.ts`) does the checks and the error handling, so handlers stay short. See `docs/architecture.md` for how an interaction flows through the code.

| Path | What lives there |
|---|---|
| `src/config.ts` | **The bot's identity** (`BOT`: name, tagline, version, colors, the credit, the **time zone**) and the environment variables (`EnvSchema`, documented in `.env.example`). |
| `src/commands/` | One file per command: `poll.ts`, `remind.ts`, `welcome.ts`, `tag.ts`, `quote.ts`, `save-quote.ts` (a message menu command), `purge.ts`, `settings.ts` (the manager role), `help.ts`, `about.ts`. **`index.ts` lists them** (and sets /help's order). |
| `src/events/` | Gateway events: `ready.ts` (starts the scheduler), `guild-member-add.ts` (welcome), `guild-create.ts`. `index.ts` lists them. |
| `src/data/` | The SQL for each feature, as small typed functions (`polls.ts`, `reminders.ts`, `tags.ts`, `quotes.ts`). |
| `src/core/` | The framework: `command.ts` (what a command file exports: `defineCommand`, `subcommand`, `job`, `defineMessageMenu`, `UserError`, `customId`), **`options.ts`** (the `opt.*` option builders), `router.ts`, `guards.ts` (permissions, the manager role: `who`, `isManager`; cooldowns), `definitions.ts` (the JSON for Discord, and Discord's rules), `scheduler.ts` (one-off and repeating jobs), **`time.ts`** (wall-clock times in a time zone: typed times, "next Monday 09:00", clock changes), `settings.ts` (per-server settings), `db.ts` (SQLite, migrations), `log.ts`, `clock.ts`, `text.ts` (durations, Discord timestamps, placeholders), `ui.ts` (embed colors, private replies), `deploy.ts` (registering commands, the invite link), `event.ts`. |
| `src/bot.ts` | Wires it together (`createBot`); **`INTENTS`** and the client options. `src/index.ts` starts it with the real token. |
| `migrations/` | Numbered SQL files, applied in order once each (`001_core.sql` … `005_repeating_jobs.sql`). |
| `tests/fake/` | **The fake Discord** (`discord.ts`: an in-memory Discord HTTP API plus gateway packets) and the test bot (`harness.ts`: a sample server "Maple Makers" with members `owner`, `mod`, `alice`, `bob`, and helpers `slash`, `click`, `select`, `submitModal`, `autocomplete`, `messageMenu`, `join`, `createRole`, `setRoles`, `deleteRole`, `advance`; `startTestBot({ timezone })` picks the zone). |
| `tests/commands/`, `tests/core/` | `node --test` tests: each command end-to-end, the router, definitions, migrations, the scheduler, settings, helpers. |
| `scripts/` | `register.ts` (send commands to Discord), `invite.ts` (the invite link), `shots.ts` + `preview/` (screenshots of replies), `make-avatar.ts` (draws `assets/avatar.png`; refuses to overwrite a picture it didn't draw unless `--force`). |
| `assets/avatar.png` | The bot's avatar (listed in `assets.json`). |

## Rules

1. **One command, one file.** A command's options, handler, components, modals, autocomplete and jobs live in its file in `src/commands/`, exported with `defineCommand` (or `defineMessageMenu`/`defineUserMenu`), and listed in `src/commands/index.ts`. The checks fail if a file isn't listed.
2. **Declare options with `opt.*`, never by hand.** `opt.string('…').max(100)`, `.optional()`, `.choices(…)`, `.autocomplete()`, `.zod(s => …)` make both Discord's JSON and the zod validation; the handler receives typed values. Required options come first. Descriptions are 1-100 characters (Discord's limit; the checks enforce it).
3. **Who may do what is declared, not hand-coded.** Put `memberPermissions`, `who: 'manager' | 'owner'`, `botPermissions` and `cooldown` on the command, subcommand, component or modal; the router checks them before your handler runs (`src/core/guards.ts`), and `/help` hides what a member can't run. Use `who: 'manager'` for setup and admin commands: the server owner picks the manager role in Discord (`/settings manager-role`), Manage Server counts until then, and the owner and Administrators always count. Components and modals inherit the command's `memberPermissions` and `who` unless marked `public: true`. Only write a check by hand when it depends on data ("only the poll's author or a manager": `isManager()`), and throw a `UserError` when it fails.
4. **Expected problems are `UserError`s.** Throw `new UserError('There is no tag called x.')` and the router shows it privately. Don't catch-and-reply for errors: unexpected ones are logged with context and the user sees a short apology. Never show a stack trace or internal detail to users.
5. **Custom ids are `<command>:<handler>:<args…>`.** Build them with `customId('poll', 'vote', pollId, i)` (max 100 characters, no `:` in args); the router sends a click to `components[handler]` (or `modals[handler]`) in that command's file. Keep only ids and numbers in args; look everything else up in the database, so buttons keep working after a restart.
6. **Anything "later" is a scheduler job.** Never use `setTimeout` for work that must survive a restart. Declare `jobs: { name: job({ payload: z.object(…), run }) }` and call `bot.scheduler.schedule('<command>:<name>', when, payload)`, or `bot.scheduler.repeat('<command>:<name>', { every: 'week', day: 1, at: '09:00' }, payload)` for "every Monday at 9:00". Time comes from `bot.clock`, never `Date.now()` in features (tests move a fake clock). Times of day are in the bot's time zone: use `src/core/time.ts` with `bot.timezone`, never `new Date().getHours()` or hand-made UTC offsets.
7. **Every database change is a new migration.** Add `migrations/NNN_name.sql` (next number); never edit one that has run anywhere (the bot refuses to start if a shipped migration changed). SQL lives in `src/data/<feature>.ts` functions. Discord ids are `TEXT`; times are Unix milliseconds `INTEGER`.
8. **Per-server options are settings, not tables.** Add a field with a default to `GuildSettingsSchema` in `src/core/settings.ts`; read `bot.settings.get(guildId)`, write `bot.settings.update(guildId, {...})`. No migration needed.
9. **Pings are opt-in.** The client sends `allowedMentions: { parse: [] }`; a message that should ping someone sets `allowedMentions: { users: [id] }` explicitly. Never ping `@everyone` or roles unless the user asked for that feature.
10. **No secrets in code or chat.** The token lives only in `.env` (git-ignored); every variable is in `EnvSchema` (`src/config.ts`) and documented in `.env.example` (the checks fail otherwise). Never print, log or commit a token; never ask the user to paste it into the conversation; tell them which line to put in `.env`. If a token leaks, tell them to reset it in the Developer Portal.
11. **The checks never touch real Discord.** Tests use the fake Discord. If a feature calls a Discord endpoint the fake doesn't know, the test fails with "The fake Discord has no route for …": add that route to `tests/fake/discord.ts`, answering like Discord's API docs say. Never make a test need a token or the network.
12. **Keep the licensing clean.** Use only code you write here and npm packages with permissive licenses (MIT, Apache-2.0, BSD, ISC). Pin new dependencies exactly (`npm install --save-exact`). Don't paste code from tutorials or other bots. Keep the credit "Built with CodePlate (codeplate.io)" (see **Interview**).
13. **Never weaken a check to make it pass.** If a check fails, fix the cause. If the user deliberately changed something a test covers (say, polls now allow 10 answers), update that test to the new rule and say so.
14. **Add tests and a scenario for new behavior.** A new command gets a test file in `tests/commands/` (copy `tag.test.ts`) that runs it through the test bot, and a scenario in `scripts/preview/scenarios.ts` so its replies can be looked at.

## Verify

After every change:

1. **Run the full `npm run check`, every time.** The last line must be `CODEPLATE CHECKS: PASS`. It runs these steps (about 10 seconds) and lists each one's result and time:
   - `env`: every environment variable read is documented in `.env.example`, and nothing documented is unused
   - `migrations`: `migrations/` is numbered without gaps and applies to an empty database
   - `commands`: every command follows Discord's rules (names, descriptions ≤ 100 characters, ≤ 25 options and choices, required before optional, autocomplete handlers, 4,000-character total) and is listed in `index.ts`; the JSON Discord would get is written to `.data/commands.json`
   - `typecheck`: `tsc` (strict)
   - `lint`: ESLint, including floating promises (a reply without `await`)
   - `test`: every command end-to-end on the fake Discord with a fake clock (polls, reminders across restarts, welcome on join, permissions, cooldowns, the credit)
   - `preview`: every screenshot scenario renders

   While you work, a quicker loop is fine: `npm test`, `node --test tests/commands/poll.test.ts`, `npm run typecheck`, or `node checks/run.mjs --skip=lint,preview`. Then the full `npm run check` before you report the change, every change. When a step fails, the end of its output is repeated above the summary.
2. **Look at it.** For anything a user sees, take screenshots (**Seeing your work**) and open the PNGs. Check the wording, that nothing is cut off, and that buttons and menus make sense.
3. **If commands' names, options or descriptions changed, the user must run `npm run register`** before Discord shows the change. Say so in your report. Handler-only changes need just a restart of the bot.
4. **Tell the user** what changed and show the screenshots. Say what the checks can't see: real Discord (registration, the gateway, rate limits, how the client really draws an embed), which needs a run in their test server (`npm run dev` with their token).

## Recipes

Step-by-step guides for common requests. Follow the matching recipe when one fits; each ends with its own verification.

- `docs/recipes/add-a-command.md`: a new slash command with options, permissions, a test and a scenario.
- `docs/recipes/buttons-and-modals.md`: buttons, select menus and forms (modals), routed by custom id.
- `docs/recipes/scheduled-jobs.md`: "later" and "every Monday at 9:00" work that survives restarts, in the server's time zone.
- `docs/recipes/per-server-settings.md`: a setting each server can change, with a setup command.
- `docs/recipes/permissions-and-roles.md`: who can use what; the manager role, permissions, giving roles, role hierarchy.
- `docs/recipes/add-a-database-table.md`: a migration, typed data functions and tests.
- `docs/recipes/ai-replies.md`: an `/ask` command (or replies when mentioned) with an AI model, a provider key and limits.
- `docs/recipes/register-commands-and-invite.md`: the Developer Portal, the token, intents, registering commands and the invite link.
- `docs/recipes/deploy.md`: keep it running: a VPS with systemd, Docker, Railway or Fly.io; backups.
- `docs/recipes/sharding-and-scale.md`: many servers: sharding, rate limits, caching, moving off SQLite.

`docs/customization-map.md` answers "I want to change X — which file?" for everything else.

## Seeing your work

You can't open Discord, but you can look at the bot's replies. `npm run shots` runs scenarios through the real handlers on the fake Discord and draws what the bot sent (embeds, buttons, select menus, forms, autocomplete) in a Discord-like dark theme:

```
npm run shots                          every scenario → shots/<name>.png
npm run shots -- poll welcome-setup    only these
npm run shots -- --list                the scenario names
npm run shots -- --width=420           a narrow, phone-like column
```

- **Open the PNGs and look.** Check the words, the order, the colors, that buttons fit and long text wraps.
- Scenarios live in `scripts/preview/scenarios.ts`: each drives the test bot like a test does and returns what to draw. Add one for every new command or reply.
- It finds a browser by itself (Playwright's Chromium after `npm run setup`, else an installed Chrome or Edge, else it downloads Chromium once); `PW_CHANNEL=msedge` (or `chrome`) picks one. The checks never need a browser.
- It's an approximation: the real Discord client wraps text and sizes things slightly differently. Confirm important layouts in the user's test server.
- `npm run register -- --dry-run` prints the command JSON Discord would receive (also written to `.data/commands.json` by the checks).

## Common pitfalls

- **Old discord.js habits.** Ephemeral replies use `flags: MessageFlags.Ephemeral` (the `ephemeral: true` option is deprecated); to get the reply message use `reply({ ..., withResponse: true })` and read `response.resource?.message` (`fetchReply` is deprecated); the ready event is `Events.ClientReady` (`'clientReady'`), not `'ready'`. Modals take `LabelBuilder`s (`addLabelComponents`, with `setTextInputComponent`); `TextInputBuilder.setLabel` and action rows in modals are deprecated. Check `node_modules/discord.js/typings/index.d.ts`.
- **The 3-second rule.** Discord waits 3 seconds for the first response to an interaction. Anything slower (an API call, a big query, AI) must `await interaction.deferReply()` first, then `editReply(...)` (see `purge.ts`). A component can `deferUpdate()`.
- **One response per interaction.** After `reply`, `update`, `showModal` or `deferReply`, further messages are `followUp` or `editReply`. A second `reply` fails with "Interaction has already been acknowledged". `showModal` must be the first response (you can't defer, then show a form).
- **Commands don't appear or are outdated in Discord.** Run `npm run register` after changing names, options or descriptions. With `DEV_GUILD_ID` set they update instantly in that server; global ones can take a minute (Ctrl+R in Discord reloads).
- **"Used disallowed intents" at login.** `GuildMembers` (welcome) is privileged: switch on "Server Members Intent" in the Developer Portal → Bot. Add intents to `INTENTS` in `src/bot.ts` only when a feature needs them; message text needs the privileged `MessageContent` intent (message commands like "Save as quote" don't).
- **"Missing Permissions" (50013).** The bot lacks a permission in that channel, or (when giving a role) its own role is below the role it's giving. Declare `botPermissions` so users get a clear message, and include new permissions in the invite (`npm run invite` computes them from `botPermissions` and `BASE_PERMISSIONS` in `src/core/deploy.ts`).
- **Ids are strings.** Discord ids don't fit in a JavaScript number. Store them as `TEXT`; never `Number(id)`.
- **`.ts` imports.** Node runs the TypeScript directly, so imports end in `.ts` (`import { x } from './x.ts'`), type-only imports use `import type`, and TypeScript-only syntax that needs compiling (enums, namespaces, constructor parameter properties) isn't allowed (`erasableSyntaxOnly`).
- **Time zones by hand.** `new Date(...).getHours()` is the host's zone (UTC on most servers), and "+1 hour for summer" breaks twice a year. Use `src/core/time.ts` (`parseWhen`, `fromLocal`, `nextOccurrence`, `formatDateTime`) with `bot.timezone`; in message text prefer `<t:…>` (`discordTime()`), which each reader sees in their own zone.
- **`npm run avatar` and the user's own picture.** The script only redraws the avatar it made (it marks the PNG). If `assets/avatar.png` is the user's picture, it stops and says so; pass `--force` only when the user wants the generated one back.
- **Cooldowns are per member and in memory.** They reset on restart. Use the database for limits that must persist (e.g. "3 polls a day").
- **The fake Discord answers like the API docs, not like every edge of real Discord.** If real behavior differs (an error code, a field), fix `tests/fake/discord.ts` and add a test.
- **Windows paths in Git Bash:** quote globs (`node --test "tests/**/*.test.ts"`), as the npm scripts do.
