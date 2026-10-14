// /purge: delete the last N messages in this channel (optionally only one
// member's). Needs Manage Messages for both the member and the bot. Discord
// only bulk-deletes messages younger than 14 days; older ones are skipped and
// counted. Pinned messages are kept.
import { MessageFlags } from 'discord.js';
import type { Message } from 'discord.js';
import { UserError, defineCommand } from '../core/command.ts';
import { opt } from '../core/options.ts';

export const BULK_DELETE_MAX_AGE_MS = 14 * 86_400_000;

export default defineCommand({
  name: 'purge',
  description: 'Delete recent messages in this channel (moderators)',
  help: 'Skips pinned messages and anything older than 14 days.',
  memberPermissions: ['ManageMessages'],
  botPermissions: ['ManageMessages', 'ReadMessageHistory', 'ViewChannel'],
  cooldown: 5,
  options: {
    count: opt.integer('How many recent messages to look through (1-100)').min(1).max(100),
    from: opt.user('Only delete messages from this member').optional(),
  },
  async run({ interaction, bot, log }, { count, from }) {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) throw new UserError('Use this in a server text channel.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const recent = await channel.messages.fetch({ limit: count });
    const now = bot.clock.now();
    let tooOld = 0;
    const doomed: Message[] = [];
    for (const m of recent.values()) {
      if (m.pinned) continue;
      if (from && m.author.id !== from.id) continue;
      if (now - m.createdTimestamp >= BULK_DELETE_MAX_AGE_MS - 60_000) {
        tooOld++;
        continue;
      }
      doomed.push(m);
    }
    if (!doomed.length) {
      await interaction.editReply(tooOld ? `Nothing to delete: ${tooOld} matching message(s) are older than 14 days, which Discord doesn't allow bots to bulk-delete.` : 'Nothing to delete.');
      return;
    }
    const deleted = await channel.bulkDelete(doomed, true);
    log.info('purged messages', { channelId: channel.id, deleted: deleted.size, from: from?.id });
    const skipped = tooOld ? ` Skipped ${tooOld} older than 14 days.` : '';
    await interaction.editReply(`🧹 Deleted ${deleted.size} message${deleted.size === 1 ? '' : 's'}${from ? ` from <@${from.id}>` : ''}.${skipped}`);
  },
});
