# Permissions and roles

Use this when the user says who may use something ("only mods can purge", "anyone can vote", "only the Event Host role can create events", "only organizers can set up the bot"), or when the bot should give or take roles.

## How access works here

- **`memberPermissions`** (on a command, subcommand, component or modal): Discord permissions the member needs **in that channel**. The router checks them before the handler. On a command, they also set Discord's `default_member_permissions`, which hides the command from members without them; server admins can override that in Server Settings → Integrations → the bot, and the runtime check still applies to what they allow.
- **`who: 'manager'`**: the server's **managers**, a built-in role-based guard (`src/core/guards.ts`). Managers are:
  - the **server owner**, always;
  - members with **Administrator**, always;
  - members with the **manager role**, which the owner picks in Discord with `/settings manager-role role:@Organizers` (`src/commands/settings.ts`, stored as the `managers.roleId` setting);
  - until a role is picked, or if the picked role is deleted, members with **Manage Server**.

  Use it for setup and admin commands. In Huddle: `/welcome` (all of it, including its panel's menus and buttons) and closing someone else's poll. Commands with `who` stay visible in Discord's command list (Discord can't know the manager role), so the router refuses others with a clear message, and `/help` lists only what the member can run.
- **`who: 'owner'`**: the server owner only (e.g. `/settings manager-role`).
- **`botPermissions`**: what the bot needs in the channel (e.g. `ManageMessages` for `/purge`); members get a clear "I need … in this channel" instead of a failure. `npm run invite` includes them in the invite link.
- **Data-dependent rules** ("only the poll's author or a manager"): check in the handler and throw a `UserError`. `isManager(member, bot.settings.get(guild.id))` gives the manager answer (see `poll.ts`, `close`).
- Permission names are discord.js's `PermissionsString`s: `ManageMessages`, `ManageGuild` (shown as "Manage Server"), `ManageRoles`, `KickMembers`, `BanMembers`, `ModerateMembers` (timeouts), `Administrator`…

## Steps

1. **Map the user's words to a rule.** "Moderators" (who delete messages, time people out) usually means a permission: `ManageMessages`, `ModerateMembers`. "Admins", "organizers", "the people who run the bot" usually means `who: 'manager'`, so the owner can pick the role in Discord. Prefer these over role names: they work in every server and follow the server's own setup. Record the mapping in `docs/project.md` (e.g. "/event create: managers; manager role picked by the owner").

2. **Managers only:** put `who: 'manager'` on the command, a subcommand, or a component/modal:

   ```ts
   export default defineCommand({
     name: 'event',
     description: 'Plan server events',
     subcommands: {
       create: subcommand({ description: 'Create an event', who: 'manager', options: { … }, async run(ctx, o) { … } }),
       list: subcommand({ description: 'Upcoming events', async run(ctx) { … } }), // everyone
     },
   });
   ```

   Components and modals inherit the command's `who` unless `public: true`. Tell the user: "The server owner picks who manages the bot with `/settings manager-role`; until then, members with Manage Server can." If the user wants their own word ("hosts", "organizers"), change the wording in `src/commands/settings.ts` and the messages in `checkWho()` (`src/core/guards.ts`), and keep the tests passing (update the regexes if you change the words).

3. **A second, feature-specific role** (e.g. "Event Host" separate from the managers): make it a per-server setting (`per-server-settings.md`: `events.hostRoleId`), chosen by managers in a setup panel (`RoleSelectMenuBuilder`) or a `who: 'owner'` subcommand, then check it in the handler, falling back to managers:

   ```ts
   const settings = bot.settings.get(guild.id);
   const hostRole = settings.events.hostRoleId;
   const isHost = hostRole && guild.roles.cache.has(hostRole) ? interaction.member.roles.cache.has(hostRole) : false;
   if (!isHost && !isManager(interaction.member, settings)) throw new UserError(`Only event hosts (<@&${hostRole}>) or managers can create events.`);
   ```

   Never hard-code role ids or names: they differ per server. Handle a deleted role (`guild.roles.cache.has(id)` is false) by falling back, like `managerRole()` does.

4. **Giving or removing roles** (`member.roles.add(roleId, 'reason')` / `.remove`): the bot needs `ManageRoles`, and **its highest role must be above the role** it gives (Server Settings → Roles: drag the bot's role up). Managed roles (bots, boosts) can't be given. Check up front and explain, like `welcomeProblems()` in `welcome.ts`; catch failures and log a warning instead of crashing. Add `ManageRoles` to `BASE_PERMISSIONS` in `src/core/deploy.ts` if no command lists it.

5. **Self-assign roles** (a role menu): a `StringSelectMenuBuilder` listing allowed roles (chosen by managers, stored in settings), `public: true` on the component, then add/remove the selected roles; reply privately with what changed.

6. **Moderation actions** (timeout, kick, ban): need both the member's and the bot's permission (`ModerateMembers`, `KickMembers`, `BanMembers`) **and** the target must be below both in the role order; check `targetMember.moderatable` / `.kickable` / `.bannable` first and refuse to act on the server owner or yourself. Log every action (to a mod-log channel setting, and `log.info`).

7. **Test it.** The test server has `owner` (owns the server; Admin role), `mod` (Moderator: Manage Messages, Kick, Timeout), `alice` and `bob` (Member). Test the allowed and the refused cases:
   - managers: `await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner })` makes `mod` a manager; `t.createRole({ name, permissions })`, `t.setRoles(user, [roles])` and `t.deleteRole(role)` change the server while the bot runs (`tests/commands/settings.test.ts` covers the fallback, the deleted role and `/help`);
   - to test what happens when the bot lacks a permission, change `t.roles.botRole.permissions` and restart the test bot (see `tests/commands/purge.test.ts`). Channel overrides: `t.discord.addChannel(t.guild, { name, overwrites: [...] })` before the bot starts. The fake Discord enforces the role order when giving roles.

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS`, with tests for allowed and refused members (and, for `who: 'manager'`, with and without a manager role).
2. `npm run shots -- help help-member settings`: `/help` as a member doesn't list what they can't run.
3. `npm run register -- --dry-run`: the command's `default_member_permissions` is what you expect (`null` = everyone sees it; `who` commands are `null`).
4. `npm run invite` lists the permissions the bot asks for; tell the user that existing servers must grant new permissions to the bot's role by hand (or re-invite).
