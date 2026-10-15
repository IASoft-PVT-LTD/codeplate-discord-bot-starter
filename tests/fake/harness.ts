// The test bot: the real bot (src/bot.ts) on an in-memory database, a fake
// clock and the fake Discord, plus a small sample server and helpers that act
// like members using it:
//
//   const t = await startTestBot();
//   const r = await t.slash('poll', { question: 'Lunch?', answers: 'Pizza; Tacos' });
//   const msg = r.reply!;                         // the JSON Discord got
//   await t.click(msg, 'poll:vote:1:0', { as: t.bob });
//   t.clock.advance(60 * 60_000); await t.idle(); // jobs that came due ran
//   await t.stop();
//
// Every helper waits until the handlers (and any jobs they started) finish.
import { ApplicationCommandOptionType, ApplicationCommandType, ComponentType, PermissionFlagsBits, Status } from 'discord.js';
import type { Client } from 'discord.js';
import { createBot } from '../../src/bot.ts';
import type { Huddle } from '../../src/bot.ts';
import { commands } from '../../src/commands/index.ts';
import { defineCommand } from '../../src/core/command.ts';
import type { AnyCommand, SlashCommand } from '../../src/core/command.ts';
import { FakeClock } from '../../src/core/clock.ts';
import { openDb } from '../../src/core/db.ts';
import type { Db } from '../../src/core/db.ts';
import { memoryLogger } from '../../src/core/log.ts';
import type { Logger, LogLine } from '../../src/core/log.ts';
import { FakeDiscord } from './discord.ts';
import type { FakeChannel, FakeGuild, FakeMessage, FakeRole, FakeUser, InteractionRecord, Raw } from './discord.ts';

export type OptionValue = string | number | boolean | FakeUser | FakeChannel | FakeRole;

export interface ActOpts {
  as?: FakeUser;
  channel?: FakeChannel;
}

export interface TestBot {
  discord: FakeDiscord;
  clock: FakeClock;
  db: Db;
  log: Logger & { lines: LogLine[] };
  huddle: Huddle;
  client: Client;
  guild: FakeGuild;
  // The sample server: #general, #welcome, #announcements (members can't post)
  general: FakeChannel;
  welcomeChannel: FakeChannel;
  announcements: FakeChannel;
  // roles: Member (plain), Moderator (Manage Messages), Admin (Administrator)
  roles: { member: FakeRole; moderator: FakeRole; admin: FakeRole; botRole: FakeRole };
  // owner (owns the server), mod (Moderator), alice and bob (Members)
  owner: FakeUser;
  mod: FakeUser;
  alice: FakeUser;
  bob: FakeUser;
  // `unknown: true` sends a command the bot doesn't have (as if registered commands were out of date).
  slash(command: string, options?: Record<string, OptionValue | undefined>, opts?: ActOpts & { sub?: string; unknown?: boolean }): Promise<InteractionRecord>;
  autocomplete(command: string, option: string, typed: string, opts?: ActOpts & { sub?: string; options?: Record<string, OptionValue> }): Promise<InteractionRecord>;
  click(message: FakeMessage, customId: string, opts?: ActOpts): Promise<InteractionRecord>;
  select(message: FakeMessage, customId: string, values: string[], opts?: ActOpts): Promise<InteractionRecord>;
  submitModal(modal: Raw, values: Record<string, string>, opts?: ActOpts & { message?: FakeMessage }): Promise<InteractionRecord>;
  messageMenu(name: string, target: FakeMessage, opts?: ActOpts): Promise<InteractionRecord>;
  join(user: FakeUser): Promise<void>;
  // Changes an admin makes in Discord while the bot runs (sent as gateway events).
  createRole(r: { name: string; permissions?: bigint; color?: number }): Promise<FakeRole>;
  deleteRole(role: FakeRole): Promise<void>;
  setRoles(user: FakeUser, roles: FakeRole[]): Promise<void>; // replaces the member's roles
  // Moves the fake clock and runs whatever came due.
  advance(ms: number): Promise<void>;
  idle(): Promise<void>;
  // Log lines at warn or error (tests usually expect none).
  problems(): LogLine[];
  stop(): Promise<void>;
}

interface Shard {
  id: number;
  status: Status;
  checkReady(): void;
}

export async function startTestBot(
  // timezone: the bot's zone (default BOT.timezone), e.g. 'Europe/London' to test clock changes.
  opts: { db?: Db; clock?: FakeClock; discord?: FakeDiscord; extraCommands?: AnyCommand[]; seed?: (t: TestBot) => void; timezone?: string } = {},
): Promise<TestBot> {
  const clock = opts.clock ?? new FakeClock();
  const discord = opts.discord ?? new FakeDiscord(clock);
  const db = opts.db ?? openDb(':memory:');
  const log = memoryLogger('debug');
  const reused = discord.guilds.size > 0;

  // The sample server (built once per FakeDiscord, so a restart sees the same world).
  const world = reused ? recall(discord) : buildWorld(discord);

  const allCommands = [...commands, ...(opts.extraCommands ?? [])];
  const huddle = createBot({ db, log, clock, commands: allCommands, timezone: opts.timezone, clientOptions: { rest: { makeRequest: discord.makeRequest as never, retries: 0, timeout: 5_000 } } });
  const client = huddle.client;
  client.rest.setToken('fake-token-for-tests');
  // discord.js's gateway handlers, fed directly (what a websocket would deliver).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private discord.js API, pinned version
  const ws = client.ws as any;
  const shard: Shard = { id: 0, status: Status.Ready, checkReady: () => undefined };
  const packet = (t: string, d: Raw) => ws.handlePacket({ op: 0, t, d, s: null }, shard);
  packet('READY', {
    v: 10,
    user: { ...discord.rawUser(discord.botUser), verified: true, mfa_enabled: false, flags: 0 },
    guilds: [...discord.guilds.values()].map((g) => ({ id: g.id, unavailable: true })),
    session_id: 'fake-session',
    resume_gateway_url: 'wss://fake.invalid',
    application: { id: discord.applicationId, flags: 0 },
  });
  for (const g of discord.guilds.values()) packet('GUILD_CREATE', discord.rawGuild(g));
  ws.triggerClientReady();
  await huddle.idle();

  const commandType = (name: string) => allCommands.find((c) => c.name === name);

  function base(kind: InteractionRecord['kind'], label: string, as: FakeUser, channel: FakeChannel, extra: Partial<InteractionRecord> = {}) {
    return discord.newInteraction({ kind, label, userId: as.id, channelId: channel.id, guildId: channel.guildId!, ...extra });
  }

  function payload(rec: InteractionRecord, type: number, data: Raw, message?: FakeMessage): Raw {
    const channel = discord.channels.get(rec.channelId)!;
    const guild = discord.guilds.get(rec.guildId)!;
    return {
      id: rec.id,
      application_id: discord.applicationId,
      type,
      token: rec.token,
      version: 1,
      guild_id: guild.id,
      guild: { id: guild.id, locale: 'en-US', features: [] },
      channel_id: channel.id,
      channel: discord.rawChannel(channel),
      member: { ...discord.rawMember(guild, rec.userId), permissions: discord.permissionsIn(channel, rec.userId).toString() },
      app_permissions: discord.permissionsIn(channel, discord.botUser.id).toString(),
      locale: 'en-US',
      guild_locale: 'en-US',
      entitlements: [],
      authorizing_integration_owners: { 0: guild.id },
      context: 0,
      attachment_size_limit: 10_485_760,
      data,
      ...(message ? { message } : {}),
    };
  }

  // Slash command options as Discord sends them, with `resolved` users/roles/channels.
  function optionData(cmd: SlashCommand, sub: string | undefined, values: Record<string, OptionValue | undefined>, focused?: string) {
    const specs = sub ? cmd.subcommands?.[sub]?.options : cmd.options;
    if (sub && !cmd.subcommands?.[sub]) throw new Error(`/${cmd.name} has no subcommand ${sub}`);
    const resolved: Raw = {};
    const guild = world.guild;
    const opts: Raw[] = [];
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const spec = specs?.[name];
      if (!spec) throw new Error(`/${cmd.name}${sub ? ` ${sub}` : ''} has no option "${name}"`);
      let v: unknown = value;
      if (typeof value === 'object') {
        if ('username' in value) {
          (resolved.users ??= {})[value.id] = discord.rawUser(value);
          if (guild.members.has(value.id)) (resolved.members ??= {})[value.id] = { ...discord.rawMember(guild, value.id, false), permissions: '0' };
        } else if ('type' in value && 'overwrites' in value) {
          (resolved.channels ??= {})[value.id] = { id: value.id, name: value.name, type: value.type, permissions: '0' };
        } else {
          (resolved.roles ??= {})[value.id] = discord.rawRole(value as FakeRole);
        }
        v = value.id;
      }
      opts.push({ type: spec.type, name, value: v, ...(focused === name ? { focused: true } : {}) });
    }
    const options = sub ? [{ type: ApplicationCommandOptionType.Subcommand, name: sub, options: opts }] : opts;
    return { options, resolved };
  }

  async function settle(rec: InteractionRecord) {
    await huddle.idle();
    return rec;
  }

  const t: TestBot = {
    discord,
    clock,
    db,
    log,
    huddle,
    client,
    ...world,
    async slash(name, values = {}, o = {}) {
      const cmd = o.unknown ? defineCommand({ name, description: 'unknown', async run() {} }) : commandType(name);
      if (!cmd || cmd.kind !== 'slash') throw new Error(`no slash command /${name}`);
      const as = o.as ?? world.alice;
      const channel = o.channel ?? world.general;
      const label = `/${name}${o.sub ? ` ${o.sub}` : ''}${Object.entries(values)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}:${typeof v === 'object' ? ('username' in v ? `@${v.username}` : `#${v.name}`) : v}`)
        .join('')}`;
      const rec = base('command', label, as, channel);
      const { options, resolved } = optionData(cmd, o.sub, values);
      packet('INTERACTION_CREATE', payload(rec, 2, { id: discord.snowflake(), name, type: ApplicationCommandType.ChatInput, options, ...(Object.keys(resolved).length ? { resolved } : {}) }));
      return settle(rec);
    },
    async autocomplete(name, option, typed, o = {}) {
      const cmd = commandType(name);
      if (!cmd || cmd.kind !== 'slash') throw new Error(`no slash command /${name}`);
      const rec = base('autocomplete', `/${name} ${option}:${typed}…`, o.as ?? world.alice, o.channel ?? world.general);
      const { options } = optionData(cmd, o.sub, { ...o.options, [option]: typed }, option);
      packet('INTERACTION_CREATE', payload(rec, 4, { id: discord.snowflake(), name, type: ApplicationCommandType.ChatInput, options }));
      return settle(rec);
    },
    async click(message, customId, o = {}) {
      const component = findComponent(message, customId);
      if (component.type !== ComponentType.Button) throw new Error(`${customId} is not a button`);
      if (component.disabled) throw new Error(`${customId} is disabled`);
      const channel = discord.channels.get(message.channel_id)!;
      const rec = base('component', `button ${component.label ?? customId}`, o.as ?? world.alice, channel, { sourceMessageId: message.id });
      packet('INTERACTION_CREATE', payload(rec, 3, { custom_id: customId, component_type: ComponentType.Button }, message));
      return settle(rec);
    },
    async select(message, customId, values, o = {}) {
      const component = findComponent(message, customId);
      const channel = discord.channels.get(message.channel_id)!;
      const rec = base('component', `select ${customId} = ${values.join(',')}`, o.as ?? world.alice, channel, { sourceMessageId: message.id });
      const resolved: Raw = {};
      for (const v of values) {
        if (component.type === ComponentType.RoleSelect) (resolved.roles ??= {})[v] = discord.rawRole(world.guild.roles.find((r) => r.id === v)!);
        if (component.type === ComponentType.ChannelSelect) {
          const c = discord.channels.get(v)!;
          (resolved.channels ??= {})[v] = { id: c.id, name: c.name, type: c.type, permissions: '0' };
        }
        if (component.type === ComponentType.UserSelect) (resolved.users ??= {})[v] = discord.rawUser(discord.users.get(v)!);
      }
      packet('INTERACTION_CREATE', payload(rec, 3, { custom_id: customId, component_type: component.type, values, ...(Object.keys(resolved).length ? { resolved } : {}) }, message));
      return settle(rec);
    },
    async submitModal(modal, values, o = {}) {
      const channel = o.message ? discord.channels.get(o.message.channel_id)! : (o.channel ?? world.general);
      const rec = base('modal', `modal ${modal.title}`, o.as ?? world.alice, channel, o.message ? { sourceMessageId: o.message.id } : {});
      // Answer each text input in the modal (labels or legacy action rows).
      const components = (modal.components as Raw[]).map((row) => {
        const input = row.type === ComponentType.Label ? row.component : row.components?.[0];
        if (!input || input.type !== ComponentType.TextInput) return row;
        const value = values[input.custom_id] ?? input.value ?? '';
        const answered = { type: ComponentType.TextInput, id: input.id, custom_id: input.custom_id, value };
        return row.type === ComponentType.Label ? { type: ComponentType.Label, id: row.id, component: answered } : { type: ComponentType.ActionRow, components: [answered] };
      });
      for (const k of Object.keys(values)) {
        if (!JSON.stringify(modal.components).includes(`"custom_id":"${k}"`)) throw new Error(`the modal has no field "${k}"`);
      }
      packet('INTERACTION_CREATE', payload(rec, 5, { custom_id: modal.custom_id, components }, o.message));
      return settle(rec);
    },
    async messageMenu(name, target, o = {}) {
      const channel = discord.channels.get(target.channel_id)!;
      const rec = base('menu', `Apps → ${name}`, o.as ?? world.alice, channel);
      const guildMember = target.member ? { [target.author.id]: target.member } : undefined;
      packet(
        'INTERACTION_CREATE',
        payload(rec, 2, {
          id: discord.snowflake(),
          name,
          type: ApplicationCommandType.Message,
          target_id: target.id,
          resolved: { messages: { [target.id]: target }, users: { [target.author.id]: target.author }, ...(guildMember ? { members: guildMember } : {}) },
        }),
      );
      return settle(rec);
    },
    async join(user) {
      discord.addMember(world.guild, user);
      packet('GUILD_MEMBER_ADD', { guild_id: world.guild.id, ...discord.rawMember(world.guild, user.id) });
      await huddle.idle();
    },
    async createRole(r) {
      const role = discord.addRole(world.guild, r);
      packet('GUILD_ROLE_CREATE', { guild_id: world.guild.id, role: discord.rawRole(role) });
      await huddle.idle();
      return role;
    },
    async deleteRole(role) {
      world.guild.roles = world.guild.roles.filter((r) => r.id !== role.id);
      for (const m of world.guild.members.values()) m.roles = m.roles.filter((id) => id !== role.id);
      packet('GUILD_ROLE_DELETE', { guild_id: world.guild.id, role_id: role.id });
      await huddle.idle();
    },
    async setRoles(user, roles) {
      world.guild.members.get(user.id)!.roles = roles.map((r) => r.id);
      packet('GUILD_MEMBER_UPDATE', { guild_id: world.guild.id, ...discord.rawMember(world.guild, user.id) });
      await huddle.idle();
    },
    async advance(ms) {
      clock.advance(ms);
      await huddle.idle();
      await huddle.bot.scheduler.runDue();
      await huddle.idle();
    },
    idle: () => huddle.idle(),
    problems: () => log.lines.filter((l) => l.level === 'warn' || l.level === 'error'),
    async stop() {
      await huddle.stop();
      if (!opts.db) db.close();
    },
  };
  opts.seed?.(t);
  return t;
}

function findComponent(message: FakeMessage, customId: string): Raw {
  for (const row of message.components ?? []) for (const c of row.components ?? []) if (c.custom_id === customId) return c;
  const ids = (message.components ?? []).flatMap((r: Raw) => (r.components ?? []).map((c: Raw) => c.custom_id ?? c.url));
  throw new Error(`no component ${customId} on the message (it has: ${ids.join(', ') || 'none'})`);
}

type World = Pick<TestBot, 'guild' | 'general' | 'welcomeChannel' | 'announcements' | 'roles' | 'owner' | 'mod' | 'alice' | 'bob'>;

function buildWorld(d: FakeDiscord): World {
  const P = PermissionFlagsBits;
  const owner = d.addUser({ username: 'sam', globalName: 'Sam' });
  const mod = d.addUser({ username: 'riley', globalName: 'Riley' });
  const alice = d.addUser({ username: 'alice', globalName: 'Alice' });
  const bob = d.addUser({ username: 'bob', globalName: 'Bob' });
  const guild = d.addGuild({ name: 'Maple Makers', ownerId: owner.id });
  const member = d.addRole(guild, { name: 'Member', color: 0x3fb27f });
  const moderator = d.addRole(guild, { name: 'Moderator', color: 0xe8a33d, permissions: P.ManageMessages | P.ModerateMembers | P.KickMembers });
  // The role Discord creates for the bot when it's invited (managed), with the invite's permissions.
  const botRole = d.addRole(guild, {
    name: 'Huddle',
    managed: true,
    permissions: P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory | P.ManageMessages | P.ManageRoles,
  });
  const admin = d.addRole(guild, { name: 'Admin', color: 0xe5534b, permissions: P.Administrator });
  const general = d.addChannel(guild, { name: 'general', topic: 'Chat about anything' });
  const welcomeChannel = d.addChannel(guild, { name: 'welcome' });
  const announcements = d.addChannel(guild, {
    name: 'announcements',
    type: 5,
    overwrites: [{ id: guild.id, type: 0, allow: 0n, deny: P.SendMessages }],
  });
  d.addMember(guild, owner, [member, admin], { joinedAt: d.clock.now() - 400 * 86_400_000 });
  d.addMember(guild, mod, [member, moderator], { joinedAt: d.clock.now() - 200 * 86_400_000 });
  d.addMember(guild, alice, [member], { joinedAt: d.clock.now() - 30 * 86_400_000 });
  d.addMember(guild, bob, [member], { joinedAt: d.clock.now() - 10 * 86_400_000 });
  d.addMember(guild, d.botUser, [botRole], { joinedAt: d.clock.now() - 30 * 86_400_000 });
  return { guild, general, welcomeChannel, announcements, roles: { member, moderator, admin, botRole }, owner, mod, alice, bob };
}

// The same world, for a second bot process on the same FakeDiscord (restart tests).
function recall(d: FakeDiscord): World {
  const guild = [...d.guilds.values()][0]!;
  const ch = (n: string) => [...d.channels.values()].find((c) => c.name === n && c.guildId === guild.id)!;
  const role = (n: string) => guild.roles.find((r) => r.name === n)!;
  const user = (n: string) => [...d.users.values()].find((u) => u.username === n)!;
  return {
    guild,
    general: ch('general'),
    welcomeChannel: ch('welcome'),
    announcements: ch('announcements'),
    roles: { member: role('Member'), moderator: role('Moderator'), admin: role('Admin'), botRole: role('Huddle') },
    owner: user('sam'),
    mod: user('riley'),
    alice: user('alice'),
    bob: user('bob'),
  };
}

// All the text in a message (content, embed titles, descriptions, fields,
// footers, button labels), for simple assertions.
export function textOf(m: Raw | undefined): string {
  if (!m) return '';
  const parts: string[] = [m.content ?? ''];
  for (const e of m.embeds ?? []) {
    parts.push(e.author?.name, e.title, e.description, ...(e.fields ?? []).flatMap((f: Raw) => [f.name, f.value]), e.footer?.text);
  }
  for (const row of m.components ?? []) for (const c of row.components ?? []) parts.push(c.label, c.placeholder);
  return parts.filter(Boolean).join('\n');
}

// The custom ids of a message's buttons and menus.
export function customIds(m: Raw | undefined): string[] {
  return (m?.components ?? []).flatMap((r: Raw) => (r.components ?? []).map((c: Raw) => c.custom_id).filter(Boolean));
}
