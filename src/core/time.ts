// Calendar time in a time zone: "today at 18:30", "every Monday at 9:00",
// "2026-10-20 19:00" in the bot's zone, safe across daylight-saving changes.
// The bot's zone is `BOT.timezone` in src/config.ts (an IANA name such as
// "Europe/London"; default "UTC"), available as `bot.timezone`. Times are Unix
// milliseconds everywhere else; these helpers convert to and from the wall
// clock in a zone. Every function takes the zone, so a per-server zone (a
// setting) works the same way. See docs/recipes/scheduled-jobs.md.
import { z } from 'zod';

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface LocalTime {
  hour: number; // 0-23
  minute: number; // 0-59
}

export type LocalDateTime = LocalDate & LocalTime;

const DAY_MS = 86_400_000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

// True for a time zone this Node knows ("UTC", "Europe/London", "America/New_York").
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();
function partsFormat(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(zone, f);
  }
  return f;
}

// The wall clock in `zone` at `ms`, with the weekday (0 = Sunday).
export function toLocal(ms: number, zone: string): LocalDateTime & { second: number; weekday: number } {
  const p: Record<string, number> = {};
  for (const part of partsFormat(zone).formatToParts(ms)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const date = { year: p.year!, month: p.month!, day: p.day! };
  return { ...date, hour: p.hour!, minute: p.minute!, second: p.second!, weekday: weekdayOf(date) };
}

// 0 = Sunday … 6 = Saturday.
export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// How far `zone` is ahead of UTC at `ms`, in milliseconds (BST: +1h).
function offsetAt(ms: number, zone: string): number {
  const l = toLocal(ms, zone);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - Math.floor(ms / 1000) * 1000;
}

// The moment it is `local` on the wall clock in `zone`.
// - A time that doesn't exist (the clocks went forward over it, e.g. 02:30 on
//   the spring change in London) moves forward by the gap (03:30), with
//   `exact: false` so you can tell the user.
// - A time that happens twice (the clocks went back) is the first one.
export function fromLocal(local: LocalDateTime, zone: string): { ms: number; exact: boolean } {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const candidates = [...new Set([wall - offsetAt(wall - DAY_MS, zone), wall - offsetAt(wall + DAY_MS, zone)])].sort((a, b) => a - b);
  const same = (ms: number) => {
    const l = toLocal(ms, zone);
    return l.year === local.year && l.month === local.month && l.day === local.day && l.hour === local.hour && l.minute === local.minute;
  };
  const exact = candidates.find(same);
  if (exact !== undefined) return { ms: exact, exact: true };
  // In a gap: read the wall time with the offset from before the change.
  return { ms: wall - offsetAt(wall - DAY_MS, zone), exact: false };
}

// "18:30", "9:00", "18.30", "9am", "6:30pm" → { hour, minute } (24-hour), or null.
export function parseTime(text: string): LocalTime | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m || (m[2] === undefined && !m[3])) return null; // a bare "9" is too vague
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const half = m[3]?.toLowerCase();
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'pm' ? 12 : 0);
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

// "2026-10-20" → a real calendar date, or null ("2026-02-30" is null).
export function parseDate(text: string): LocalDate | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const back = addDays(date, 0);
  return back.year === date.year && back.month === date.month && back.day === date.day ? date : null;
}

// A moment typed by a member, read on the wall clock in `zone`:
//   "18:30" (today, or tomorrow if that has passed), "tomorrow 9am",
//   "2026-10-20 18:30". Null if it doesn't parse. `exact: false` when the time
//   doesn't exist that day (see fromLocal) and was moved forward.
export function parseWhen(text: string, now: number, zone: string): { ms: number; exact: boolean } | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = /^(?:(today|tomorrow|\d{4}-\d{1,2}-\d{1,2})(?: at)? )?(.+)$/.exec(words);
  if (!m) return null;
  const time = parseTime(m[2]!);
  if (!time) return null;
  const today: LocalDate = toLocal(now, zone);
  if (m[1] === undefined) {
    const at = fromLocal({ ...today, ...time }, zone);
    return at.ms > now ? at : fromLocal({ ...addDays(today, 1), ...time }, zone);
  }
  const date = m[1] === 'today' ? today : m[1] === 'tomorrow' ? addDays(today, 1) : parseDate(m[1]);
  return date ? fromLocal({ ...date, ...time }, zone) : null;
}

// A repeating time: every day, or every week on one weekday, at a wall-clock time.
export const RepeatSchema = z.union([
  z.object({ every: z.literal('day'), at: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ every: z.literal('week'), day: z.number().int().min(0).max(6), at: z.string().regex(/^\d{2}:\d{2}$/) }),
]);
export type Repeat = z.infer<typeof RepeatSchema>;

export function hhmm(t: LocalTime): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

// The first occurrence strictly after `after`. On a day the time doesn't exist
// (clocks forward) it runs the same amount later; on a day it happens twice
// (clocks back) it runs once, the first time.
export function nextOccurrence(rule: Repeat, after: number, zone: string): number {
  const [hour, minute] = rule.at.split(':').map(Number) as [number, number];
  const start: LocalDate = toLocal(after, zone);
  for (let i = 0; i <= 8; i++) {
    const date = addDays(start, i);
    if (rule.every === 'week' && weekdayOf(date) !== rule.day) continue;
    const { ms } = fromLocal({ ...date, hour, minute }, zone);
    if (ms > after) return ms;
  }
  throw new Error(`no next occurrence for ${JSON.stringify(rule)}`); // unreachable
}

// "every Monday at 09:00", "every day at 18:30"
export function describeRepeat(rule: Repeat): string {
  return `every ${rule.every === 'day' ? 'day' : WEEKDAYS[rule.day]} at ${rule.at}`;
}

// The zone's short name at `ms`: "UTC", "BST", "GMT", "GMT-4"…
export function zoneName(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

// "Wed 14 Oct 2026, 13:00 BST": for plain text where Discord's <t:…> markup
// doesn't work (embed footers, logs, button labels).
export function formatDateTime(ms: number, zone: string): string {
  const l = toLocal(ms, zone);
  return `${formatDate(l)}, ${hhmm(l)} ${zoneName(ms, zone)}`;
}

// "Wed 14 Oct 2026"
export function formatDate(date: LocalDate): string {
  return `${WEEKDAYS[weekdayOf(date)]!.slice(0, 3)} ${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}
