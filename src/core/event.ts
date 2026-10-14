// Gateway events (a member joined, the bot joined a server, ...). One file per
// event in src/events/, listed in src/events/index.ts. Interactions are not
// events here: the router handles them (src/core/router.ts).
//
// Some events need a gateway intent (src/bot.ts, INTENTS), and a few of those
// are "privileged" and must also be switched on in the Developer Portal
// (Bot → Privileged Gateway Intents): GuildMembers for member joins,
// MessageContent for reading message text. See docs/recipes/register-commands-and-invite.md.
import type { ClientEvents } from 'discord.js';
import type { Bot } from './command.ts';

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  run: (bot: Bot, ...args: ClientEvents[K]) => Promise<void>;
}

export function defineEvent<K extends keyof ClientEvents>(e: BotEvent<K>): BotEvent {
  return e as unknown as BotEvent;
}
