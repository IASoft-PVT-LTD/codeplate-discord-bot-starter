// How the bot's messages look: embed colors and the small reply helpers every
// command uses, so the whole bot reads the same. Change colors in src/config.ts.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { InteractionReplyOptions } from 'discord.js';
import { BOT } from '../config.ts';

export type Tone = keyof typeof BOT.colors;

export function embed(tone: Tone = 'brand'): EmbedBuilder {
  return new EmbedBuilder().setColor(BOT.colors[tone]);
}

// A private reply (only the user who ran the command sees it).
export function privately(payload: Omit<InteractionReplyOptions, 'flags'>): InteractionReplyOptions & { flags: MessageFlags.Ephemeral } {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

export function okReply(text: string) {
  return privately({ embeds: [embed('ok').setDescription(`✅ ${text}`)] });
}

export function errorReply(text: string) {
  return privately({ embeds: [embed('error').setDescription(`⚠️ ${text}`)] });
}

// Mentions in bot messages never ping @everyone or roles unless a command says so.
export const NO_PINGS = { parse: [] as never[] };
