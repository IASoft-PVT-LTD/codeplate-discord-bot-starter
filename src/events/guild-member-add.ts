// A member joined: post the welcome message and give the auto-role, if the
// server set them up with /welcome setup. Needs the GuildMembers intent
// (privileged: switch on "Server Members Intent" in the Developer Portal).
import { Events } from 'discord.js';
import { sendWelcome } from '../commands/welcome.ts';
import { defineEvent } from '../core/event.ts';

export default defineEvent({
  name: Events.GuildMemberAdd,
  async run(bot, member) {
    if (member.user.bot) return;
    const result = await sendWelcome(bot, member);
    bot.log.info('member joined', { guildId: member.guild.id, userId: member.id, welcome: result });
  },
});
