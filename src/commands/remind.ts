// /remind: "remind me in 2h to post the meeting notes", "remind me at 18:30",
// or "every Monday at 09:00". Reminders are stored with a scheduler job, so
// they fire even if the bot restarted in between (late ones say so). Times of
// day are in the bot's time zone (BOT.timezone, src/config.ts). /remind list
// and /remind cancel manage your own.
import { z } from 'zod';
import { UserError, defineCommand, job, subcommand } from '../core/command.ts';
import { opt } from '../core/options.ts';
import { discordTime, formatDuration, parseDuration, truncate } from '../core/text.ts';
import { WEEKDAYS, describeRepeat, formatDateTime, hhmm, nextOccurrence, parseTime, parseWhen, toLocal, zoneName } from '../core/time.ts';
import type { Repeat } from '../core/time.ts';
import { embed, okReply, privately } from '../core/ui.ts';
import type { Reminder } from '../data/reminders.ts';
import { addReminder, deleteReminder, getReminder, markSent, pendingReminders, setReminderDue, setReminderJob } from '../data/reminders.ts';

export const REMIND_LIMITS = { minMs: 60_000, maxMs: 365 * 86_400_000, perMember: 25 };

// "every Monday at 09:00 (UTC)"
function repeatText(rule: Repeat, zone: string, now: number): string {
  return `${describeRepeat(rule)} (${zone === 'UTC' ? 'UTC' : `${zone}, ${zoneName(now, zone)}`})`;
}

// `when`: a duration ("2h", checked here) or a time of day ("18:30", "tomorrow 9am",
// "2026-10-20 18:30"; only its form is checked here, the handler reads it in the
// bot's time zone). Problems found here don't cost the member a cooldown.
const whenSchema = z.string().transform((text, ctx): { in: number } | { at: string } => {
  const ms = parseDuration(text);
  if (ms !== null) {
    if (ms < REMIND_LIMITS.minMs || ms > REMIND_LIMITS.maxMs) ctx.addIssue({ code: 'custom', message: 'must be between 1 minute and 1 year' });
    return { in: ms };
  }
  if (parseWhen(text, 0, 'UTC') === null) ctx.addIssue({ code: 'custom', message: 'use a duration like 10m, 2h or 1d 4h, or a time like 18:30, tomorrow 9am or 2026-10-20 18:30' });
  return { at: text };
});

function checkLimit(reminders: Reminder[]) {
  if (reminders.length >= REMIND_LIMITS.perMember) {
    throw new UserError(`You have ${reminders.length} reminders waiting (the limit is ${REMIND_LIMITS.perMember}). Cancel one with /remind cancel.`);
  }
}

export default defineCommand({
  name: 'remind',
  description: 'Get a reminder in this channel later, even if the bot restarts',
  subcommands: {
    me: subcommand({
      description: 'Remind me once: in 2h, at 18:30, tomorrow 9am…',
      cooldown: 3,
      options: {
        when: opt
          .string('In 10m, 2h, 1d 4h… or at 18:30, tomorrow 9am, 2026-10-20 18:30')
          .max(40)
          .zod((s) => s.pipe(whenSchema)),
        what: opt.string('What to remind you about').max(500),
      },
      async run({ interaction, bot }, { when, what }) {
        const now = bot.clock.now();
        const zone = bot.timezone;
        // A time of day is read on the bot's clock (BOT.timezone) now that we know "now".
        const at = 'in' in when ? { ms: now + when.in, exact: true } : parseWhen(when.at, now, zone)!;
        if (at.ms - now < REMIND_LIMITS.minMs || at.ms - now > REMIND_LIMITS.maxMs) throw new UserError('That time must be between 1 minute and 1 year from now.');
        checkLimit(pendingReminders(bot.db, interaction.guildId, interaction.user.id));
        const r = addReminder(bot.db, { guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id, text: what, dueAt: at.ms, createdAt: now });
        setReminderJob(bot.db, r.id, bot.scheduler.schedule('remind:fire', r.dueAt, { reminderId: r.id }));
        // A time inside a clock change ("02:30" on the night the clocks go forward) doesn't exist: say what we picked.
        const shifted = at.exact ? '' : ` That time doesn't exist that night (the clocks go forward), so I picked ${hhmm(toLocal(at.ms, zone))}.`;
        await interaction.reply(okReply(`I'll remind you ${discordTime(r.dueAt, 'R')} (${discordTime(r.dueAt, 'f')}): ${truncate(what, 200)}${shifted}`));
      },
    }),
    every: subcommand({
      description: 'Remind me here every day or every week at a time',
      cooldown: 3,
      options: {
        day: opt.string('Which day').choices({ name: 'Every day', value: 'day' }, ...WEEKDAYS.map((d, i) => ({ name: d, value: String(i) }))),
        time: opt
          .string('Time of day, e.g. 09:00 or 6:30pm')
          .max(10)
          .zod((s) =>
            s
              .transform((v) => parseTime(v))
              .refine((t) => t !== null, 'use a time like 09:00, 18:30 or 6:30pm')
              .transform((t) => hhmm(t!)),
          ),
        what: opt.string('What to remind you about').max(500),
      },
      async run({ interaction, bot }, { day, time, what }) {
        checkLimit(pendingReminders(bot.db, interaction.guildId, interaction.user.id));
        const rule: Repeat = day === 'day' ? { every: 'day', at: time } : { every: 'week', day: Number(day), at: time };
        const now = bot.clock.now();
        const first = nextOccurrence(rule, now, bot.timezone); // the scheduler's first run, too
        const r = addReminder(bot.db, { guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id, text: what, dueAt: first, createdAt: now, repeat: rule });
        setReminderJob(bot.db, r.id, bot.scheduler.repeat('remind:fire', rule, { reminderId: r.id }));
        await interaction.reply(
          okReply(`I'll remind you here ${repeatText(rule, bot.timezone, now)}, starting ${discordTime(first, 'F')}: ${truncate(what, 200)}\nStop it with \`/remind cancel id:${r.id}\`.`),
        );
      },
    }),
    list: subcommand({
      description: 'Your reminders that are still waiting',
      async run({ interaction, bot }) {
        const mine = pendingReminders(bot.db, interaction.guildId, interaction.user.id);
        const e = embed().setTitle('⏰ Your reminders');
        e.setDescription(
          mine.length
            ? mine
                .map((r) => {
                  const when = r.repeat ? `${describeRepeat(r.repeat)}, next ${discordTime(r.dueAt, 'R')}` : discordTime(r.dueAt, 'R');
                  return `**#${r.id}** ${when} in <#${r.channelId}>\n${truncate(r.text, 120)}`;
                })
                .join('\n\n')
            : 'Nothing waiting. Add one with `/remind me` or `/remind every`.',
        );
        await interaction.reply(privately({ embeds: [e] }));
      },
    }),
    cancel: subcommand({
      description: 'Cancel one of your reminders (or stop a repeating one)',
      options: { id: opt.integer('The reminder number from /remind list').min(1) },
      async run({ interaction, bot }, { id }) {
        const r = getReminder(bot.db, id);
        if (!r || r.userId !== interaction.user.id || r.guildId !== interaction.guildId || r.sentAt !== null) {
          throw new UserError(`You have no waiting reminder #${id}. See /remind list.`);
        }
        if (r.jobId !== null) bot.scheduler.cancel(r.jobId);
        deleteReminder(bot.db, r.id);
        await interaction.reply(okReply(r.repeat ? `Stopped reminder #${id} (${describeRepeat(r.repeat)}).` : `Cancelled reminder #${id}.`));
      },
    }),
  },
  jobs: {
    fire: job({
      payload: z.object({ reminderId: z.number().int() }),
      async run({ bot, log, job: j }, { reminderId }) {
        const r = getReminder(bot.db, reminderId);
        if (!r || r.sentAt !== null) return;
        const late = j.late ? ` (sorry, ${formatDuration(bot.clock.now() - j.runAt)} late: I was offline)` : '';
        const footer = r.repeat
          ? `${describeRepeat(r.repeat)} · stop it with /remind cancel id:${r.id}`
          : `Set ${formatDateTime(r.createdAt, bot.timezone)}`;
        const body = {
          content: `⏰ <@${r.userId}>, you asked me to remind you${late}:`,
          embeds: [embed().setDescription(truncate(r.text, 4000)).setFooter({ text: footer })],
          allowedMentions: { users: [r.userId] },
        };
        let sent = false;
        try {
          const channel = await bot.client.channels.fetch(r.channelId);
          if (channel?.isSendable()) {
            await channel.send(body);
            sent = true;
          }
        } catch (err) {
          log.warn('could not post the reminder in its channel; sending a DM', { reminderId, err });
        }
        if (!sent) {
          // The channel is gone or the bot lost access: try a direct message.
          const user = await bot.client.users.fetch(r.userId);
          await user.send(body);
        }
        // A repeating reminder stays, due at its next time; a one-off is done.
        if (j.next !== null) setReminderDue(bot.db, r.id, j.next);
        else markSent(bot.db, r.id, bot.clock.now());
      },
    }),
  },
});
