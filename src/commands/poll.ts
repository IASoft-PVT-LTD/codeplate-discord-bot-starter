// /poll: a question with 2-5 answers as buttons. One vote per member (click
// another answer to change it, the same one to take it back); the message
// shows a live tally. The author or a manager (/settings) can close it,
// and `duration` closes it automatically (a scheduler job, so it survives
// restarts).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { MessageCreateOptions } from 'discord.js';
import { z } from 'zod';
import { UserError, customId, defineCommand, job } from '../core/command.ts';
import { isManager } from '../core/guards.ts';
import type { Bot } from '../core/command.ts';
import { opt } from '../core/options.ts';
import { bar, discordTime, formatDuration, parseDuration, truncate } from '../core/text.ts';
import { embed } from '../core/ui.ts';
import type { Poll } from '../data/polls.ts';
import { closePoll, createPoll, getPoll, removeVote, setPollMessage, tally, vote } from '../data/polls.ts';

export const POLL_LIMITS = { minChoices: 2, maxChoices: 5, choiceLength: 80, maxDurationMs: 7 * 86_400_000 };

const choicesSchema = z
  .string()
  .transform((s) => s.split(/[;\n|]/).map((c) => c.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.string().max(POLL_LIMITS.choiceLength, `each answer can be at most ${POLL_LIMITS.choiceLength} characters`))
      .min(POLL_LIMITS.minChoices, `give at least ${POLL_LIMITS.minChoices} answers, separated by ;`)
      .max(POLL_LIMITS.maxChoices, `give at most ${POLL_LIMITS.maxChoices} answers`),
  );

const durationSchema = z
  .string()
  .transform((s) => parseDuration(s))
  .refine((ms) => ms !== null, 'use a duration like 30m, 2h or 1d')
  .refine((ms) => ms === null || (ms >= 60_000 && ms <= POLL_LIMITS.maxDurationMs), 'must be between 1 minute and 7 days')
  .transform((ms) => ms as number);

// The poll message: embed + buttons. Used when it's posted, after each vote, and when it closes.
export function pollMessage(poll: Poll, counts: number[]): Pick<MessageCreateOptions, 'embeds' | 'components'> {
  const total = counts.reduce((a, b) => a + b, 0);
  const closed = poll.closedAt !== null;
  const best = Math.max(...counts);
  const lines = poll.choices.map((choice, i) => {
    const n = counts[i] ?? 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const win = closed && total > 0 && n === best ? ' 🏆' : '';
    return `**${i + 1}. ${choice}**${win}\n\`${bar(total ? n / total : 0)}\` ${n} vote${n === 1 ? '' : 's'} · ${pct}%`;
  });
  const status = closed
    ? `Closed ${discordTime(poll.closedAt!, 'R')}`
    : poll.closesAt
      ? `Closes ${discordTime(poll.closesAt, 'R')}`
      : 'Open until the author closes it';
  const e = embed(closed ? 'muted' : 'brand')
    .setTitle(`${closed ? '🔒' : '📊'} ${poll.question}`)
    .setDescription(`${lines.join('\n\n')}\n\nAsked by <@${poll.authorId}> · ${status}`)
    .setFooter({ text: `${total} vote${total === 1 ? '' : 's'}${closed ? '' : ' · one per person; click again to change or take it back'}` });
  if (closed) return { embeds: [e], components: [] };
  const answers = new ActionRowBuilder<ButtonBuilder>().addComponents(
    poll.choices.map((c, i) =>
      new ButtonBuilder()
        .setCustomId(customId('poll', 'vote', poll.id, i))
        .setLabel(truncate(`${i + 1}. ${c}`, 80))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId('poll', 'close', poll.id)).setLabel('Close poll').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [e], components: [answers, controls] };
}

async function finish(bot: Bot, poll: Poll): Promise<Poll> {
  closePoll(bot.db, poll.id, bot.clock.now());
  for (const j of bot.scheduler.pending('poll:close')) {
    if ((JSON.parse(j.payload) as { pollId: number }).pollId === poll.id) bot.scheduler.cancel(j.id);
  }
  return getPoll(bot.db, poll.id)!;
}

function openPoll(bot: Bot, id: string | undefined): Poll {
  const poll = getPoll(bot.db, Number(id));
  if (!poll) throw new UserError('That poll no longer exists.');
  if (poll.closedAt !== null) throw new UserError('This poll is closed.');
  return poll;
}

export default defineCommand({
  name: 'poll',
  description: 'Ask a question; members vote with buttons and see the tally live',
  help: 'Answers are separated by ; and the poll can close by itself after a duration.',
  cooldown: 10,
  botPermissions: ['ViewChannel'],
  options: {
    question: opt.string('What to ask').max(200),
    answers: opt.string(`${POLL_LIMITS.minChoices}-${POLL_LIMITS.maxChoices} answers separated by ; (e.g. Pizza; Tacos; Salad)`).max(450).zod((s) => s.pipe(choicesSchema)),
    duration: opt.string('Close automatically after 30m, 2h, 1d… (max 7 days)').max(20).zod((s) => s.pipe(durationSchema)).optional(),
  },
  async run({ interaction, bot }, { question, answers, duration }) {
    const now = bot.clock.now();
    const poll = createPoll(bot.db, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      authorId: interaction.user.id,
      question,
      choices: answers,
      closesAt: duration ? now + duration : null,
      createdAt: now,
    });
    const res = await interaction.reply({ ...pollMessage(poll, tally(bot.db, poll)), withResponse: true });
    const messageId = res.resource?.message?.id;
    if (messageId) setPollMessage(bot.db, poll.id, messageId);
    if (duration) bot.scheduler.schedule('poll:close', now + duration, { pollId: poll.id });
  },
  components: {
    vote: {
      public: true,
      async run({ interaction, bot }, [pollId, choiceArg]) {
        const poll = openPoll(bot, pollId);
        const choice = Number(choiceArg);
        if (!(choice in poll.choices)) throw new UserError('That answer no longer exists.');
        const before = vote(bot.db, poll.id, interaction.user.id, choice, bot.clock.now());
        let note = `You voted for **${poll.choices[choice]}**.`;
        if (before === choice) {
          removeVote(bot.db, poll.id, interaction.user.id);
          note = 'Your vote was taken back.';
        } else if (before !== null) {
          note = `Changed your vote to **${poll.choices[choice]}**.`;
        }
        await interaction.update(pollMessage(poll, tally(bot.db, poll)));
        await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral });
      },
    },
    close: {
      public: true,
      async run({ interaction, bot, guild }, [pollId]) {
        const poll = openPoll(bot, pollId);
        if (poll.authorId !== interaction.user.id && !isManager(interaction.member, bot.settings.get(guild.id))) {
          throw new UserError('Only the person who asked, or a manager, can close this poll.');
        }
        const closed = await finish(bot, poll);
        await interaction.update(pollMessage(closed, tally(bot.db, closed)));
      },
    },
  },
  jobs: {
    // Closes a poll when its duration is up and updates its message.
    close: job({
      payload: z.object({ pollId: z.number().int() }),
      async run({ bot, log }, { pollId }) {
        const poll = getPoll(bot.db, pollId);
        if (!poll || poll.closedAt !== null) return;
        const closed = await finish(bot, poll);
        if (!closed.messageId) return;
        const channel = await bot.client.channels.fetch(closed.channelId).catch(() => null);
        if (!channel?.isTextBased()) {
          log.warn('poll channel is gone; closed the poll without updating its message', { pollId });
          return;
        }
        await channel.messages.edit(closed.messageId, pollMessage(closed, tally(bot.db, closed)));
        log.info('poll closed on time', { pollId, after: formatDuration(bot.clock.now() - closed.createdAt) });
      },
    }),
  },
});
