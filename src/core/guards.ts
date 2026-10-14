// Checks that run before every handler: the member's permissions, who they are
// (`who: 'manager' | 'owner'`), the bot's permissions and cooldowns. A failed
// check returns the message to show the user (privately); null means "go ahead".
import type { BaseInteraction, Guild, GuildMember, PermissionsString } from 'discord.js';
import type { Access, Who } from './command.ts';
import type { Clock } from './clock.ts';
import type { GuildSettings } from './settings.ts';
import { discordTime, permissionName } from './text.ts';

export function checkPermissions(interaction: BaseInteraction<'cached'>, access: Access): string | null {
  const member = access.memberPermissions ?? [];
  if (member.length) {
    // memberPermissions: the member's permissions in this channel (roles and channel overrides).
    const missing = interaction.memberPermissions.missing(member);
    if (missing.length) return `You need the **${list(missing)}** permission to do this.`;
  }
  const bot = access.botPermissions ?? [];
  if (bot.length) {
    // appPermissions: the bot's permissions in this channel.
    const missing = interaction.appPermissions.missing(bot);
    if (missing.length) {
      return `I need the **${list(missing)}** permission in this channel. Ask a server admin to give my role that permission (Server Settings → Roles), then try again.`;
    }
  }
  return null;
}

function list(perms: PermissionsString[]): string {
  return perms.map(permissionName).join('**, **');
}

// The manager role that counts right now: the one the owner picked, if it
// still exists in the server; otherwise null (Manage Server counts instead).
export function managerRole(guild: Guild, settings: GuildSettings): string | null {
  const id = settings.managers.roleId;
  return id && guild.roles.cache.has(id) ? id : null;
}

// Is this member one of the server's managers? The owner and Administrators
// always are; then the manager role if one is set, else Manage Server.
// Use it for data-dependent rules ("the author or a manager").
export function isManager(member: GuildMember, settings: GuildSettings): boolean {
  const guild = member.guild;
  if (guild.ownerId === member.id || member.permissions.has('Administrator')) return true;
  const role = managerRole(guild, settings);
  return role ? member.roles.cache.has(role) : member.permissions.has('ManageGuild');
}

// The `who` check. Returns the message to show, or null.
export function checkWho(member: GuildMember, who: Who | undefined, settings: GuildSettings): string | null {
  if (!who) return null;
  if (who === 'owner') return member.guild.ownerId === member.id ? null : 'Only the server owner can do this.';
  if (isManager(member, settings)) return null;
  const role = managerRole(member.guild, settings);
  return role
    ? `Only managers (members with <@&${role}>) can do this. The server owner picks the manager role with \`/settings manager-role\`.`
    : 'Only members with the **Manage Server** permission can do this (or the manager role, once the server owner picks one with `/settings manager-role`).';
}

// Everything the router checks about the member (not the bot, not cooldowns),
// as a yes/no: /help uses it to list only what the member can run.
export function memberMay(interaction: BaseInteraction<'cached'>, access: Access, settings: GuildSettings): boolean {
  return interaction.memberPermissions.has(access.memberPermissions ?? []) && checkWho(interaction.member, access.who, settings) === null;
}

// Per-member cooldowns, kept in memory (they reset when the bot restarts,
// which is fine for spam control).
export class Cooldowns {
  #until = new Map<string, number>();
  #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  // Returns a message if the member must wait; otherwise starts the cooldown.
  take(key: string, userId: string, seconds: number | undefined): string | null {
    if (!seconds) return null;
    const now = this.#clock.now();
    const k = `${key}:${userId}`;
    const until = this.#until.get(k) ?? 0;
    if (until > now) return `Slow down a little: you can use this again ${discordTime(until, 'R')}.`;
    this.#until.set(k, now + seconds * 1000);
    if (this.#until.size > 10_000) for (const [kk, t] of this.#until) if (t <= now) this.#until.delete(kk);
    return null;
  }
}
