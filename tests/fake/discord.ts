// A fake Discord for the checks: no token, no network.
//
// It sits at the two edges of discord.js, so the real client and the real
// handlers run unchanged:
//   in:  gateway packets (READY, GUILD_CREATE, INTERACTION_CREATE,
//        GUILD_MEMBER_ADD) handed to the client's packet handlers;
//   out: discord.js's REST layer calls `makeRequest`, which this class
//        answers like Discord's HTTP API, keeping servers, channels, roles,
//        members and messages in memory, enforcing the permission rules that
//        matter, and recording every request (method, route and the exact JSON
//        body Discord would have received).
//
// Add a route in `route()` when a feature calls an endpoint that isn't here:
// an unknown route answers 404 and is listed in `unhandled` (tests fail on it).
import { PermissionFlagsBits } from 'discord.js';
import type { Clock } from '../../src/core/clock.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Discord API JSON */
export type Raw = Record<string, any>;

const DISCORD_EPOCH = 1_420_070_400_000n;
const ALL = Object.values(PermissionFlagsBits).reduce((a, b) => a | b, 0n);

export interface FakeUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  bot?: boolean;
}

export interface FakeRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: bigint;
  managed?: boolean;
  hoist?: boolean;
}

export interface Overwrite {
  id: string;
  type: 0 | 1; // 0 = role, 1 = member
  allow: bigint;
  deny: bigint;
}

export interface FakeChannel {
  id: string;
  guildId: string | null;
  name: string;
  type: number; // 0 text, 1 DM, 2 voice, 4 category, 5 announcement
  position: number;
  overwrites: Overwrite[];
  topic?: string;
  recipientId?: string;
}

export interface FakeMember {
  userId: string;
  nick: string | null;
  roles: string[];
  joinedAt: number;
}

export interface FakeGuild {
  id: string;
  name: string;
  ownerId: string;
  roles: FakeRole[];
  channels: string[];
  members: Map<string, FakeMember>;
}

export interface FakeMessage extends Raw {
  id: string;
  channel_id: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  status: number;
}

// What happened to one interaction: its response, follow-ups and edits.
export interface InteractionRecord {
  id: string;
  token: string;
  kind: 'command' | 'component' | 'modal' | 'autocomplete' | 'menu';
  label: string; // "/poll question:… answers:…", "button poll:vote:1:0", …
  userId: string;
  channelId: string;
  guildId: string;
  sourceMessageId?: string; // the message a component was on
  callbackType?: number; // 4 reply, 5 deferred, 6 deferred update, 7 update, 8 autocomplete, 9 modal
  ephemeral: boolean;
  reply?: FakeMessage; // the message created by type 4/5 (and edited later)
  updated?: FakeMessage; // the component's message after type 7
  modal?: Raw;
  choices?: { name: string; value: string | number }[];
  followUps: FakeMessage[];
}

export class DiscordApiError extends Error {
  status: number;
  code: number;
  constructor(status: number, code: number, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class FakeDiscord {
  readonly clock: Clock;
  readonly applicationId: string;
  readonly botUser: FakeUser;
  readonly users = new Map<string, FakeUser>();
  readonly guilds = new Map<string, FakeGuild>();
  readonly channels = new Map<string, FakeChannel>();
  // Channel id → messages, oldest first. Ephemeral messages aren't stored here.
  readonly messages = new Map<string, FakeMessage[]>();
  readonly interactions = new Map<string, InteractionRecord>();
  readonly requests: RecordedRequest[] = [];
  readonly unhandled: string[] = [];
  #seq = 0;

  constructor(clock: Clock) {
    this.clock = clock;
    this.applicationId = this.snowflake();
    this.botUser = this.addUser({ username: 'Huddle', bot: true, id: this.applicationId });
  }

  // --- ids ---------------------------------------------------------------

  // A real-looking snowflake: its timestamp is the fake clock's (or `at`), so
  // discord.js's createdTimestamp (used by bulk delete's 14-day rule) works.
  snowflake(at = this.clock.now()): string {
    this.#seq = (this.#seq + 1) % 4096;
    return (((BigInt(at) - DISCORD_EPOCH) << 22n) | BigInt(this.#seq)).toString();
  }

  // --- building the world --------------------------------------------------

  addUser(u: { username: string; globalName?: string; bot?: boolean; id?: string }): FakeUser {
    const id = u.id ?? this.snowflake();
    // People get an avatar hash, so avatar URLs name the user (the preview draws them).
    const user: FakeUser = { id, username: u.username, global_name: u.globalName ?? null, avatar: u.bot ? null : `f${id.slice(-6)}`, ...(u.bot ? { bot: true } : {}) };
    this.users.set(user.id, user);
    return user;
  }

  addGuild(g: { name: string; ownerId: string }): FakeGuild {
    const id = this.snowflake();
    const everyone = PermissionFlagsBits;
    const guild: FakeGuild = {
      id,
      name: g.name,
      ownerId: g.ownerId,
      // @everyone has the id of the server.
      roles: [
        {
          id,
          name: '@everyone',
          color: 0,
          position: 0,
          permissions:
            everyone.ViewChannel | everyone.SendMessages | everyone.ReadMessageHistory | everyone.EmbedLinks | everyone.AttachFiles | everyone.AddReactions | everyone.UseApplicationCommands,
        },
      ],
      channels: [],
      members: new Map(),
    };
    this.guilds.set(id, guild);
    return guild;
  }

  addRole(guild: FakeGuild, r: { name: string; permissions?: bigint; color?: number; managed?: boolean }): FakeRole {
    const role: FakeRole = { id: this.snowflake(), name: r.name, color: r.color ?? 0, position: guild.roles.length, permissions: r.permissions ?? 0n, managed: r.managed ?? false };
    guild.roles.push(role);
    return role;
  }

  addChannel(guild: FakeGuild, c: { name: string; type?: number; overwrites?: Overwrite[]; topic?: string }): FakeChannel {
    const channel: FakeChannel = { id: this.snowflake(), guildId: guild.id, name: c.name, type: c.type ?? 0, position: guild.channels.length, overwrites: c.overwrites ?? [], topic: c.topic };
    this.channels.set(channel.id, channel);
    guild.channels.push(channel.id);
    this.messages.set(channel.id, []);
    return channel;
  }

  addMember(guild: FakeGuild, user: FakeUser, roles: FakeRole[] = [], opts: { nick?: string; joinedAt?: number } = {}): FakeMember {
    const m: FakeMember = { userId: user.id, nick: opts.nick ?? null, roles: roles.map((r) => r.id), joinedAt: opts.joinedAt ?? this.clock.now() };
    guild.members.set(user.id, m);
    return m;
  }

  // Puts a message in a channel as if a user had sent it (for /purge, quotes…).
  postAs(user: FakeUser, channel: FakeChannel, content: string, opts: { at?: number; pinned?: boolean } = {}): FakeMessage {
    const at = opts.at ?? this.clock.now();
    const msg = this.#message(channel, user, { content }, at);
    msg.pinned = opts.pinned ?? false;
    this.#store(msg);
    return msg;
  }

  // --- permissions (Discord's rules: base, then channel overwrites) ----------

  basePermissions(guild: FakeGuild, userId: string): bigint {
    if (guild.ownerId === userId) return ALL;
    const member = guild.members.get(userId);
    let p = guild.roles[0]!.permissions;
    for (const rid of member?.roles ?? []) p |= guild.roles.find((r) => r.id === rid)?.permissions ?? 0n;
    return p & PermissionFlagsBits.Administrator ? ALL : p;
  }

  permissionsIn(channel: FakeChannel, userId: string): bigint {
    const guild = channel.guildId ? this.guilds.get(channel.guildId) : undefined;
    if (!guild) return ALL;
    let p = this.basePermissions(guild, userId);
    if (p === ALL) return ALL;
    const member = guild.members.get(userId);
    const apply = (o: Overwrite | undefined) => {
      if (o) p = (p & ~o.deny) | o.allow;
    };
    apply(channel.overwrites.find((o) => o.id === guild.id));
    let allow = 0n;
    let deny = 0n;
    for (const o of channel.overwrites) {
      if (o.type === 0 && o.id !== guild.id && member?.roles.includes(o.id)) {
        allow |= o.allow;
        deny |= o.deny;
      }
    }
    p = (p & ~deny) | allow;
    apply(channel.overwrites.find((o) => o.type === 1 && o.id === userId));
    return p;
  }

  #need(channel: FakeChannel, perms: bigint) {
    const have = this.permissionsIn(channel, this.botUser.id);
    if ((have & perms) !== perms) throw new DiscordApiError(403, 50013, 'Missing Permissions');
  }

  highestRolePosition(guild: FakeGuild, userId: string): number {
    const m = guild.members.get(userId);
    return Math.max(0, ...(m?.roles ?? []).map((rid) => guild.roles.find((r) => r.id === rid)?.position ?? 0));
  }

  // --- raw API objects -------------------------------------------------------

  rawUser(u: FakeUser): Raw {
    return { id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar, discriminator: '0', bot: u.bot ?? false, public_flags: 0 };
  }

  rawMember(guild: FakeGuild, userId: string, withUser = true): Raw {
    const m = guild.members.get(userId);
    if (!m) throw new Error(`no member ${userId}`);
    return {
      ...(withUser ? { user: this.rawUser(this.users.get(userId)!) } : {}),
      nick: m.nick,
      roles: m.roles,
      joined_at: new Date(m.joinedAt).toISOString(),
      deaf: false,
      mute: false,
      flags: 0,
      pending: false,
      avatar: null,
    };
  }

  rawRole(r: FakeRole): Raw {
    return { id: r.id, name: r.name, color: r.color, colors: { primary_color: r.color, secondary_color: null, tertiary_color: null }, hoist: r.hoist ?? false, position: r.position, permissions: r.permissions.toString(), managed: r.managed ?? false, mentionable: false, flags: 0 };
  }

  rawChannel(c: FakeChannel): Raw {
    if (c.type === 1) return { id: c.id, type: 1, recipients: [this.rawUser(this.users.get(c.recipientId!)!)], last_message_id: null };
    return {
      id: c.id,
      type: c.type,
      guild_id: c.guildId,
      name: c.name,
      position: c.position,
      topic: c.topic ?? null,
      nsfw: false,
      parent_id: null,
      permission_overwrites: c.overwrites.map((o) => ({ id: o.id, type: o.type, allow: o.allow.toString(), deny: o.deny.toString() })),
    };
  }

  rawGuild(g: FakeGuild): Raw {
    return {
      id: g.id,
      name: g.name,
      icon: null,
      owner_id: g.ownerId,
      afk_timeout: 300,
      verification_level: 1,
      default_message_notifications: 1,
      explicit_content_filter: 2,
      mfa_level: 0,
      nsfw_level: 0,
      premium_tier: 0,
      preferred_locale: 'en-US',
      features: [],
      roles: g.roles.map((r) => this.rawRole(r)),
      emojis: [],
      stickers: [],
      channels: g.channels.map((id) => this.rawChannel(this.channels.get(id)!)),
      threads: [],
      members: [...g.members.keys()].map((uid) => this.rawMember(g, uid)),
      member_count: g.members.size,
      presences: [],
      voice_states: [],
      stage_instances: [],
      guild_scheduled_events: [],
      soundboard_sounds: [],
      joined_at: new Date(this.clock.now()).toISOString(),
      large: false,
      unavailable: false,
    };
  }

  #message(channel: FakeChannel, author: FakeUser, body: Raw, at = this.clock.now()): FakeMessage {
    return {
      id: this.snowflake(at),
      type: 0,
      channel_id: channel.id,
      ...(channel.guildId ? { guild_id: channel.guildId } : {}),
      author: this.rawUser(author),
      ...(channel.guildId && this.guilds.get(channel.guildId)?.members.has(author.id) ? { member: this.rawMember(this.guilds.get(channel.guildId)!, author.id, false) } : {}),
      content: body.content ?? '',
      embeds: body.embeds ?? [],
      components: body.components ?? [],
      attachments: [],
      mentions: [],
      mention_roles: [],
      mention_everyone: false,
      pinned: false,
      tts: false,
      timestamp: new Date(at).toISOString(),
      edited_timestamp: null,
      flags: body.flags ?? 0,
    };
  }

  #store(msg: FakeMessage) {
    const list = this.messages.get(msg.channel_id);
    if (!list) throw new DiscordApiError(404, 10003, 'Unknown Channel');
    list.push(msg);
  }

  #findMessage(channelId: string, id: string): FakeMessage {
    const m = this.messages.get(channelId)?.find((x) => x.id === id) ?? this.#ephemeral.get(id);
    if (!m) throw new DiscordApiError(404, 10008, 'Unknown Message');
    return m;
  }

  // Ephemeral messages: only the interaction's user sees them; not in channel history.
  #ephemeral = new Map<string, FakeMessage>();

  // Every message in a channel (oldest first), including ephemeral ones if asked.
  channelMessages(channelId: string, opts: { ephemeral?: boolean } = {}): FakeMessage[] {
    const visible = this.messages.get(channelId) ?? [];
    if (!opts.ephemeral) return [...visible];
    return [...visible, ...[...this.#ephemeral.values()].filter((m) => m.channel_id === channelId)].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }

  lastMessage(channelId: string): FakeMessage | undefined {
    return this.messages.get(channelId)?.at(-1);
  }

  // --- interactions ----------------------------------------------------------

  newInteraction(r: Omit<InteractionRecord, 'id' | 'token' | 'followUps' | 'ephemeral'>): InteractionRecord {
    const id = this.snowflake();
    const rec: InteractionRecord = { ...r, id, token: `fake-interaction-token-${id}`, followUps: [], ephemeral: false };
    this.interactions.set(id, rec);
    return rec;
  }

  #interactionByToken(token: string): InteractionRecord {
    for (const r of this.interactions.values()) if (r.token === token) return r;
    throw new DiscordApiError(401, 50027, 'Invalid Webhook Token');
  }

  #replyMessage(rec: InteractionRecord, body: Raw, type: number): FakeMessage {
    const channel = this.channels.get(rec.channelId)!;
    const msg = this.#message(channel, this.botUser, body);
    msg.type = type;
    msg.webhook_id = this.applicationId;
    msg.application_id = this.applicationId;
    msg.interaction_metadata = { id: rec.id, type: 2, user: this.rawUser(this.users.get(rec.userId)!), authorizing_integration_owners: { 0: rec.guildId } };
    const ephemeral = ((body.flags ?? 0) & 64) === 64;
    if (ephemeral) this.#ephemeral.set(msg.id, msg);
    else this.#store(msg);
    return msg;
  }

  #edit(msg: FakeMessage, body: Raw): FakeMessage {
    for (const k of ['content', 'embeds', 'components'] as const) if (k in body) msg[k] = body[k] ?? (k === 'content' ? '' : []);
    msg.edited_timestamp = new Date(this.clock.now()).toISOString();
    return msg;
  }

  // --- the HTTP API --------------------------------------------------------

  // discord.js's REST `makeRequest` option.
  makeRequest = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v\d+/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = await parseBody(init.body);
    const query = Object.fromEntries(u.searchParams);
    let status = 200;
    let out: unknown;
    try {
      out = this.route(method, path, query, body);
      if (out === undefined) status = 204;
    } catch (err) {
      if (!(err instanceof DiscordApiError)) throw err;
      status = err.status;
      out = { message: err.message, code: err.code };
      if (err.code === 0) this.unhandled.push(`${method} ${path}`);
    }
    this.requests.push({ method, path, query, body, status });
    // Like Discord: 204 has no body and no content type.
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
  };

  route(method: string, path: string, query: Record<string, string>, body: Raw): unknown {
    const p = path.split('/').filter(Boolean).map(decodeURIComponent);
    const is = (m: string, pattern: string) => {
      if (m !== method) return false;
      const parts = pattern.split('/').filter(Boolean);
      return parts.length === p.length && parts.every((x, i) => x.startsWith(':') || x === p[i]);
    };

    // Interaction responses (the 3-second reply).
    if (is('POST', '/interactions/:id/:token/callback')) {
      const rec = this.interactions.get(p[1]!);
      if (!rec || rec.token !== p[2]) throw new DiscordApiError(404, 10062, 'Unknown interaction');
      if (rec.callbackType !== undefined) throw new DiscordApiError(400, 40060, 'Interaction has already been acknowledged.');
      rec.callbackType = body.type;
      const data: Raw = body.data ?? {};
      let message: FakeMessage | undefined;
      switch (body.type) {
        case 4: // reply
        case 5: // "thinking…", edited later
          rec.ephemeral = ((data.flags ?? 0) & 64) === 64;
          message = rec.reply = this.#replyMessage(rec, body.type === 5 ? { ...data, content: '' } : data, rec.kind === 'command' ? 20 : 19);
          break;
        case 6: // acknowledge a component, no change yet
          break;
        case 7: // update the component's message
          message = rec.updated = this.#edit(this.#findMessage(rec.channelId, rec.sourceMessageId!), data);
          break;
        case 8:
          rec.choices = data.choices ?? [];
          break;
        case 9:
          rec.modal = data;
          break;
        default:
          throw new DiscordApiError(400, 50035, `Invalid interaction response type ${body.type}`);
      }
      if (query.with_response !== 'true') return undefined;
      return {
        interaction: { id: rec.id, type: 2, activity_instance_id: null, response_message_id: message?.id ?? null, response_message_loading: body.type === 5, response_message_ephemeral: rec.ephemeral },
        resource: message ? { type: body.type, message } : { type: body.type },
      };
    }

    // Follow-ups and edits of interaction replies (webhook routes).
    if (p[0] === 'webhooks' && p[1] === this.applicationId && p[2]) {
      const rec = this.#interactionByToken(p[2]);
      if (is('POST', '/webhooks/:app/:token')) {
        const msg = this.#replyMessage(rec, body, 0);
        rec.followUps.push(msg);
        return msg;
      }
      if (p[3] === 'messages' && p[4]) {
        const msg = p[4] === '@original' ? (rec.reply ?? rec.updated) : this.#findMessage(rec.channelId, p[4]);
        if (!msg) throw new DiscordApiError(404, 10008, 'Unknown Message');
        if (method === 'GET') return msg;
        if (method === 'PATCH') return this.#edit(msg, body);
        if (method === 'DELETE') {
          this.#delete(msg.channel_id, msg.id);
          return undefined;
        }
      }
    }

    if (is('GET', '/users/:id')) {
      const user = this.users.get(p[1] === '@me' ? this.botUser.id : p[1]!);
      if (!user) throw new DiscordApiError(404, 10013, 'Unknown User');
      return this.rawUser(user);
    }

    if (is('POST', '/users/@me/channels')) {
      const recipient = this.users.get(body.recipient_id);
      if (!recipient) throw new DiscordApiError(404, 10013, 'Unknown User');
      let dm = [...this.channels.values()].find((c) => c.type === 1 && c.recipientId === recipient.id);
      if (!dm) {
        dm = { id: this.snowflake(), guildId: null, name: '', type: 1, position: 0, overwrites: [], recipientId: recipient.id };
        this.channels.set(dm.id, dm);
        this.messages.set(dm.id, []);
      }
      return this.rawChannel(dm);
    }

    if (p[0] === 'channels' && p[1]) {
      const channel = this.channels.get(p[1]);
      if (!channel) throw new DiscordApiError(404, 10003, 'Unknown Channel');
      if (is('GET', '/channels/:id')) return this.rawChannel(channel);
      if (is('POST', '/channels/:id/messages')) {
        this.#need(channel, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages);
        if (body.embeds?.length) this.#need(channel, PermissionFlagsBits.EmbedLinks);
        const msg = this.#message(channel, this.botUser, body);
        this.#store(msg);
        return msg;
      }
      if (is('GET', '/channels/:id/messages')) {
        this.#need(channel, PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory);
        const limit = Math.min(Number(query.limit ?? 50), 100);
        return [...(this.messages.get(channel.id) ?? [])].reverse().slice(0, limit);
      }
      if (is('GET', '/channels/:id/messages/:mid')) return this.#findMessage(channel.id, p[3]!);
      if (is('PATCH', '/channels/:id/messages/:mid')) {
        const msg = this.#findMessage(channel.id, p[3]!);
        if (msg.author.id !== this.botUser.id) throw new DiscordApiError(403, 50005, 'Cannot edit a message authored by another user');
        return this.#edit(msg, body);
      }
      if (is('DELETE', '/channels/:id/messages/:mid')) {
        const msg = this.#findMessage(channel.id, p[3]!);
        if (msg.author.id !== this.botUser.id) this.#need(channel, PermissionFlagsBits.ManageMessages);
        this.#delete(channel.id, msg.id);
        return undefined;
      }
      if (is('POST', '/channels/:id/messages/bulk-delete')) {
        this.#need(channel, PermissionFlagsBits.ManageMessages);
        const ids: string[] = body.messages ?? [];
        if (ids.length < 2 || ids.length > 100) throw new DiscordApiError(400, 50016, 'You must provide between 2 and 100 messages to delete');
        const cutoff = this.clock.now() - 14 * 86_400_000;
        for (const id of ids) {
          const at = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
          if (at < cutoff) throw new DiscordApiError(400, 50034, 'You can only bulk delete messages that are under 14 days old.');
        }
        for (const id of ids) this.#delete(channel.id, id);
        return undefined;
      }
    }

    if (p[0] === 'guilds' && p[1]) {
      const guild = this.guilds.get(p[1]);
      if (!guild) throw new DiscordApiError(404, 10004, 'Unknown Guild');
      if (is('GET', '/guilds/:id/members/:uid')) {
        if (!guild.members.has(p[3]!)) throw new DiscordApiError(404, 10007, 'Unknown Member');
        return this.rawMember(guild, p[3]!);
      }
      if (is('PUT', '/guilds/:id/members/:uid/roles/:rid') || is('DELETE', '/guilds/:id/members/:uid/roles/:rid')) {
        const member = guild.members.get(p[3]!);
        const role = guild.roles.find((r) => r.id === p[5]);
        if (!member) throw new DiscordApiError(404, 10007, 'Unknown Member');
        if (!role) throw new DiscordApiError(404, 10011, 'Unknown Role');
        const perms = this.basePermissions(guild, this.botUser.id);
        if (!(perms & PermissionFlagsBits.ManageRoles) || role.managed || this.highestRolePosition(guild, this.botUser.id) <= role.position) {
          throw new DiscordApiError(403, 50013, 'Missing Permissions');
        }
        if (method === 'PUT' && !member.roles.includes(role.id)) member.roles.push(role.id);
        if (method === 'DELETE') member.roles = member.roles.filter((r) => r !== role.id);
        return undefined;
      }
    }

    // Command registration (npm run register).
    if (is('PUT', '/applications/:app/commands') || is('PUT', '/applications/:app/guilds/:gid/commands')) {
      if (p[1] !== this.applicationId) throw new DiscordApiError(404, 10002, 'Unknown Application');
      return (body as unknown as Raw[]).map((c) => ({ ...c, id: this.snowflake(), application_id: this.applicationId, version: this.snowflake() }));
    }

    throw new DiscordApiError(404, 0, `The fake Discord has no route for ${method} ${path}. Add it in tests/fake/discord.ts.`);
  }

  #delete(channelId: string, id: string) {
    const list = this.messages.get(channelId);
    if (list) {
      const i = list.findIndex((m) => m.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        return;
      }
    }
    if (!this.#ephemeral.delete(id)) throw new DiscordApiError(404, 10008, 'Unknown Message');
  }
}

async function parseBody(body: RequestInit['body']): Promise<Raw> {
  if (body == null) return {};
  if (typeof body === 'string') return body ? JSON.parse(body) : {};
  if (body instanceof FormData) {
    const json = body.get('payload_json');
    return typeof json === 'string' ? JSON.parse(json) : {};
  }
  if (body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(body));
  return {};
}
