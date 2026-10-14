// Time zones: wall-clock times in a zone, clock changes (gaps and repeats),
// typed times, and "next Monday at 09:00" across daylight saving.
// London 2026: clocks go forward 29 March 01:00 UTC, back 25 October 01:00 UTC.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeRepeat, formatDateTime, fromLocal, isTimeZone, nextOccurrence, parseDate, parseTime, parseWhen, toLocal } from '../../src/core/time.ts';

const LONDON = 'Europe/London';
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('time zones', () => {
  test('wall clock and back, in summer and winter', () => {
    const noon = utc(2026, 10, 14, 12); // a Wednesday
    assert.deepEqual(toLocal(noon, LONDON), { year: 2026, month: 10, day: 14, hour: 13, minute: 0, second: 0, weekday: 3 });
    assert.deepEqual(fromLocal({ year: 2026, month: 10, day: 14, hour: 13, minute: 0 }, LONDON), { ms: noon, exact: true });
    assert.deepEqual(fromLocal({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, LONDON), { ms: utc(2026, 12, 1, 9), exact: true });
    assert.deepEqual(fromLocal({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, 'UTC'), { ms: utc(2026, 7, 1, 9), exact: true });
    assert.equal(toLocal(utc(2026, 7, 1, 3), 'Asia/Kolkata').hour, 8, 'half-hour offsets');
    assert.equal(isTimeZone(LONDON), true);
    assert.equal(isTimeZone('Mars/Olympus'), false);
  });

  test("a time that doesn't exist moves forward; one that happens twice is the first", () => {
    // 01:30 on 29 March: the clocks jump from 01:00 to 02:00.
    assert.deepEqual(fromLocal({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LONDON), { ms: utc(2026, 3, 29, 1, 30), exact: false });
    assert.equal(toLocal(utc(2026, 3, 29, 1, 30), LONDON).hour, 2, 'that is 02:30 BST');
    // 01:30 on 25 October happens at 00:30 UTC (BST) and again at 01:30 UTC (GMT).
    assert.deepEqual(fromLocal({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LONDON), { ms: utc(2026, 10, 25, 0, 30), exact: true });
    // New York: 02:30 on 8 March 2026 doesn't exist (02:00 → 03:00).
    assert.deepEqual(fromLocal({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York'), { ms: utc(2026, 3, 8, 7, 30), exact: false });
  });

  test('typed times and dates', () => {
    assert.deepEqual(parseTime('18:30'), { hour: 18, minute: 30 });
    assert.deepEqual(parseTime('9:05'), { hour: 9, minute: 5 });
    assert.deepEqual(parseTime('18.30'), { hour: 18, minute: 30 });
    assert.deepEqual(parseTime('9am'), { hour: 9, minute: 0 });
    assert.deepEqual(parseTime('6:30 PM'), { hour: 18, minute: 30 });
    assert.deepEqual(parseTime('12am'), { hour: 0, minute: 0 });
    for (const bad of ['9', '24:00', '12:60', '13pm', 'noon', '']) assert.equal(parseTime(bad), null, bad);
    assert.deepEqual(parseDate('2026-10-20'), { year: 2026, month: 10, day: 20 });
    for (const bad of ['2026-02-30', '2026-13-01', '20/10/2026', 'tomorrow']) assert.equal(parseDate(bad), null, bad);
  });

  test('"18:30", "tomorrow 9am", "2026-10-26 09:00" on the zone\'s clock', () => {
    const now = utc(2026, 10, 14, 12); // 13:00 in London
    assert.deepEqual(parseWhen('18:30', now, LONDON), { ms: utc(2026, 10, 14, 17, 30), exact: true });
    assert.deepEqual(parseWhen('12:00', now, LONDON), { ms: utc(2026, 10, 15, 11), exact: true }, 'passed today: tomorrow');
    assert.deepEqual(parseWhen('tomorrow 9am', now, LONDON), { ms: utc(2026, 10, 15, 8), exact: true });
    assert.deepEqual(parseWhen('today at 20:00', now, LONDON), { ms: utc(2026, 10, 14, 19), exact: true });
    assert.deepEqual(parseWhen('2026-10-26 09:00', now, LONDON), { ms: utc(2026, 10, 26, 9), exact: true }, 'after the clocks go back');
    assert.deepEqual(parseWhen('2027-03-28 01:30', now, LONDON), { ms: utc(2027, 3, 28, 1, 30), exact: false }, 'in the spring gap');
    for (const bad of ['soon', 'next tuesday', '2026-02-30 10:00', '9', 'tomorrow']) assert.equal(parseWhen(bad, now, LONDON), null, bad);
  });

  test('every Monday at 09:00 stays at 09:00 local when the clocks go back', () => {
    const rule = { every: 'week', day: 1, at: '09:00' } as const;
    const first = nextOccurrence(rule, utc(2026, 10, 14, 12), LONDON);
    assert.equal(first, utc(2026, 10, 19, 8), 'Mon 19 Oct, 09:00 BST');
    const second = nextOccurrence(rule, first, LONDON);
    assert.equal(second, utc(2026, 10, 26, 9), 'Mon 26 Oct, 09:00 GMT');
    assert.equal(nextOccurrence(rule, first - 1, LONDON), first, 'strictly after');
    assert.equal(describeRepeat(rule), 'every Monday at 09:00');
  });

  test('every day at 01:30 through both clock changes: runs once a day', () => {
    const rule = { every: 'day', at: '01:30' } as const;
    // Spring: 01:30 doesn't exist on 29 March, so it runs at 02:30 BST that day.
    const spring = nextOccurrence(rule, utc(2026, 3, 28, 12), LONDON);
    assert.equal(spring, utc(2026, 3, 29, 1, 30));
    assert.equal(nextOccurrence(rule, spring, LONDON), utc(2026, 3, 30, 0, 30), '01:30 BST the next day');
    // Autumn: 01:30 happens twice on 25 October; it runs at the first one only.
    const autumn = nextOccurrence(rule, utc(2026, 10, 24, 12), LONDON);
    assert.equal(autumn, utc(2026, 10, 25, 0, 30));
    assert.equal(nextOccurrence(rule, autumn, LONDON), utc(2026, 10, 26, 1, 30));
  });

  test('plain-text times name the zone', () => {
    assert.equal(formatDateTime(utc(2026, 10, 14, 12), LONDON), 'Wed 14 Oct 2026, 13:00 BST');
    assert.equal(formatDateTime(utc(2026, 12, 1, 9, 5), LONDON), 'Tue 1 Dec 2026, 09:05 GMT');
    assert.equal(formatDateTime(utc(2026, 10, 14, 12), 'UTC'), 'Wed 14 Oct 2026, 12:00 UTC');
  });
});
