# Register commands and invite the bot

Use this the first time the user runs the bot in Discord, and whenever commands change. The user does the Developer Portal steps (you can't); guide them one step at a time, and never ask them to paste the token into the chat.

## Steps

1. **Create the application.** The user opens https://discord.com/developers/applications, clicks **New Application**, names it (the bot's name), and accepts the terms. On **General Information** they copy the **Application ID**.

2. **Make the bot user and get the token.** In **Bot**: set the username and upload `assets/avatar.png` as the icon. Click **Reset Token** and copy it (it's shown once). Turn **Public Bot** off if only they should be able to add it.

3. **Switch on the privileged intent the bot uses.** Still in **Bot → Privileged Gateway Intents**: **Server Members Intent** on (for `/welcome`'s join message and auto-role). Leave **Message Content** off unless a feature reads message text (`INTENTS` in `src/bot.ts` lists what the code asks for; they must match or login fails with "Used disallowed intents"). Bots in 100+ servers need Discord's approval for privileged intents.

4. **Fill in `.env`.** The user copies `.env.example` to `.env` and fills in `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` themselves. For a test server, they turn on Developer Mode (Discord → User Settings → Advanced), right-click the server → **Copy Server ID**, and set `DEV_GUILD_ID`. `.env` is git-ignored: keep it that way.

5. **Register the commands:** `npm run register`. With `DEV_GUILD_ID` they appear in that server at once; `npm run register -- --global` registers them everywhere (it can take a minute; Ctrl+R reloads Discord). Run it again after changing any command name, option or description. `--dry-run` prints the JSON without sending; `--clear` removes them (e.g. guild copies after going global, to avoid duplicates).

6. **Invite the bot:** `npm run invite` prints a link with `bot` and `applications.commands` scopes and exactly the permissions the commands need. The user opens it, picks the server (they need Manage Server there) and keeps every permission ticked. Never ask for Administrator.

7. **Run it:** `npm run dev` (restarts on file changes; `LOG_FORMAT=pretty` in `.env` for readable logs). The log shows `ready` with the bot's name. In Discord, type `/` and the bot's commands appear; try `/help`.

8. **Role order.** For the welcome auto-role (or any role the bot gives), the user drags the bot's role above those roles in Server Settings → Roles. `/welcome setup` warns if it isn't.

## Verify

1. `npm run check` still ends with `CODEPLATE CHECKS: PASS` (nothing here changes code, but `.env` must not be committed: `git status` doesn't list it).
2. `npm run register` printed "Registered N command(s)" and `/help` works in the test server.
3. The user tried one command of each kind they care about (a poll vote, a reminder, `/welcome test`) and the log shows no `error` lines. Record in `docs/project.md` that the app exists and the test server id (never the token).
