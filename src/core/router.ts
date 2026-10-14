// Turns every interaction (slash command, autocomplete, button, select menu,
// modal, context menu) into a call to the right handler in src/commands/,
// after the checks in guards.ts. Errors end here: a UserError is shown to the
// user as-is; anything else is logged with context and the user sees a short
// apology. Handlers never need their own try/catch for that.
import { MessageFlags } from 'discord.js';
import type { BaseInteraction, Interaction, InteractionReplyOptions, RepliableInteraction } from 'discord.js';
import type { Access, AnyCommand, Bot, SlashCommand } from './command.ts';
import { UserError, parseCustomId } from './command.ts';
import { Cooldowns, checkPermissions, checkWho } from './guards.ts';
import { parseOptions } from './options.ts';
import { errorReply } from './ui.ts';

export interface Router {
  handle(interaction: Interaction): Promise<void>;
  // Resolves when every interaction being handled has finished (tests).
  idle(): Promise<void>;
}

export function createRouter(bot: Bot): Router {
  const slash = new Map<string, SlashCommand>();
  const menus = new Map<string, AnyCommand>();
  for (const c of bot.commands) (c.kind === 'slash' ? slash : menus).set(c.name, c as SlashCommand);
  const cooldowns = new Cooldowns(bot.clock);
  const inFlight = new Set<Promise<void>>();

  async function reply(i: RepliableInteraction, payload: InteractionReplyOptions) {
    if (i.replied || i.deferred) await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await i.reply(payload);
  }

  // Permissions and `who` (manager / owner).
  function denied(i: RepliableInteraction<'cached'>, access: Access): string | null {
    return checkPermissions(i, access) ?? (access.who ? checkWho(i.member, access.who, bot.settings.get(i.guildId)) : null);
  }

  // Shared checks. Returns false (after telling the user) if one fails.
  async function allowed(i: RepliableInteraction<'cached'>, key: string, access: Access): Promise<boolean> {
    const problem = denied(i, access) ?? cooldowns.take(key, i.user.id, access.cooldown);
    if (problem) await reply(i, errorReply(problem));
    return !problem;
  }

  async function dispatch(interaction: Interaction) {
    if (!interaction.inCachedGuild()) {
      // Commands are registered for servers only (contexts: Guild), so this is rare.
      if (interaction.isRepliable()) await interaction.reply(errorReply('Use me inside a server.'));
      return;
    }
    const guild = interaction.guild;
    const log = bot.log.child({ guildId: guild.id, userId: interaction.user.id, interactionId: interaction.id });

    if (interaction.isChatInputCommand()) {
      const cmd = slash.get(interaction.commandName);
      if (!cmd) return unknown(interaction, `/${interaction.commandName}`);
      const subName = interaction.options.getSubcommand(false);
      const sub = subName ? cmd.subcommands?.[subName] : undefined;
      if (subName && !sub) return unknown(interaction, `/${cmd.name} ${subName}`);
      const target = sub ?? cmd;
      const name = sub ? `${cmd.name} ${subName}` : cmd.name;
      const access: Access = {
        memberPermissions: [...(cmd.memberPermissions ?? []), ...(sub?.memberPermissions ?? [])],
        botPermissions: [...(cmd.botPermissions ?? []), ...(sub?.botPermissions ?? [])],
        cooldown: sub?.cooldown ?? cmd.cooldown,
        who: sub?.who ?? cmd.who,
      };
      // Permissions, then the options, then the cooldown (so a typo doesn't cost a cooldown).
      const no = denied(interaction, access);
      if (no) return reply(interaction, errorReply(no));
      const parsed = parseOptions(target.options ?? {}, (n) => interaction.options.get(n));
      if (!parsed.ok) return reply(interaction, errorReply(`That didn't work: ${parsed.problems.join('; ')}.`));
      const wait = cooldowns.take(name, interaction.user.id, access.cooldown);
      if (wait) return reply(interaction, errorReply(wait));
      const run = target.run;
      if (!run) throw new Error(`/${name} has no run function`);
      log.info('command', { command: name });
      await run({ interaction, guild, bot, log: log.child({ command: name }) }, parsed.value);
      return;
    }

    if (interaction.isAutocomplete()) {
      const cmd = slash.get(interaction.commandName);
      const focused = interaction.options.getFocused(true);
      const handler = cmd?.autocomplete?.[focused.name];
      let choices: { name: string; value: string }[] = [];
      try {
        if (handler) choices = await handler({ interaction, guild, bot, log }, String(focused.value));
      } catch (err) {
        log.error('autocomplete failed', { command: interaction.commandName, option: focused.name, err });
      }
      await interaction.respond(choices.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) })));
      return;
    }

    if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
      const cmd = menus.get(interaction.commandName);
      if (!cmd) return unknown(interaction, interaction.commandName);
      if (!(await allowed(interaction, cmd.name, cmd))) return;
      log.info('menu command', { command: cmd.name });
      const ctx = { guild, bot, log: log.child({ command: cmd.name }) };
      if (cmd.kind === 'message-menu' && interaction.isMessageContextMenuCommand()) await cmd.run({ ...ctx, interaction });
      else if (cmd.kind === 'user-menu' && interaction.isUserContextMenuCommand()) await cmd.run({ ...ctx, interaction });
      return;
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const { command, handler, args } = parseCustomId(interaction.customId);
      const cmd = slash.get(command);
      const h = interaction.isModalSubmit() ? cmd?.modals?.[handler] : cmd?.components?.[handler];
      if (!cmd || !h) {
        log.warn('no handler for custom id', { customId: interaction.customId });
        await reply(interaction, errorReply('This control is no longer active. Run the command again.'));
        return;
      }
      const access: Access = {
        memberPermissions: [...(h.public ? [] : (cmd.memberPermissions ?? [])), ...(h.memberPermissions ?? [])],
        botPermissions: [...(cmd.botPermissions ?? []), ...(h.botPermissions ?? [])],
        cooldown: h.cooldown,
        who: h.who ?? (h.public ? undefined : cmd.who),
      };
      if (!(await allowed(interaction, `${command}:${handler}`, access))) return;
      log.info(interaction.isModalSubmit() ? 'modal' : 'component', { command, handler });
      const hlog = log.child({ command, handler });
      if (interaction.isModalSubmit()) await (h as NonNullable<SlashCommand['modals']>[string]).run({ interaction, guild, bot, log: hlog }, args);
      else await (h as NonNullable<SlashCommand['components']>[string]).run({ interaction: interaction as never, guild, bot, log: hlog }, args);
    }
  }

  async function unknown(i: RepliableInteraction, what: string) {
    bot.log.warn('unknown command (registered commands are out of date? run npm run register)', { command: what });
    await reply(i, errorReply(`I don't know ${what} any more. An admin can run \`npm run register\` to update my commands.`));
  }

  async function handle(interaction: Interaction) {
    try {
      await dispatch(interaction);
    } catch (err) {
      await failed(interaction, err);
    }
  }

  async function failed(interaction: BaseInteraction, err: unknown) {
    const isUser = err instanceof UserError;
    if (isUser) bot.log.info('user error', { message: err.message, interactionId: interaction.id });
    else bot.log.error('handler failed', { err, interactionId: interaction.id, ...describe(interaction) });
    if (!interaction.isRepliable()) return;
    const text = isUser ? err.message : 'Something went wrong on my side. It has been logged; please try again in a moment.';
    try {
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: errorReply(text).embeds });
      else await reply(interaction, errorReply(text));
    } catch (e) {
      bot.log.warn('could not tell the user about the error', { err: e });
    }
  }

  return {
    handle(interaction) {
      const p = handle(interaction).finally(() => inFlight.delete(p));
      inFlight.add(p);
      return p;
    },
    async idle() {
      while (inFlight.size) await Promise.all([...inFlight]);
    },
  };
}

function describe(i: BaseInteraction): Record<string, unknown> {
  if (i.isCommand() || i.isAutocomplete()) return { command: i.commandName };
  if (i.isMessageComponent() || i.isModalSubmit()) return { customId: i.customId };
  return {};
}
