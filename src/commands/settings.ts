// /settings: who runs the bot in this server.
//   /settings show          anyone: the manager role and the bot's time zone
//   /settings manager-role  the server owner picks the role whose members
//                           count as managers; leave `role` empty to go back
//                           to "Manage Server counts"
// Managers can use the setup and admin commands (`who: 'manager'`: /welcome,
// closing anyone's poll). The owner and Administrators always count. If the
// chosen role is deleted, Manage Server counts again until a new one is picked.
// The check itself is in src/core/guards.ts.
import { UserError, defineCommand, subcommand } from '../core/command.ts';
import { managerRole } from '../core/guards.ts';
import { opt } from '../core/options.ts';
import { formatDateTime } from '../core/time.ts';
import { embed, okReply, privately } from '../core/ui.ts';

export default defineCommand({
  name: 'settings',
  description: 'Who manages the bot in this server',
  help: 'Managers can set up welcomes and close any poll. The server owner picks the manager role.',
  subcommands: {
    show: subcommand({
      description: 'Show the manager role and the time zone',
      async run({ interaction, bot, guild }) {
        const settings = bot.settings.get(guild.id);
        const role = managerRole(guild, settings);
        let managers = role
          ? `Members with <@&${role}>, plus the server owner and Administrators.`
          : 'Members with the **Manage Server** permission, plus the server owner. No manager role is picked yet.';
        if (settings.managers.roleId && !role) managers += '\nThe role that was picked has been deleted.';
        const e = embed()
          .setTitle('⚙️ Settings')
          .addFields(
            { name: 'Managers', value: managers },
            { name: 'Time zone', value: `${bot.timezone} (now ${formatDateTime(bot.clock.now(), bot.timezone)})` },
          )
          .setFooter({ text: 'The server owner changes the manager role with /settings manager-role' });
        await interaction.reply(privately({ embeds: [e] }));
      },
    }),
    'manager-role': subcommand({
      description: 'Pick the role whose members manage the bot (server owner only)',
      who: 'owner',
      options: { role: opt.role('The manager role; leave empty to let Manage Server decide').optional() },
      async run({ interaction, bot, guild }, { role }) {
        if (!role) {
          bot.settings.update(guild.id, { managers: { roleId: null } });
          await interaction.reply(okReply('No manager role now: members with **Manage Server** manage the bot.'));
          return;
        }
        if (role.id === guild.id) throw new UserError('That would make everyone a manager. Pick a specific role, such as Moderator.');
        if (role.managed) throw new UserError(`<@&${role.id}> belongs to a bot or integration and can't be given to members. Pick another role.`);
        bot.settings.update(guild.id, { managers: { roleId: role.id } });
        await interaction.reply(
          okReply(`Members with <@&${role.id}> are now managers: they can set up welcomes and close any poll. You (the owner) and Administrators always can.`),
        );
      },
    }),
  },
});
