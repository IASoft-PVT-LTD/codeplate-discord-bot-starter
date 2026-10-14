// /welcome: greet new members in a channel and give them a role.
//   /welcome setup  a private panel: pick the channel and role from menus,
//                   edit the message in a form, send a test, switch it on/off
//   /welcome test   post the welcome for yourself
//   /welcome off    stop welcoming
// Settings live in the per-server settings (src/core/settings.ts, `welcome`);
// the guildMemberAdd event (src/events/guild-member-add.ts) calls sendWelcome.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Guild, GuildMember, InteractionUpdateOptions } from 'discord.js';
import { UserError, customId, defineCommand, subcommand } from '../core/command.ts';
import type { Bot } from '../core/command.ts';
import type { GuildSettings } from '../core/settings.ts';
import { fill, truncate } from '../core/text.ts';
import { embed, okReply, privately } from '../core/ui.ts';

type Welcome = GuildSettings['welcome'];

export function welcomeText(w: Welcome, member: GuildMember): string {
  return fill(w.message, {
    user: `<@${member.id}>`,
    name: member.displayName,
    server: member.guild.name,
    count: member.guild.memberCount,
  });
}

// Problems that would stop the welcome from working, in plain words.
export function welcomeProblems(guild: Guild, w: Welcome): string[] {
  const out: string[] = [];
  const me = guild.members.me;
  if (!w.channelId) out.push('Pick a channel for the message.');
  const channel = w.channelId ? guild.channels.cache.get(w.channelId) : undefined;
  if (w.channelId && !channel) out.push('The welcome channel no longer exists: pick another.');
  if (channel && me) {
    const missing = channel.permissionsFor(me).missing([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
    if (missing.length) out.push(`I can't post in <#${channel.id}>: I need ${missing.join(', ')} there.`);
  }
  if (w.roleId && me) {
    const role = guild.roles.cache.get(w.roleId);
    if (!role) out.push('The auto-role no longer exists: pick another.');
    else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) out.push('I need the Manage Roles permission to give the auto-role.');
    else if (role.managed) out.push(`<@&${role.id}> is managed by an integration and can't be given out.`);
    else if (me.roles.highest.comparePositionTo(role) <= 0) out.push(`My role must be above <@&${role.id}> (Server Settings → Roles: drag mine higher).`);
  }
  return out;
}

// Posts the welcome for a member and gives the auto-role. Returns what happened.
export async function sendWelcome(bot: Bot, member: GuildMember, opts: { test?: boolean } = {}): Promise<'sent' | 'off' | 'failed'> {
  const w = bot.settings.get(member.guild.id).welcome;
  if (!w.enabled && !opts.test) return 'off';
  const log = bot.log.child({ guildId: member.guild.id, userId: member.id, feature: 'welcome' });
  const channel = w.channelId ? member.guild.channels.cache.get(w.channelId) : undefined;
  let result: 'sent' | 'failed' = 'failed';
  if (channel?.isSendable()) {
    try {
      await channel.send({
        content: opts.test ? '*(test)*' : `<@${member.id}>`,
        embeds: [
          embed()
            .setAuthor({ name: `Welcome, ${member.displayName}!`, iconURL: member.displayAvatarURL({ size: 64 }) })
            .setDescription(welcomeText(w, member))
            .setThumbnail(member.displayAvatarURL({ size: 256 })),
        ],
        allowedMentions: opts.test ? { parse: [] } : { users: [member.id] },
      });
      result = 'sent';
    } catch (err) {
      log.warn('could not post the welcome message', { err, channelId: channel.id });
    }
  } else {
    log.warn('welcome channel missing or not a text channel', { channelId: w.channelId });
  }
  if (w.roleId && !opts.test) {
    try {
      await member.roles.add(w.roleId, 'Welcome auto-role');
    } catch (err) {
      log.warn('could not give the auto-role (is my role above it, with Manage Roles?)', { err, roleId: w.roleId });
      result = 'failed';
    }
  }
  return result;
}

// The private setup panel.
export function welcomePanel(guild: Guild, w: Welcome, member: GuildMember): Pick<InteractionUpdateOptions, 'embeds' | 'components'> {
  const problems = welcomeProblems(guild, w);
  const e = embed(w.enabled ? (problems.length ? 'warn' : 'ok') : 'muted')
    .setTitle('👋 Welcome setup')
    .addFields(
      { name: 'Status', value: w.enabled ? 'On' : 'Off', inline: true },
      { name: 'Channel', value: w.channelId ? `<#${w.channelId}>` : 'Not set', inline: true },
      { name: 'Auto-role', value: w.roleId ? `<@&${w.roleId}>` : 'None', inline: true },
      { name: 'Message preview', value: truncate(welcomeText(w, member), 1024) },
    );
  if (problems.length) e.addFields({ name: 'To fix', value: problems.map((p) => `• ${p}`).join('\n') });
  e.setFooter({ text: 'Placeholders: {user} {name} {server} {count}' });
  const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(customId('welcome', 'channel'))
      .setPlaceholder('Channel for the welcome message')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setDefaultChannels(w.channelId ? [w.channelId] : []),
  );
  const roleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(customId('welcome', 'role'))
      .setPlaceholder('Auto-role for new members (optional)')
      .setMinValues(0)
      .setMaxValues(1)
      .setDefaultRoles(w.roleId ? [w.roleId] : []),
  );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId('welcome', 'edit')).setLabel('Edit message').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(customId('welcome', 'test')).setLabel('Send a test').setStyle(ButtonStyle.Secondary).setDisabled(!w.channelId),
    new ButtonBuilder()
      .setCustomId(customId('welcome', 'toggle'))
      .setLabel(w.enabled ? 'Turn off' : 'Turn on')
      .setStyle(w.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );
  return { embeds: [e], components: [channelRow, roleRow, buttons] };
}

export function welcomeModal(w: Welcome): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('welcome', 'message'))
    .setTitle('Welcome message')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Message')
        .setDescription('Placeholders: {user} {name} {server} {count}')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('message').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true).setValue(w.message),
        ),
    );
}

export default defineCommand({
  name: 'welcome',
  description: 'Greet new members with a message and give them a role',
  // Managers only: the owner, Administrators and the manager role (/settings manager-role).
  who: 'manager',
  subcommands: {
    setup: subcommand({
      description: 'Choose the channel, the message and an auto-role',
      async run({ interaction, bot, guild }) {
        await interaction.reply(privately(welcomePanel(guild, bot.settings.get(guild.id).welcome, interaction.member)));
      },
    }),
    test: subcommand({
      description: 'Post the welcome message for yourself, as a test',
      async run({ interaction, bot }) {
        const w = bot.settings.get(interaction.guildId).welcome;
        if (!w.channelId) throw new UserError('Pick a channel first: /welcome setup.');
        const result = await sendWelcome(bot, interaction.member, { test: true });
        if (result !== 'sent') throw new UserError(`I couldn't post in <#${w.channelId}>. ${welcomeProblems(interaction.guild, w).join(' ')}`);
        await interaction.reply(okReply(`Posted a test in <#${w.channelId}>.`));
      },
    }),
    off: subcommand({
      description: 'Stop welcoming new members',
      async run({ interaction, bot }) {
        bot.settings.update(interaction.guildId, { welcome: { enabled: false } });
        await interaction.reply(okReply('Welcome messages are off. `/welcome setup` turns them back on.'));
      },
    }),
  },
  components: {
    channel: {
      async run({ interaction, bot, guild }) {
        if (!interaction.isChannelSelectMenu()) return;
        const w = bot.settings.update(guild.id, { welcome: { channelId: interaction.values[0] ?? null } }).welcome;
        await interaction.update(welcomePanel(guild, w, interaction.member));
      },
    },
    role: {
      async run({ interaction, bot, guild }) {
        if (!interaction.isRoleSelectMenu()) return;
        const w = bot.settings.update(guild.id, { welcome: { roleId: interaction.values[0] ?? null } }).welcome;
        await interaction.update(welcomePanel(guild, w, interaction.member));
      },
    },
    edit: {
      async run({ interaction, bot, guild }) {
        await interaction.showModal(welcomeModal(bot.settings.get(guild.id).welcome));
      },
    },
    test: {
      async run({ interaction, bot, guild }) {
        const w = bot.settings.get(guild.id).welcome;
        const result = await sendWelcome(bot, interaction.member, { test: true });
        await interaction.update(welcomePanel(guild, w, interaction.member));
        await interaction.followUp(result === 'sent' ? okReply(`Posted a test in <#${w.channelId}>.`) : privately({ content: `⚠️ The test didn't post. ${welcomeProblems(guild, w).join(' ')}` }));
      },
    },
    toggle: {
      async run({ interaction, bot, guild }) {
        const current = bot.settings.get(guild.id).welcome;
        if (!current.enabled && !current.channelId) throw new UserError('Pick a channel first.');
        const w = bot.settings.update(guild.id, { welcome: { enabled: !current.enabled } }).welcome;
        await interaction.update(welcomePanel(guild, w, interaction.member));
      },
    },
  },
  modals: {
    message: {
      async run({ interaction, bot, guild }) {
        const text = interaction.fields.getTextInputValue('message').trim();
        if (!text) throw new UserError('The message is empty.');
        const w = bot.settings.update(guild.id, { welcome: { message: text } }).welcome;
        if (interaction.isFromMessage()) await interaction.update(welcomePanel(guild, w, interaction.member));
        else await interaction.reply(okReply('Saved the welcome message.'));
      },
    },
  },
});
