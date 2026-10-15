# Add a command

Use this when the user wants a new slash command ("a /birthday command", "/roll 2d6"). For right-click commands on a message or user, see step 7.

## Steps

1. **Pick the shape.** One action → a command with `options` and `run`. Several related actions → `subcommands` (`/birthday set`, `/birthday list`). Names are lowercase, 1-32 characters (`a-z`, `0-9`, `-`, `_`); descriptions are 1-100 characters and say what it does, not how.

2. **Create `src/commands/<name>.ts`.** A minimal command with typed options:

   ```ts
   // /roll: roll dice like 2d6 or d20.
   import { MessageFlags } from 'discord.js';
   import { UserError, defineCommand } from '../core/command.ts';
   import { opt } from '../core/options.ts';
   import { embed } from '../core/ui.ts';

   export default defineCommand({
     name: 'roll',
     description: 'Roll dice, like 2d6 or d20',
     cooldown: 3,
     options: {
       dice: opt.string('What to roll, e.g. 2d6').max(10),
       secret: opt.boolean('Only you see the result').optional(),
     },
     async run({ interaction }, { dice, secret }) {
       const m = /^(\d*)d(\d+)$/i.exec(dice.trim());
       if (!m) throw new UserError('Write dice like 2d6 or d20.');
       const count = Number(m[1] || 1);
       const sides = Number(m[2]);
       if (count > 20 || sides > 1000) throw new UserError('At most 20 dice of up to 1000 sides.');
       const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
       await interaction.reply({
         embeds: [embed().setTitle(`🎲 ${dice}`).setDescription(`${rolls.join(' + ')} = **${rolls.reduce((a, b) => a + b, 0)}**`)],
         ...(secret ? { flags: MessageFlags.Ephemeral } : {}),
       });
     },
   });
   ```

   Options: `opt.string`, `opt.integer`, `opt.number`, `opt.boolean`, `opt.user`, `opt.member` (a `GuildMember`, with roles), `opt.channel(...).types(ChannelType.GuildText)`, `opt.role`, `opt.attachment`; modifiers `.min()/.max()` (length for strings, value for numbers), `.choices(...)`, `.autocomplete()`, `.optional()`, and `.zod(s => …)` for your own rules or transforms (see `remind.ts` for a duration). Required options first.

   Subcommands: `subcommands: { set: subcommand({ description, options, run }), list: subcommand({ ... }) }` (see `remind.ts`).

3. **Who can use it** (`docs/recipes/permissions-and-roles.md`): `memberPermissions: ['ManageMessages']` on the command or a subcommand, `who: 'manager'` for setup and admin commands (the server's managers: owner, Administrators, the manager role), `botPermissions` for what the bot needs in the channel, `cooldown` in seconds.

4. **Slow work?** If it calls an API or may take over 2 seconds: `await interaction.deferReply()` first, then `await interaction.editReply(...)`.

5. **Data?** Use `src/data/<feature>.ts` functions (`add-a-database-table.md`) or settings (`per-server-settings.md`). Use `bot.clock.now()` for time, and `src/core/time.ts` with `bot.timezone` for times of day ("18:30", "every Monday").

6. **List it** in `src/commands/index.ts` (its position sets the order in /help). Add a `help: '…'` line if a short hint helps.

7. **A right-click command instead?** `defineMessageMenu({ name: 'Translate', async run({ interaction }) { interaction.targetMessage … } })` or `defineUserMenu(...)` with `interaction.targetUser`/`targetMember` (see `save-quote.ts`). Names may have capitals and spaces.

8. **Test it.** Create `tests/commands/<name>.test.ts` (copy `tag.test.ts`): `const r = await t.slash('roll', { dice: '2d6' })`, then assert on `r.reply` (the JSON Discord got), `r.ephemeral`, `textOf(r.reply)`. Cover a success, a `UserError`, and a permission denial if it has permissions. For randomness, assert on the shape (`/= \*\*\d+\*\*/`).

9. **Add a scenario** in `scripts/preview/scenarios.ts` (copy the `about` one) so it can be looked at.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS` (the `commands` step checks the definition against Discord's rules; your test runs it end to end).
2. `npm run shots -- <scenario>` and open `shots/<scenario>.png`: the reply reads well and nothing is cut off.
3. `npm run register -- --dry-run` shows the new command's JSON. Tell the user to run `npm run register` (and restart the bot) to see it in Discord.
