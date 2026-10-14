// Builds the bot: the discord.js client, the database, the scheduler, the
// router and the event handlers, wired together. src/index.ts calls it with
// the real token; the tests call it with a fake Discord (tests/fake/).
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { ClientOptions } from 'discord.js';
import { commands as allCommands } from './commands/index.ts';
import { BOT } from './config.ts';
import type { AnyCommand, Bot, Job } from './core/command.ts';
import type { Clock } from './core/clock.ts';
import { systemClock } from './core/clock.ts';
import type { Db } from './core/db.ts';
import type { Logger } from './core/log.ts';
import { createRouter } from './core/router.ts';
import type { Router } from './core/router.ts';
import { createScheduler } from './core/scheduler.ts';
import { createSettings } from './core/settings.ts';
import { isTimeZone } from './core/time.ts';
import { events } from './events/index.ts';

// The gateway events the bot receives. Guilds is needed for everything;
// GuildMembers (privileged: switch it on in the Developer Portal) for the
// welcome message and auto-role. Add only what a feature needs.
export const INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];

export interface Huddle {
  bot: Bot;
  client: Client;
  router: Router;
  // Resolves when every interaction, event and job in progress has finished.
  idle(): Promise<void>;
  stop(): Promise<void>;
}

export function createBot(opts: {
  db: Db;
  log: Logger;
  clock?: Clock;
  clientOptions?: Partial<ClientOptions>;
  commands?: readonly AnyCommand[];
  timezone?: string; // default BOT.timezone
}): Huddle {
  const commands = opts.commands ?? allCommands;
  const clock = opts.clock ?? systemClock;
  const log = opts.log;
  const timezone = opts.timezone ?? BOT.timezone;
  if (!isTimeZone(timezone)) throw new Error(`BOT.timezone "${timezone}" is not a time zone Node knows. Use an IANA name such as "UTC" or "Europe/London" (src/config.ts).`);
  const client = new Client({
    intents: INTENTS,
    partials: [Partials.GuildMember],
    // Nobody gets pinged unless a message says so explicitly.
    allowedMentions: { parse: [] },
    // The status line under the bot's name in the member list.
    presence: { activities: [{ name: 'Type /help', type: ActivityType.Custom }] },
    ...opts.clientOptions,
  });

  const jobs = new Map<string, Job>();
  for (const c of commands) {
    if (c.kind !== 'slash') continue;
    for (const [name, job] of Object.entries(c.jobs ?? {})) jobs.set(`${c.name}:${name}`, job);
  }

  const bot: Bot = {
    client,
    db: opts.db,
    clock,
    log,
    commands,
    startedAt: clock.now(),
    timezone,
    settings: createSettings({ db: opts.db, clock, log }),
    scheduler: createScheduler({ db: opts.db, clock, log, jobs, bot: () => bot, timezone }),
  };

  const router = createRouter(bot);
  client.on(Events.InteractionCreate, (i) => void router.handle(i));

  const inFlight = new Set<Promise<void>>();
  for (const e of events) {
    const listener = (...args: unknown[]) => {
      const p = (e.run as (b: Bot, ...a: unknown[]) => Promise<void>)(bot, ...args)
        .catch((err: unknown) => log.error('event handler failed', { event: e.name, err }))
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    };
    if (e.once) client.once(e.name, listener);
    else client.on(e.name, listener);
  }
  client.on(Events.Error, (err) => log.error('client error', { err }));
  client.on(Events.Warn, (msg) => log.warn('client warning', { msg }));

  return {
    bot,
    client,
    router,
    async idle() {
      for (let i = 0; i < 20; i++) {
        await router.idle();
        await Promise.all([...inFlight]);
        await bot.scheduler.idle();
        await new Promise((r) => setImmediate(r));
        if (!inFlight.size) return;
      }
    },
    async stop() {
      bot.scheduler.stop();
      await router.idle();
      await client.destroy();
    },
  };
}
