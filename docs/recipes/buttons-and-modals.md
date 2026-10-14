# Buttons, select menus and forms

Use this when a reply needs buttons ("RSVP: Going / Maybe"), a menu (pick a role or channel), or a form (a modal with text fields). Examples in the template: `poll.ts` (buttons), `welcome.ts` (channel and role menus, a modal, buttons), `tag.ts` (a modal from a slash command).

## How routing works

Every interactive component has a **custom id** `"<command>:<handler>:<args…>"`, built with `customId('rsvp', 'answer', eventId, 'going')`. When it's used, the router looks up `components.<handler>` (buttons and menus) or `modals.<handler>` (form submits) **in that command's file** and calls `run(ctx, args)`. Args are strings; keep them to ids and short codes (100 characters max for the whole id) and load the rest from the database, so old buttons keep working after a restart.

## Steps

1. **Send buttons.** In the command's `run`:

   ```ts
   const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
     new ButtonBuilder().setCustomId(customId('rsvp', 'answer', event.id, 'going')).setLabel('Going').setStyle(ButtonStyle.Success),
     new ButtonBuilder().setCustomId(customId('rsvp', 'answer', event.id, 'maybe')).setLabel('Maybe').setStyle(ButtonStyle.Secondary),
   );
   await interaction.reply({ embeds: [rsvpEmbed(event)], components: [row] });
   ```

   Up to 5 rows, 5 buttons per row. Link buttons (`ButtonStyle.Link` + `setURL`) need no handler.

2. **Handle clicks** in the same file:

   ```ts
   components: {
     answer: {
       public: true, // anyone who sees the message may click; without it, the command's memberPermissions and `who` apply
       async run({ interaction, bot }, [eventId, answer]) {
         saveAnswer(bot.db, Number(eventId), interaction.user.id, answer);
         await interaction.update(rsvpMessage(bot, Number(eventId))); // edit the message with the buttons
         await interaction.followUp({ content: `You're down as **${answer}**.`, flags: MessageFlags.Ephemeral });
       },
     },
   },
   ```

   `update()` edits the message the button is on; `reply()` posts a new message; `deferUpdate()` acknowledges with no change (then `editReply` later). Render the whole message from one function (like `pollMessage`) so posting and updating stay identical.

3. **Select menus.** `StringSelectMenuBuilder` (your options), `UserSelectMenuBuilder`, `RoleSelectMenuBuilder`, `ChannelSelectMenuBuilder` (Discord fills them; `setDefaultRoles`/`setDefaultChannels` preselect). In the handler, narrow the type and read `values`:

   ```ts
   async run({ interaction, bot, guild }) {
     if (!interaction.isRoleSelectMenu()) return;
     const roleId = interaction.values[0] ?? null;
     ...
   }
   ```

4. **A form (modal).** Build it with labels (the current API; `TextInputBuilder.setLabel` is deprecated):

   ```ts
   const modal = new ModalBuilder().setCustomId(customId('rsvp', 'note', event.id)).setTitle('Add a note')
     .addLabelComponents(new LabelBuilder().setLabel('Note').setDescription('Optional details')
       .setTextInputComponent(new TextInputBuilder().setCustomId('note').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false)));
   await interaction.showModal(modal);
   ```

   `showModal` must be the first response to the interaction (no `deferReply` before it). Handle the submit under `modals`:

   ```ts
   modals: {
     note: { public: true, async run({ interaction, bot }, [eventId]) {
       const note = interaction.fields.getTextInputValue('note');
       ...
       if (interaction.isFromMessage()) await interaction.update(...); else await interaction.reply(...);
     } },
   },
   ```

   Up to 5 fields; values are strings (validate them; throw `UserError` for bad input).

5. **Permissions.** Components and modals inherit the command's `memberPermissions` and `who` unless `public: true`; add `memberPermissions` or `who` on a handler for stricter ones; for data-dependent rules (only the author or a manager) check in `run` with `isManager()` from `src/core/guards.ts` and throw a `UserError` (see `poll.ts` `close`).

6. **Test it** with the test bot: `const msg = (await t.slash('rsvp', {...})).reply!`, then `await t.click(msg, 'rsvp:answer:1:going', { as: t.bob })`, `await t.select(msg, 'welcome:role', [roleId])`, `const form = await t.click(msg, '...')` → `form.modal`, then `await t.submitModal(form.modal!, { note: 'hi' }, { message: msg })`. Assert on `msg` (it's updated in place), `r.followUps` and `r.ephemeral`. Add a scenario so the buttons can be seen.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS`.
2. `npm run shots -- <scenario>`: the buttons fit on their rows, labels are short, menus show their placeholders, the form shows its fields.
3. In a real server, try the buttons after restarting the bot: they must still work (state comes from the database, not memory).
