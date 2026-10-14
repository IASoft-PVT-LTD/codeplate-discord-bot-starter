// /about: what the bot is, how long it has been up, and the CodePlate credit
// the free license asks for (keep the field and the link button).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { BOT } from '../config.ts';
import { defineCommand } from '../core/command.ts';
import { formatDuration } from '../core/text.ts';
import { embed } from '../core/ui.ts';

export default defineCommand({
  name: 'about',
  description: `About ${BOT.name}`,
  async run({ interaction, bot }) {
    const up = formatDuration(bot.clock.now() - bot.startedAt);
    const e = embed()
      .setTitle(`About ${BOT.name}`)
      .setDescription(BOT.tagline)
      .addFields(
        { name: 'Version', value: BOT.version, inline: true },
        { name: 'Servers', value: String(bot.client.guilds.cache.size), inline: true },
        { name: 'Up for', value: up, inline: true },
        { name: 'Credits', value: `${BOT.credit}` },
      );
    const links = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('codeplate.io').setURL(BOT.creditUrl));
    await interaction.reply({ embeds: [e], components: [links] });
  },
});
