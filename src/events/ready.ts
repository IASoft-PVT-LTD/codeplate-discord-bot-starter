// The bot is connected: start the scheduler, which first runs any jobs that
// came due while it was offline. (The status line under the bot's name is set
// in src/bot.ts, `presence`.)
import { Events } from 'discord.js';
import { defineEvent } from '../core/event.ts';

export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async run(bot, client) {
    bot.log.info('ready', { user: client.user.tag, guilds: client.guilds.cache.size });
    bot.scheduler.start();
  },
});
