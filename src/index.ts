// Starts the bot: `npm start` (or `npm run dev`, which restarts on changes).
// Reads .env (see .env.example), opens the database, logs in to Discord.
import { createBot } from './bot.ts';
import { loadEnv } from './config.ts';
import { openDb } from './core/db.ts';
import { createLogger, prettySink, jsonSink } from './core/log.ts';

const env = loadEnv();
const log = createLogger({ level: env.LOG_LEVEL, sink: env.LOG_FORMAT === 'pretty' ? prettySink() : jsonSink() });

if (!env.DISCORD_TOKEN) {
  log.error('DISCORD_TOKEN is not set. Copy .env.example to .env and paste the bot token (docs/recipes/register-commands-and-invite.md).');
  process.exit(1);
}

const db = openDb(env.DATABASE_PATH);
const huddle = createBot({ db, log });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  await huddle.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));

try {
  await huddle.client.login(env.DISCORD_TOKEN);
} catch (err) {
  const msg = String((err as Error)?.message ?? err);
  if (/disallowed intents/i.test(msg)) {
    log.error('Discord refused the gateway intents. Switch on "Server Members Intent" in the Developer Portal (Bot → Privileged Gateway Intents), or remove GuildMembers from INTENTS in src/bot.ts.');
  } else if (/token/i.test(msg)) {
    log.error('Discord rejected the token. Reset it in the Developer Portal (Bot → Reset Token) and update DISCORD_TOKEN in .env.');
  } else {
    log.error('login failed', { err });
  }
  process.exit(1);
}
