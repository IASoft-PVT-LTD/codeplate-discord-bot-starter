// Small text helpers shared by commands.

// "10m", "2h", "1d 4h", "90s", "1h30m" → milliseconds, or null if it doesn't parse.
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const re = /(\d+)(s|m|h|d|w)/gy;
  let total = 0;
  let consumed = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    total += Number(m[1]) * UNITS[m[2]!]!;
    consumed = re.lastIndex;
  }
  return consumed === text.length && total > 0 ? total : null;
}

export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = Math.round(ms / 1000);
  for (const [unit, secs] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    if (rest >= secs) {
      parts.push(`${Math.floor(rest / secs)}${unit}`);
      rest %= secs;
    }
  }
  return parts.slice(0, 2).join(' ') || '0s';
}

// Discord's own timestamp markup: shows in each reader's time zone.
// style R = "in 2 hours", f = "14 October 2026 12:00", t = "12:00".
export function discordTime(ms: number, style: 'R' | 'f' | 'F' | 't' | 'd' = 'f'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

// Fills {name} placeholders. Unknown placeholders stay as they are.
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// "ManageMessages" → "Manage Messages"
export function permissionName(p: string): string {
  return p.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Guild/g, 'Server');
}

// A horizontal bar for poll results, e.g. "██████░░░░".
export function bar(fraction: number, width = 12): string {
  const full = Math.round(Math.min(Math.max(fraction, 0), 1) * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}
