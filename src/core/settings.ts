// Per-server settings: one typed object per server, stored as JSON in the
// `guild_settings` table. The schema below is the single source of truth: its
// defaults apply to servers that never changed a setting, and unknown or
// invalid stored values fall back to the defaults (with a warning) instead of
// crashing. Add a setting: add a field with a default here, read it with
// `bot.settings.get(guildId).<group>.<field>`. No migration is needed.
// See docs/recipes/per-server-settings.md.
import { z } from 'zod';
import type { Clock } from './clock.ts';
import type { Db } from './db.ts';
import type { Logger } from './log.ts';

const snowflake = z.string().regex(/^\d{17,20}$/);

export const GuildSettingsSchema = z.object({
  welcome: z
    .object({
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      // A role given to every new member (the bot's role must be above it).
      roleId: snowflake.nullable().default(null),
      // {user} = a mention of the new member, {name} = their display name,
      // {server} = the server's name, {count} = the member count.
      message: z.string().max(1000).default('Welcome to **{server}**, {user}! You are member #{count}. Say hi and tell us what brings you here.'),
    })
    .prefault({}),
  // Who runs the bot in this server (`who: 'manager'` on a command, see
  // src/core/guards.ts). The server owner picks the role with /settings
  // manager-role; null (or a deleted role) means Manage Server counts.
  managers: z.object({ roleId: snowflake.nullable().default(null) }).prefault({}),
});

export type GuildSettings = z.infer<typeof GuildSettingsSchema>;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object | null ? (T[K] extends null ? T[K] : DeepPartial<T[K]> | T[K]) : T[K] };

export interface Settings {
  get(guildId: string): GuildSettings;
  update(guildId: string, patch: DeepPartial<GuildSettings>): GuildSettings;
  reset(guildId: string): void;
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch) || base === null || typeof base !== 'object') return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
  return out;
}

export function createSettings(opts: { db: Db; clock: Clock; log: Logger }): Settings {
  const { db, clock, log } = opts;
  const read = db.prepare('SELECT data FROM guild_settings WHERE guild_id = ?');
  const write = db.prepare(
    'INSERT INTO guild_settings (guild_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  );

  function get(guildId: string): GuildSettings {
    const row = read.get(guildId) as { data: string } | undefined;
    const stored: unknown = row ? JSON.parse(row.data) : {};
    const parsed = GuildSettingsSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    log.warn('stored settings are invalid; using defaults for the invalid parts', { guildId, issues: parsed.error.issues.map((i) => i.path.join('.')) });
    // Keep the valid groups, reset the broken ones.
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(GuildSettingsSchema.shape)) {
      const r = schema.safeParse((stored as Record<string, unknown>)[key]);
      out[key] = r.success ? r.data : schema.parse(undefined);
    }
    return out as GuildSettings;
  }

  return {
    get,
    update(guildId, patch) {
      const next = GuildSettingsSchema.parse(merge(get(guildId), patch));
      write.run(guildId, JSON.stringify(next), clock.now());
      return next;
    },
    reset(guildId) {
      db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
    },
  };
}
