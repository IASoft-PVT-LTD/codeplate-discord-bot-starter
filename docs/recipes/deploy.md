# Deploy: keep the bot running

Use this when the bot should stay online without the user's PC: a small VPS with systemd, Docker, or a platform like Railway or Fly.io. A bot needs one always-on process (no web server, no open ports) and a disk for `.data/bot.db`. Reminders and timed polls only fire while it runs (late ones fire at the next start).

## Before any host

1. `npm run check` passes; commands are registered globally (`npm run register -- --global`; then `npm run register -- --clear` with `DEV_GUILD_ID` set removes the test server's duplicates).
2. Decide where the database lives (`DATABASE_PATH`): it must be on persistent storage, and backed up.
3. Set `LOG_FORMAT=json` (default) in production; logs go to stdout for the host to collect.
4. Only one copy of the bot may run per token: two would answer every command twice.

## Option A: a VPS with systemd (Ubuntu/Debian)

1. On the server: install Node 24 (from nodesource or `nvm`), create a user: `sudo useradd -m -s /bin/bash bot`.
2. Copy the project (git clone or `rsync`, without `node_modules/` and `.data/`) to `/home/bot/app`, then as `bot`: `npm ci --omit=dev`.

   `--omit=dev` skips TypeScript, ESLint and Playwright; the bot runs `.ts` files with Node itself.
3. Create `/home/bot/app/.env` with the real values, readable only by the bot: `chmod 600 .env`.
4. Create `/etc/systemd/system/discord-bot.service`:

   ```ini
   [Unit]
   Description=Discord bot
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=bot
   WorkingDirectory=/home/bot/app
   ExecStart=/usr/bin/node --env-file=.env src/index.ts
   Restart=always
   RestartSec=5
   # Stops cleanly: the bot handles SIGTERM.
   KillSignal=SIGTERM

   [Install]
   WantedBy=multi-user.target
   ```

5. `sudo systemctl daemon-reload && sudo systemctl enable --now discord-bot`, then `journalctl -u discord-bot -f` shows the logs.
6. Updates: copy the new code, `npm ci --omit=dev`, `sudo systemctl restart discord-bot`; re-register commands if they changed.
7. Backups: a daily cron job with SQLite's online backup, e.g. `sqlite3 /home/bot/app/.data/bot.db ".backup '/home/bot/backups/bot-$(date +\%F).db'"` (install `sqlite3`), keeping a week of copies off the server too.

## Option B: Docker

Add a `Dockerfile` in the project root:

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
ENV DATABASE_PATH=/data/bot.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
CMD ["node", "src/index.ts"]
```

and a `.dockerignore` with `node_modules`, `.data`, `shots`, `.env`. Build and run with the database on a volume and the variables from `.env`:

```
docker build -t discord-bot .
docker run -d --name discord-bot --restart unless-stopped --env-file .env -v discord-bot-data:/data discord-bot
```

(The image creates `/data` owned by the `node` user, so a new named volume is writable. With a bind mount, `chown 1000` the host folder.)

## Option C: Railway or Fly.io

- **Railway:** a new project from the GitHub repo; it detects Node. Set the start command to `node src/index.ts`, add the variables (`DISCORD_TOKEN`, …) in the service's Variables, add a **Volume** mounted at `/data` and set `DATABASE_PATH=/data/bot.db`. No public domain is needed.
- **Fly.io:** `fly launch --no-deploy` (with the Dockerfile above), `fly volumes create bot_data --size 1`, mount it at `/data` in `fly.toml` (`[mounts] source = "bot_data", destination = "/data"`), `fly secrets set DISCORD_TOKEN=...` (the user types it), remove any `[http_service]` section (a bot listens on no port), keep exactly one machine (`fly scale count 1`), then `fly deploy`.

Free tiers change often and some sleep idle apps (a sleeping bot is offline): check the current terms with the user.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS` before deploying.
2. On the host, the logs show `ready` and no `error` lines after a minute; `/help` answers in Discord.
3. Restart the service (or container) and confirm a reminder set before the restart still fires, and the database file is on persistent storage (it survives a redeploy).
4. Record the host, how to restart it, and where backups go in `docs/project.md`.
