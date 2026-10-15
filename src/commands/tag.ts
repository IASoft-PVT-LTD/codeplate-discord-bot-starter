// /tag: saved answers for questions that come up again and again ("how do I
// get the member role?"). Anyone can show a tag; members with Manage Messages
// add and delete them (adding opens a form, so long answers are easy to type).
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { UserError, customId, defineCommand, subcommand } from '../core/command.ts';
import { opt } from '../core/options.ts';
import { truncate } from '../core/text.ts';
import { embed, okReply, privately } from '../core/ui.ts';
import { TAG_NAME, deleteTag, getTag, listTags, normalizeTagName, saveTag, searchTags, useTag } from '../data/tags.ts';

export const TAG_LIMITS = { content: 2000, perServer: 200 };

export function tagModal(name = '', content = ''): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('tag', 'save'))
    .setTitle(name ? `Edit tag: ${truncate(name, 30)}` : 'New tag')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Name')
        .setDescription('Lowercase letters, digits and dashes, e.g. rules or how-to-verify')
        .setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true).setValue(name)),
      new LabelBuilder()
        .setLabel('Answer')
        .setDescription('Markdown works: **bold**, lists, links')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('content').setStyle(TextInputStyle.Paragraph).setMaxLength(TAG_LIMITS.content).setRequired(true).setValue(content),
        ),
    );
}

export default defineCommand({
  name: 'tag',
  description: 'Saved answers to common questions',
  subcommands: {
    show: subcommand({
      description: 'Post a saved answer in this channel',
      cooldown: 3,
      options: {
        name: opt.string('Which tag (start typing to search)').max(32).autocomplete(),
        for: opt.user('Mention someone with it').optional(),
      },
      async run({ interaction, bot }, { name, for: target }) {
        const tag = getTag(bot.db, interaction.guildId, name);
        if (!tag) throw new UserError(`There's no tag called \`${normalizeTagName(name)}\`. See /tag list.`);
        useTag(bot.db, interaction.guildId, tag.name);
        await interaction.reply({
          content: target ? `<@${target.id}>` : undefined,
          embeds: [embed().setTitle(`🏷️ ${tag.name}`).setDescription(tag.content)],
          allowedMentions: target ? { users: [target.id] } : { parse: [] },
        });
      },
    }),
    list: subcommand({
      description: 'All saved answers on this server',
      async run({ interaction, bot }) {
        const tags = listTags(bot.db, interaction.guildId);
        const text = tags.length ? tags.map((t) => `\`${t.name}\` · ${t.uses} use${t.uses === 1 ? '' : 's'}`).join('\n') : 'No tags yet. Members with Manage Messages can add one with `/tag add`.';
        await interaction.reply(privately({ embeds: [embed().setTitle(`🏷️ Tags (${tags.length})`).setDescription(truncate(text, 4000))] }));
      },
    }),
    add: subcommand({
      description: 'Save a new answer, or change one (opens a form)',
      memberPermissions: ['ManageMessages'],
      options: { name: opt.string('Prefill the name, or the tag to edit').max(32).autocomplete().optional() },
      async run({ interaction, bot }, { name }) {
        const existing = name ? getTag(bot.db, interaction.guildId, name) : null;
        await interaction.showModal(tagModal(existing?.name ?? (name ? normalizeTagName(name) : ''), existing?.content ?? ''));
      },
    }),
    delete: subcommand({
      description: 'Delete a saved answer',
      memberPermissions: ['ManageMessages'],
      options: { name: opt.string('Which tag').max(32).autocomplete() },
      async run({ interaction, bot }, { name }) {
        if (!deleteTag(bot.db, interaction.guildId, name)) throw new UserError(`There's no tag called \`${normalizeTagName(name)}\`.`);
        await interaction.reply(okReply(`Deleted the tag \`${normalizeTagName(name)}\`.`));
      },
    }),
  },
  autocomplete: {
    async name({ interaction, bot }, typed) {
      return searchTags(bot.db, interaction.guildId, typed).map((n) => ({ name: n, value: n }));
    },
  },
  modals: {
    save: {
      memberPermissions: ['ManageMessages'],
      async run({ interaction, bot }) {
        const name = normalizeTagName(interaction.fields.getTextInputValue('name'));
        const content = interaction.fields.getTextInputValue('content').trim();
        if (!TAG_NAME.test(name)) throw new UserError('Tag names use lowercase letters, digits and dashes (e.g. `how-to-verify`), up to 32 characters.');
        if (!content) throw new UserError('The answer is empty.');
        const isNew = !getTag(bot.db, interaction.guildId, name);
        if (isNew && listTags(bot.db, interaction.guildId).length >= TAG_LIMITS.perServer) {
          throw new UserError(`This server has ${TAG_LIMITS.perServer} tags, the limit. Delete one first.`);
        }
        saveTag(bot.db, { guildId: interaction.guildId, name, content, authorId: interaction.user.id, at: bot.clock.now() });
        await interaction.reply(okReply(`${isNew ? 'Saved' : 'Updated'} the tag \`${name}\`. Show it with \`/tag show name:${name}\`.`));
      },
    },
  },
});
