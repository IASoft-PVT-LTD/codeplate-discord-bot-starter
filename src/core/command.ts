// What a command file exports. One file per command in src/commands/, listed
// in src/commands/index.ts. A command bundles everything about one feature:
// its options, its handler, and the buttons, modals, autocomplete and
// scheduled jobs that belong to it. See docs/recipes/add-a-command.md.
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Guild,
  MessageComponentInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  PermissionsString,
  UserContextMenuCommandInteraction,
} from 'discord.js';
import type { z } from 'zod';
import type { Clock } from './clock.ts';
import type { Db } from './db.ts';
import type { Logger } from './log.ts';
import type { Options, Parsed } from './options.ts';
import type { Scheduler } from './scheduler.ts';
import type { Settings } from './settings.ts';

// Everything a handler may use. Created once in src/bot.ts.
export interface Bot {
  client: Client;
  db: Db;
  clock: Clock;
  log: Logger;
  scheduler: Scheduler;
  settings: Settings;
  commands: readonly AnyCommand[];
  startedAt: number; // clock time when the bot was created
  // The IANA time zone for wall-clock times (BOT.timezone in src/config.ts):
  // repeating jobs, typed times like "18:30", and plain-text times in replies.
  // The helpers in src/core/time.ts take it as their `zone`.
  timezone: string;
}

export interface Ctx<I> {
  interaction: I;
  guild: Guild;
  bot: Bot;
  log: Logger; // already tagged with the command, guild and user
}

export type CommandCtx = Ctx<ChatInputCommandInteraction<'cached'>>;
export type ComponentCtx = Ctx<MessageComponentInteraction<'cached'>>;
export type ModalCtx = Ctx<ModalSubmitInteraction<'cached'>>;
export type AutocompleteCtx = Ctx<AutocompleteInteraction<'cached'>>;

// Who may run something. Checked by the router before every handler.
export interface Access {
  // The member needs all of these, in this channel. Also hides the command
  // from members without them (Discord's default_member_permissions), which
  // server admins can override in Server Settings → Integrations.
  memberPermissions?: PermissionsString[];
  // The bot needs these in this channel, or the user gets a clear message.
  botPermissions?: PermissionsString[];
  // Seconds between uses, per member.
  cooldown?: number;
  // Who may use it, on top of memberPermissions (checked in src/core/guards.ts):
  //   'manager'  the server's managers: the owner, Administrators, and members
  //              with the manager role the owner picked with /settings
  //              manager-role (Manage Server counts until one is picked, or if
  //              it was deleted). Use it for setup and admin commands.
  //   'owner'    the server owner only.
  // A command with `who` stays visible in Discord's command list (Discord
  // doesn't know the manager role); the router refuses others and /help hides it.
  who?: Who;
}

export type Who = 'manager' | 'owner';

export interface Subcommand<O extends Options = Options> extends Access {
  description: string;
  options?: O;
  run: (ctx: CommandCtx, options: Parsed<O>) => Promise<void>;
}

// A button or select menu handler. `args` are the parts of the custom id after
// "<command>:<handler>:". By default it needs the same memberPermissions and
// `who` as the command; `public: true` lets anyone who can see the message use it.
export interface ComponentHandler extends Access {
  public?: boolean;
  run: (ctx: ComponentCtx, args: string[]) => Promise<void>;
}

export interface ModalHandler extends Access {
  public?: boolean;
  run: (ctx: ModalCtx, args: string[]) => Promise<void>;
}

// Returns up to 25 suggestions for the focused option.
export type AutocompleteHandler = (ctx: AutocompleteCtx, typed: string) => Promise<{ name: string; value: string }[]>;

export interface JobCtx {
  bot: Bot;
  log: Logger;
  // late: it ran more than a minute after its time (the bot was offline).
  // next: for a repeating job, when it runs next; null for a one-off job.
  job: { id: number; runAt: number; late: boolean; next: number | null };
}

export interface Job<P = unknown> {
  payload: z.ZodType<P>;
  run: (ctx: JobCtx, payload: P) => Promise<void>;
}

export interface SlashCommand<O extends Options = Options> extends Access {
  kind: 'slash';
  name: string; // lowercase, 1-32 characters: a-z, 0-9, - and _
  description: string; // 1-100 characters
  // Either options + run, or subcommands (/tag add, /tag show…), not both.
  options?: O;
  run?: (ctx: CommandCtx, options: Parsed<O>) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each subcommand has its own options
  subcommands?: Record<string, Subcommand<any>>;
  components?: Record<string, ComponentHandler>;
  modals?: Record<string, ModalHandler>;
  autocomplete?: Record<string, AutocompleteHandler>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each job has its own payload
  jobs?: Record<string, Job<any>>;
  // Shown under the command in /help (optional, one line).
  help?: string;
}

// Right-click (or long-press) → Apps → <name>, on a message or a user.
export interface MessageMenuCommand extends Access {
  kind: 'message-menu';
  name: string; // 1-32 characters, spaces and capitals allowed
  run: (ctx: Ctx<MessageContextMenuCommandInteraction<'cached'>>) => Promise<void>;
  help?: string;
}

export interface UserMenuCommand extends Access {
  kind: 'user-menu';
  name: string;
  run: (ctx: Ctx<UserContextMenuCommandInteraction<'cached'>>) => Promise<void>;
  help?: string;
}

export type AnyCommand = SlashCommand | MessageMenuCommand | UserMenuCommand;

export function defineCommand<O extends Options>(def: Omit<SlashCommand<O>, 'kind'>): SlashCommand {
  return { kind: 'slash', ...def } as unknown as SlashCommand;
}

export function subcommand<O extends Options>(def: Subcommand<O>): Subcommand<O> {
  return def;
}

export function job<P>(def: Job<P>): Job<P> {
  return def;
}

export function defineMessageMenu(def: Omit<MessageMenuCommand, 'kind'>): MessageMenuCommand {
  return { kind: 'message-menu', ...def };
}

export function defineUserMenu(def: Omit<UserMenuCommand, 'kind'>): UserMenuCommand {
  return { kind: 'user-menu', ...def };
}

// A message the user should see (shown as-is, privately). Throw it from any
// handler for expected problems: "No tag called x", "That poll is closed".
// Anything else thrown is logged as an error and the user sees a generic message.
export class UserError extends Error {
  override name = 'UserError';
}

// Custom ids for buttons, selects and modals: "<command>:<handler>:<args…>".
// Discord allows 100 characters; keep args short (ids, numbers).
export function customId(command: string, handler: string, ...args: (string | number)[]): string {
  const id = [command, handler, ...args.map(String)].join(':');
  if (id.length > 100) throw new Error(`custom id is ${id.length} characters (max 100): ${id}`);
  if (args.some((a) => String(a).includes(':'))) throw new Error(`custom id arguments can't contain ":": ${id}`);
  return id;
}

export function parseCustomId(id: string): { command: string; handler: string; args: string[] } {
  const [command = '', handler = '', ...args] = id.split(':');
  return { command, handler, args };
}
