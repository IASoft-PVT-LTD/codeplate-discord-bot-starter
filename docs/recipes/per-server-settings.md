# Per-server settings

Use this when each server should choose something for itself: a log channel, a time zone, a language, on/off switches. (Who manages the bot is already a setting: `managers.roleId`, picked by the owner with `/settings manager-role`; see `permissions-and-roles.md`.) Settings are one typed JSON document per server in `guild_settings`; the schema gives defaults, so servers that never touched a setting just work.

## Steps

1. **Add the field with a default** to `GuildSettingsSchema` in `src/core/settings.ts`. Group related settings:

   ```ts
   modLog: z
     .object({
       channelId: snowflake.nullable().default(null),
       logPurges: z.boolean().default(true),
     })
     .prefault({}),
   ```

   Use `.prefault({})` on a group (so its fields' defaults apply when the group is missing). No migration is needed: stored documents without the field get the default when read.

2. **Read it** where needed: `const { modLog } = bot.settings.get(guild.id)`. Write it: `bot.settings.update(guild.id, { modLog: { channelId } })` (a partial update; the result is validated, so a bad value throws).

3. **Let admins change it.** Either a small command:

   ```ts
   export default defineCommand({
     name: 'modlog',
     description: 'Choose where moderation actions are logged',
     who: 'manager', // the owner, Administrators and the manager role (or Manage Server)
     options: { channel: opt.channel('The log channel').types(ChannelType.GuildText) },
     async run({ interaction, bot, guild }, { channel }) {
       bot.settings.update(guild.id, { modLog: { channelId: channel.id } });
       await interaction.reply(okReply(`Moderation actions will be logged in <#${channel.id}>.`));
     },
   });
   ```

   or a setup panel with menus and buttons, like `/welcome setup` (`welcome.ts`: `welcomePanel` renders the current settings; each component updates one setting and re-renders the panel). A panel is friendlier when there are several settings.

4. **Show problems early.** If a setting can be broken by server changes (a deleted channel, a role above the bot's), check it where it's shown, like `welcomeProblems()`, and handle it where it's used (log a warning, don't crash).

5. **Test it:** `tests/core/units.test.ts` shows settings unit tests; add a command test that changes the setting and checks the behavior that depends on it, and a scenario for the panel.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS`, including a test where two servers have different values (settings are per server).
2. `npm run shots -- <scenario>` shows the setup reply or panel with the current values.
3. Tell the user to run `npm run register` if you added a command.
