// The JSON Discord receives for every command (`npm run register` sends it),
// and a check of Discord's rules for it, so a bad definition fails here
// instead of at registration. `npm run register -- --dry-run` prints the JSON.
import { ApplicationCommandOptionType, ApplicationCommandType, InteractionContextType, PermissionsBitField, ApplicationIntegrationType } from 'discord.js';
import type { PermissionsString } from 'discord.js';
import type { AnyCommand, SlashCommand } from './command.ts';
import type { Opt, OptionJson, Options } from './options.ts';

const entries = (o: Options | undefined) => Object.entries(o ?? {}) as [string, Opt<unknown>][];

export interface CommandJson {
  type: ApplicationCommandType;
  name: string;
  description: string;
  options?: (OptionJson | SubcommandJson)[];
  default_member_permissions?: string | null;
  contexts: InteractionContextType[];
  integration_types: ApplicationIntegrationType[];
}

interface SubcommandJson {
  type: ApplicationCommandOptionType.Subcommand;
  name: string;
  description: string;
  options?: OptionJson[];
}

function permissionBits(perms: PermissionsString[] | undefined): string | null {
  return perms?.length ? new PermissionsBitField(perms).bitfield.toString() : null;
}

export function commandJson(c: AnyCommand): CommandJson {
  // Commands work in servers only, for a bot added to a server.
  const base = { contexts: [InteractionContextType.Guild], integration_types: [ApplicationIntegrationType.GuildInstall] };
  if (c.kind !== 'slash') {
    return {
      type: c.kind === 'message-menu' ? ApplicationCommandType.Message : ApplicationCommandType.User,
      name: c.name,
      description: '',
      default_member_permissions: permissionBits(c.memberPermissions),
      ...base,
    };
  }
  const options = c.subcommands
    ? Object.entries(c.subcommands).map(([name, sub]) => {
        const opts = entries(sub.options).map(([n, o]) => o.toJson(n));
        return {
          type: ApplicationCommandOptionType.Subcommand as const,
          name,
          description: sub.description,
          ...(opts.length ? { options: opts } : {}),
        };
      })
    : entries(c.options).map(([n, o]) => o.toJson(n));
  return {
    type: ApplicationCommandType.ChatInput,
    name: c.name,
    description: c.description,
    ...(options.length ? { options } : {}),
    default_member_permissions: permissionBits(c.memberPermissions),
    ...base,
  };
}

export function allCommandJson(commands: readonly AnyCommand[]): CommandJson[] {
  return commands.map(commandJson);
}

// Discord's limits (https://discord.com/developers/docs/interactions/application-commands).
const NAME = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const MAX_SLASH = 100;
const MAX_MENU = 5; // per type; Discord's docs list the current number, 5 is the safe floor
const MAX_OPTIONS = 25;
const MAX_CHOICES = 25;
const MAX_TOTAL_CHARS = 4000;

export function validateCommands(commands: readonly AnyCommand[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const c of commands) {
    const key = `${c.kind}:${c.name}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const json = commandJson(c);
    problems.push(...validateOne(c, json));
  }
  for (const [key, n] of seen) if (n > 1) problems.push(`${key.split(':')[1]}: defined ${n} times`);
  const count = (k: AnyCommand['kind']) => commands.filter((c) => c.kind === k).length;
  if (count('slash') > MAX_SLASH) problems.push(`${count('slash')} slash commands (Discord allows ${MAX_SLASH})`);
  if (count('message-menu') > MAX_MENU) problems.push(`${count('message-menu')} message menu commands (keep to ${MAX_MENU})`);
  if (count('user-menu') > MAX_MENU) problems.push(`${count('user-menu')} user menu commands (keep to ${MAX_MENU})`);
  return problems;
}

function validateOne(c: AnyCommand, json: CommandJson): string[] {
  const p: string[] = [];
  const at = c.kind === 'slash' ? `/${c.name}` : `"${c.name}"`;
  if (c.kind === 'slash') {
    if (!NAME.test(c.name) || c.name !== c.name.toLowerCase()) p.push(`${at}: name must be 1-32 lowercase letters, digits, - or _`);
    checkDescription(p, at, c.description);
    p.push(...checkHandlers(c));
  } else if (c.name.length < 1 || c.name.length > 32) {
    p.push(`${at}: menu command names are 1-32 characters`);
  }
  if (c.kind === 'slash' && c.options && c.subcommands) p.push(`${at}: use either options or subcommands, not both`);
  if (c.kind === 'slash' && !c.subcommands && !c.run) p.push(`${at}: needs a run function (or subcommands)`);
  const top = json.options ?? [];
  if (top.length > MAX_OPTIONS) p.push(`${at}: ${top.length} options (max ${MAX_OPTIONS})`);
  for (const o of top) {
    if (o.type === ApplicationCommandOptionType.Subcommand) {
      const s = o as SubcommandJson;
      if (!NAME.test(s.name) || s.name !== s.name.toLowerCase()) p.push(`${at} ${s.name}: subcommand names are 1-32 lowercase characters`);
      checkDescription(p, `${at} ${s.name}`, s.description);
      checkOptions(p, `${at} ${s.name}`, s.options ?? []);
    }
  }
  if (!top.some((o) => o.type === ApplicationCommandOptionType.Subcommand)) checkOptions(p, at, top as OptionJson[]);
  const chars = totalChars(json);
  if (chars > MAX_TOTAL_CHARS) p.push(`${at}: names, descriptions and choices add up to ${chars} characters (max ${MAX_TOTAL_CHARS})`);
  return p;
}

function checkDescription(p: string[], at: string, d: string) {
  if (d.trim().length < 1 || d.length > 100) p.push(`${at}: description must be 1-100 characters (it is ${d.length})`);
}

function checkOptions(p: string[], at: string, options: OptionJson[]) {
  if (options.length > MAX_OPTIONS) p.push(`${at}: ${options.length} options (max ${MAX_OPTIONS})`);
  let sawOptional = false;
  const names = new Set<string>();
  for (const o of options) {
    const where = `${at} [${o.name}]`;
    if (!NAME.test(o.name) || o.name !== o.name.toLowerCase()) p.push(`${where}: option names are 1-32 lowercase letters, digits, - or _`);
    if (names.has(o.name)) p.push(`${where}: duplicate option name`);
    names.add(o.name);
    checkDescription(p, where, o.description);
    if (o.required && sawOptional) p.push(`${where}: required options must come before optional ones`);
    if (!o.required) sawOptional = true;
    if (o.choices) {
      if (o.choices.length < 1 || o.choices.length > MAX_CHOICES) p.push(`${where}: 1-${MAX_CHOICES} choices (has ${o.choices.length})`);
      for (const ch of o.choices) {
        if (ch.name.length < 1 || ch.name.length > 100) p.push(`${where}: choice names are 1-100 characters ("${ch.name}")`);
        if (typeof ch.value === 'string' && ch.value.length > 100) p.push(`${where}: choice values are at most 100 characters`);
      }
      if (o.autocomplete) p.push(`${where}: choices and autocomplete can't be combined`);
    }
    if (o.min_length !== undefined && (o.min_length < 0 || o.min_length > 6000)) p.push(`${where}: min length must be 0-6000`);
    if (o.max_length !== undefined && (o.max_length < 1 || o.max_length > 6000)) p.push(`${where}: max length must be 1-6000`);
    if (o.min_length !== undefined && o.max_length !== undefined && o.min_length > o.max_length) p.push(`${where}: min length is above max length`);
    if (o.min_value !== undefined && o.max_value !== undefined && o.min_value > o.max_value) p.push(`${where}: min value is above max value`);
  }
}

// Every component, modal, autocomplete and job handler must have a short name
// without ":" (it's part of custom ids and job kinds), and every autocomplete
// handler must belong to an option marked .autocomplete().
function checkHandlers(c: SlashCommand): string[] {
  const p: string[] = [];
  for (const [group, handlers] of [['components', c.components], ['modals', c.modals], ['jobs', c.jobs], ['autocomplete', c.autocomplete]] as const) {
    for (const name of Object.keys(handlers ?? {})) {
      if (!/^[a-z0-9-]{1,20}$/i.test(name)) p.push(`/${c.name} ${group}.${name}: handler names are 1-20 letters, digits or -`);
    }
  }
  const allOptions = c.subcommands ? Object.values(c.subcommands).flatMap((s) => entries(s.options)) : entries(c.options);
  const auto = new Set(allOptions.filter(([, o]) => o.extra.autocomplete).map(([n]) => n));
  for (const name of Object.keys(c.autocomplete ?? {})) if (!auto.has(name)) p.push(`/${c.name}: autocomplete.${name} has no option "${name}" marked .autocomplete()`);
  for (const name of auto) if (!c.autocomplete?.[name]) p.push(`/${c.name} [${name}]: marked .autocomplete() but has no autocomplete handler`);
  return p;
}

function totalChars(json: CommandJson): number {
  let n = json.name.length + json.description.length;
  const walk = (opts: (OptionJson | SubcommandJson)[] | undefined) => {
    for (const o of opts ?? []) {
      n += o.name.length + o.description.length;
      if ('choices' in o && o.choices) for (const ch of o.choices) n += ch.name.length + String(ch.value).length;
      if ('options' in o) walk(o.options);
    }
  };
  walk(json.options);
  return n;
}
