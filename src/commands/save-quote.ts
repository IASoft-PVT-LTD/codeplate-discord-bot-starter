// "Save as quote": right-click (long-press on phones) a message → Apps.
// A message menu command: Discord sends the message, so no Message Content intent is needed.
import { UserError, defineMessageMenu } from '../core/command.ts';
import { truncate } from '../core/text.ts';
import { addQuote, findQuoteByMessage } from '../data/quotes.ts';
import { quoteEmbed } from './quote.ts';

export default defineMessageMenu({
  name: 'Save as quote',
  help: 'Right-click a message → Apps → Save as quote.',
  cooldown: 5,
  async run({ interaction, bot, guild }) {
    const msg = interaction.targetMessage;
    const text = msg.content.trim();
    if (!text) throw new UserError('That message has no text to quote.');
    if (msg.author.bot) throw new UserError("Let's keep quotes for humans.");
    const existing = findQuoteByMessage(bot.db, guild.id, msg.id);
    if (existing) throw new UserError(`That message is already quote #${existing.id}.`);
    const q = addQuote(bot.db, {
      guildId: guild.id,
      text: truncate(text, 1000),
      authorId: msg.author.id,
      authorName: msg.member?.displayName ?? msg.author.displayName,
      savedBy: interaction.user.id,
      channelId: msg.channelId,
      messageId: msg.id,
      createdAt: bot.clock.now(),
    });
    await interaction.reply({ content: `<@${interaction.user.id}> saved quote #${q.id}.`, embeds: [quoteEmbed(q, guild.id)] });
  },
});
