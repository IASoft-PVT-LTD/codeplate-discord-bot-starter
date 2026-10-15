// Registering commands with Discord, and the invite link. Used by
// scripts/register.ts and scripts/invite.ts (and tested against the fake Discord).
import { OAuth2Scopes, PermissionsBitField, Routes } from 'discord.js';
import type { PermissionsString, REST } from 'discord.js';
import type { AnyCommand } from './command.ts';
import { allCommandJson } from './definitions.ts';

// Sends every command definition. With a guildId they appear in that server
// at once (best while developing); without, globally (can take a minute to show up).
// PUT replaces the whole list, so removed commands disappear too.
export async function registerCommands(rest: REST, applicationId: string, commands: readonly AnyCommand[], guildId?: string): Promise<number> {
  const body = allCommandJson(commands);
  const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
  const result = (await rest.put(route, { body })) as unknown[];
  return result.length;
}

// What the bot needs outside any one command (posting reminders and welcomes,
// giving the welcome auto-role), plus every command's botPermissions.
export const BASE_PERMISSIONS: PermissionsString[] = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageRoles'];

export function invitePermissions(commands: readonly AnyCommand[], extra: PermissionsString[] = []): PermissionsBitField {
  const perms = new Set<PermissionsString>([...BASE_PERMISSIONS, ...extra]);
  for (const c of commands) {
    for (const p of c.botPermissions ?? []) perms.add(p);
    if (c.kind === 'slash') for (const s of Object.values(c.subcommands ?? {})) for (const p of s.botPermissions ?? []) perms.add(p);
  }
  return new PermissionsBitField([...perms]);
}

export function inviteUrl(applicationId: string, permissions: PermissionsBitField): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    scope: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '),
    permissions: permissions.bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}
