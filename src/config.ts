// Everything about the bot that isn't code: its name, colors, words, and the
// environment variables it reads. Change the bot's identity here.
import { z } from 'zod';

export const BOT = {
  name: 'Huddle',
  tagline: 'A friendly helper for small community servers: polls, reminders, welcomes, saved answers and quotes.',
  version: '1.0.0',
  // Embed colors (0xRRGGBB). `brand` is the default accent.
  colors: {
    brand: 0x5b8def,
    ok: 0x3fb27f,
    warn: 0xe8a33d,
    error: 0xe5534b,
    muted: 0x4e5058,
  },
  // The free CodePlate license asks for this credit wherever the bot describes
  // itself: /about and the footer of /help. Keep it (tests/commands/credit.test.ts).
  credit: 'Built with CodePlate (codeplate.io)',
  creditUrl: 'https://codeplate.io',
  // The community's time zone, an IANA name: 'UTC', 'Europe/London',
  // 'America/New_York', 'Asia/Kolkata'… Used for "every Monday at 09:00"
  // (repeating jobs keep local time when the clocks change), times members type
  // ("18:30", "tomorrow 9am") and times written as plain text (embed footers).
  // Discord's own <t:…> timestamps already show in each reader's zone.
  timezone: 'UTC',
} as const;

// Environment variables. Every one is documented in .env.example (the checks
// fail otherwise). Read them only through `loadEnv()`.
const EnvSchema = z.object({
  // The bot token from the Developer Portal (Bot → Reset Token). Only needed to
  // run the bot or register commands; the checks never use one.
  DISCORD_TOKEN: z.string().optional(),
  // The application id (General Information → Application ID).
  DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/, 'must be the numeric Application ID').optional(),
  // A test server's id: `npm run register` puts the commands there instantly
  // instead of globally.
  DEV_GUILD_ID: z.string().regex(/^\d{17,20}$/, 'must be a numeric server id').optional(),
  DATABASE_PATH: z.string().default('.data/bot.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
});

export type Env = z.infer<typeof EnvSchema>;

// Every variable the bot reads (the checks compare this with .env.example).
export const ENV_KEYS = Object.keys(EnvSchema.shape);

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Empty strings (copied from .env.example) mean "not set".
  const cleaned = Object.fromEntries(ENV_KEYS.map((k) => [k, source[k]]).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment (see .env.example):\n${lines.join('\n')}`);
  }
  return parsed.data;
}
