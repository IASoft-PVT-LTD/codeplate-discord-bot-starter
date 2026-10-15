// /help: every command, built from the command definitions (so it never goes
// out of date). Members only see the commands they're allowed to run: the
// same permission and manager/owner checks as the router (src/core/guards.ts).
// The footer carries the CodePlate credit (free license): keep it.
import { defineCommand } from '../core/command.ts';
import type { Access, AnyCommand } from '../core/command.ts';
import { BOT } from '../config.ts';
import { memberMay } from '../core/guards.ts';
import { embed, privately } from '../core/ui.ts';

// `may` answers "can this member run something with this access?"; without
// it, every command is listed.
export function helpLines(commands: readonly AnyCommand[], may: (access: Access) => boolean = () => true): string[] {
  const lines: string[] = [];
  for (const c of commands) {
    if (!may(c)) continue;
    if (c.kind !== 'slash') {
      lines.push(`**${c.name}** · ${c.help ?? 'right-click a message → Apps'}`);
      continue;
    }
    if (c.subcommands) {
      // A subcommand needs the command's permissions plus its own; its `who` replaces the command's.
      const subs = Object.entries(c.subcommands).filter(([, s]) =>
        may({ memberPermissions: [...(c.memberPermissions ?? []), ...(s.memberPermissions ?? [])], who: s.who ?? c.who }),
      );
      if (!subs.length) continue;
      lines.push(`**/${c.name}** · ${c.description}`);
      for (const [name, s] of subs) lines.push(`  \`/${c.name} ${name}\` ${s.description}`);
    } else {
      lines.push(`**/${c.name}** · ${c.description}`);
    }
    if (c.help) lines.push(`  *${c.help}*`);
  }
  return lines;
}

export default defineCommand({
  name: 'help',
  description: `What ${BOT.name} can do`,
  async run({ interaction, bot, guild }) {
    const settings = bot.settings.get(guild.id);
    const lines = helpLines(bot.commands, (access) => memberMay(interaction, access, settings));
    const e = embed()
      .setTitle(`${BOT.name}: commands`)
      .setDescription(`${BOT.tagline}\n\n${lines.join('\n')}`)
      .setFooter({ text: `${BOT.name} ${BOT.version} · ${BOT.credit}` });
    await interaction.reply(privately({ embeds: [e] }));
  },
});
