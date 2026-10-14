import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { startTestBot, textOf } from '../fake/harness.ts';
import type { TestBot } from '../fake/harness.ts';

let t: TestBot;
beforeEach(async () => {
  t = await startTestBot();
});
afterEach(async () => {
  await t.stop();
});

const MIN = 60_000;

describe('/remind', () => {
  test('confirms privately, then posts in the channel when it is due, pinging only that member', async () => {
    const r = await t.slash('remind', { when: '1h 30m', what: 'Post the meeting notes' }, { sub: 'me', as: t.alice });
    assert.equal(r.ephemeral, true);
    assert.match(textOf(r.reply), /I'll remind you <t:\d+:R>/);
    const before = t.discord.channelMessages(t.general.id).length;

    await t.advance(89 * MIN);
    assert.equal(t.discord.channelMessages(t.general.id).length, before, 'not yet');

    await t.advance(2 * MIN);
    const sent = t.discord.lastMessage(t.general.id)!;
    assert.match(sent.content, new RegExp(`<@${t.alice.id}>, you asked me to remind you:`));
    assert.match(textOf(sent), /Post the meeting notes/);
    const req = t.discord.requests.find((q) => q.method === 'POST' && q.path === `/channels/${t.general.id}/messages`)!;
    assert.deepEqual(req.body.allowed_mentions, { users: [t.alice.id] });
    assert.deepEqual(t.problems(), []);
  });

  test('fires after a restart, and says it is late', async () => {
    await t.slash('remind', { when: '10m', what: 'Stretch' }, { sub: 'me' });
    const { db, discord, clock } = t;
    await t.huddle.stop(); // the bot goes offline…
    clock.advance(3 * 60 * MIN); // …for three hours
    t = await startTestBot({ db, discord, clock }); // startup runs the overdue job
    await t.idle();
    const sent = t.discord.lastMessage(t.general.id)!;
    assert.match(sent.content, /late: I was offline/);
    assert.match(textOf(sent), /Stretch/);
    db.close();
  });

  test('lists and cancels your own reminders only', async () => {
    await t.slash('remind', { when: '2h', what: 'Water the plants' }, { sub: 'me', as: t.alice });
    await t.advance(5000); // /remind me has a 3-second cooldown
    await t.slash('remind', { when: '1d', what: 'Call mum' }, { sub: 'me', as: t.alice });
    await t.slash('remind', { when: '1h', what: "Bob's thing" }, { sub: 'me', as: t.bob });
    const list = await t.slash('remind', {}, { sub: 'list', as: t.alice });
    assert.match(textOf(list.reply), /#1\*\* .*Water the plants/s);
    assert.match(textOf(list.reply), /Call mum/);
    assert.doesNotMatch(textOf(list.reply), /Bob's thing/);

    const notYours = await t.slash('remind', { id: 3 }, { sub: 'cancel', as: t.alice });
    assert.match(textOf(notYours.reply), /no waiting reminder #3/);
    const cancel = await t.slash('remind', { id: 1 }, { sub: 'cancel', as: t.alice });
    assert.match(textOf(cancel.reply), /Cancelled reminder #1/);

    await t.advance(25 * 60 * MIN);
    const texts = t.discord.channelMessages(t.general.id).map(textOf).join('\n');
    assert.doesNotMatch(texts, /Water the plants/);
    assert.match(texts, /Call mum/);
    assert.match(texts, /Bob's thing/);
  });

  test('falls back to a direct message when the channel is gone', async () => {
    await t.slash('remind', { when: '5m', what: 'DM me' }, { sub: 'me' });
    t.discord.channels.delete(t.general.id);
    await t.advance(6 * MIN);
    const dm = [...t.discord.channels.values()].find((c) => c.type === 1 && c.recipientId === t.alice.id);
    assert.ok(dm, 'a DM channel was opened');
    assert.match(textOf(t.discord.lastMessage(dm.id)), /DM me/);
  });

  test('rejects durations it cannot read or that are out of range', async () => {
    const bad = await t.slash('remind', { when: 'next tuesday', what: 'x' }, { sub: 'me' });
    assert.match(textOf(bad.reply), /like 10m, 2h or 1d 4h/);
    const short = await t.slash('remind', { when: '10s', what: 'x' }, { sub: 'me' });
    assert.match(textOf(short.reply), /between 1 minute and 1 year/);
  });
});

// Times of day and repeating reminders, in the bot's time zone. The fake clock
// starts on Wednesday 14 October 2026, 12:00 UTC (13:00 in London).
describe('/remind at a time, and /remind every', () => {
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  let london: TestBot;
  beforeEach(async () => {
    london = await startTestBot({ timezone: 'Europe/London' });
  });
  afterEach(async () => {
    await london.stop();
  });

  test('"18:30" means 18:30 on the bot\'s clock', async () => {
    const r = await london.slash('remind', { when: '18:30', what: 'Lights on' }, { sub: 'me' });
    assert.match(textOf(r.reply), new RegExp(`<t:${Date.UTC(2026, 9, 14, 17, 30) / 1000}:R>`));
    await london.advance(5 * HOUR + 29 * MIN);
    assert.doesNotMatch(textOf(london.discord.lastMessage(london.general.id)), /Lights on/);
    await london.advance(2 * MIN);
    const sent = london.discord.lastMessage(london.general.id)!;
    assert.match(textOf(sent), /Lights on/);
    assert.match(sent.embeds[0].footer.text, /^Set Wed 14 Oct 2026, 13:00 BST$/);
  });

  test("a time inside the spring clock change is moved, and the member is told", async () => {
    london.clock.advance(Date.UTC(2027, 2, 27, 12) - london.clock.now()); // Sat 27 March 2027
    const r = await london.slash('remind', { when: 'tomorrow 01:30', what: 'x' }, { sub: 'me' });
    assert.match(textOf(r.reply), /doesn't exist that night .* so I picked 02:30/);
    assert.match(textOf(r.reply), new RegExp(`<t:${Date.UTC(2027, 2, 28, 1, 30) / 1000}:R>`));
  });

  test('bad times are refused before the cooldown starts', async () => {
    const bad = await london.slash('remind', { when: '25:00', what: 'x' }, { sub: 'me' });
    assert.match(textOf(bad.reply), /or a time like 18:30/);
    const past = await london.slash('remind', { when: 'today 09:00', what: 'x' }, { sub: 'me' });
    assert.match(textOf(past.reply), /between 1 minute and 1 year/);
  });

  test('every Monday at 09:00: fires weekly at 09:00 local across the clock change, listed, and stops on cancel', async () => {
    const r = await london.slash('remind', { day: '1', time: '9am', what: 'Post the weekly agenda' }, { sub: 'every', as: london.alice });
    assert.equal(r.ephemeral, true);
    assert.match(textOf(r.reply), /every Monday at 09:00 \(Europe\/London, BST\)/);
    assert.match(textOf(r.reply), new RegExp(`starting <t:${Date.UTC(2026, 9, 19, 8) / 1000}:F>`));
    assert.match(textOf(r.reply), /\/remind cancel id:1/);

    const list = await london.slash('remind', {}, { sub: 'list', as: london.alice });
    assert.match(textOf(list.reply), /#1\*\* every Monday at 09:00, next <t:\d+:R>/);

    const posts = () => london.discord.channelMessages(london.general.id).filter((m) => /weekly agenda/.test(textOf(m)));
    await london.advance(5 * DAY - 4 * HOUR - MIN); // Mon 19 Oct 07:59 UTC
    assert.equal(posts().length, 0);
    await london.advance(2 * MIN);
    assert.equal(posts().length, 1);
    assert.equal(Date.parse(posts()[0]!.timestamp), Date.UTC(2026, 9, 19, 8, 1));
    assert.match(posts()[0]!.embeds[0].footer.text, /every Monday at 09:00 · stop it with \/remind cancel id:1/);
    await london.advance(7 * DAY - 2 * MIN); // Mon 26 Oct 07:59 UTC: the clocks went back on Sunday, so 09:00 is now 09:00 UTC
    assert.equal(posts().length, 1);
    await london.advance(HOUR + 2 * MIN);
    assert.equal(posts().length, 2);
    assert.equal(Date.parse(posts()[1]!.timestamp), Date.UTC(2026, 9, 26, 9, 1));

    const stop = await london.slash('remind', { id: 1 }, { sub: 'cancel', as: london.alice });
    assert.match(textOf(stop.reply), /Stopped reminder #1 \(every Monday at 09:00\)/);
    await london.advance(14 * DAY);
    assert.equal(posts().length, 2);
    assert.deepEqual(london.problems(), []);
  });

  test('a repeating reminder survives a restart', async () => {
    await london.slash('remind', { day: 'day', time: '18:00', what: 'Daily check-in' }, { sub: 'every' });
    const { db, discord, clock } = london;
    await london.huddle.stop();
    clock.advance(3 * DAY);
    london = await startTestBot({ db, discord, clock, timezone: 'Europe/London' });
    await london.idle();
    const daily = london.discord.channelMessages(london.general.id).filter((m) => /Daily check-in/.test(textOf(m)));
    assert.equal(daily.length, 1, 'missed days are not replayed');
    assert.match(daily[0]!.content, /late: I was offline/);
    await london.advance(DAY);
    assert.equal(london.discord.channelMessages(london.general.id).filter((m) => /Daily check-in/.test(textOf(m))).length, 2);
    await london.stop(); // a bot given a db leaves it open
    db.close();
    london = await startTestBot(); // a fresh one for afterEach to stop
  });
});
