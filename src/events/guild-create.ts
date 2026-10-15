// The bot was added to a server (not fired for servers it was already in at startup).
import { Events } from 'discord.js';
import { defineEvent } from '../core/event.ts';

export default defineEvent({
  name: Events.GuildCreate,
  async run(bot, guild) {
    bot.log.info('joined a server', { guildId: guild.id, members: guild.memberCount });
  },
});
