// /quote: the server's memorable lines. Save one by typing it (/quote add) or
// from any message (right-click → Apps → Save as quote, in save-quote.ts);
// /quote random shows one.
import type { Quote } from '../data/quotes.ts';
import { UserError, defineCommand, subcommand } from '../core/command.ts';
import { opt } from '../core/options.ts';
import { truncate } from '../core/text.ts';
import { embed, okReply } from '../core/ui.ts';
import { addQuote, countQuotes, deleteQuote, getQuote, randomQuote } from '../data/quotes.ts';

export function quoteEmbed(q: Quote, guildId: string) {
  const e = embed()
    .setDescription(`> ${truncate(q.text, 1800).replace(/\n/g, '\n> ')}\n\n— **${q.authorName}**${q.authorId ? ` (<@${q.authorId}>)` : ''}`)
    .setFooter({ text: `Quote #${q.id}` })
    .setTimestamp(q.createdAt);
  if (q.channelId && q.messageId) e.setURL(`https://discord.com/channels/${guildId}/${q.channelId}/${q.messageId}`).setTitle('💬 Jump to the message');
  else e.setTitle('💬 Quote');
  return e;
}

export default defineCommand({
  name: 'quote',
  description: "Save and share the server's best lines",
  subcommands: {
    add: subcommand({
      description: 'Save a quote',
      cooldown: 5,
      options: {
        text: opt.string('What was said').max(1000),
        by: opt.user('Who said it (default: you)').optional(),
      },
      async run({ interaction, bot, guild }, { text, by }) {
        const who = by ?? interaction.user;
        const member = guild.members.cache.get(who.id);
        const q = addQuote(bot.db, {
          guildId: guild.id,
          text,
          authorId: who.id,
          authorName: member?.displayName ?? who.displayName,
          savedBy: interaction.user.id,
          channelId: null,
          messageId: null,
          createdAt: bot.clock.now(),
        });
        await interaction.reply({ content: `Saved quote #${q.id}.`, embeds: [quoteEmbed(q, guild.id)] });
      },
    }),
    random: subcommand({
      description: 'Show a random quote',
      cooldown: 3,
      options: { by: opt.user('Only quotes by this person').optional() },
      async run({ interaction, bot, guild }, { by }) {
        const q = randomQuote(bot.db, guild.id, by?.id);
        if (!q) throw new UserError(by ? `No quotes by ${by.displayName} yet.` : 'No quotes yet. Save one with /quote add, or right-click a message → Apps → Save as quote.');
        await interaction.reply({ embeds: [quoteEmbed(q, guild.id).setFooter({ text: `Quote #${q.id} of ${countQuotes(bot.db, guild.id)}` })] });
      },
    }),
    delete: subcommand({
      description: 'Delete a quote by its number',
      memberPermissions: ['ManageMessages'],
      options: { id: opt.integer('The quote number').min(1) },
      async run({ interaction, bot, guild }, { id }) {
        if (!getQuote(bot.db, guild.id, id) || !deleteQuote(bot.db, guild.id, id)) throw new UserError(`There's no quote #${id}.`);
        await interaction.reply(okReply(`Deleted quote #${id}.`));
      },
    }),
  },
});
