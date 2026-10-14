import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { customIds, startTestBot, textOf } from '../fake/harness.ts';
import type { TestBot } from '../fake/harness.ts';

let t: TestBot;
beforeEach(async () => {
  t = await startTestBot();
});
afterEach(async () => {
  await t.stop();
});

describe('/poll', () => {
  test('posts the question with a button per answer and a close button', async () => {
    const r = await t.slash('poll', { question: 'Where should we meet?', answers: 'Library; Café; Online' });
    assert.equal(r.callbackType, 4);
    assert.equal(r.ephemeral, false);
    const msg = r.reply!;
    assert.match(textOf(msg), /Where should we meet\?/);
    assert.deepEqual(customIds(msg), ['poll:vote:1:0', 'poll:vote:1:1', 'poll:vote:1:2', 'poll:close:1']);
    assert.match(textOf(msg), /0 votes/);
    assert.deepEqual(t.problems(), []);
  });

  test('counts one vote per member, lets them change it or take it back', async () => {
    const msg = (await t.slash('poll', { question: 'Pizza or tacos?', answers: 'Pizza; Tacos' })).reply!;
    const v1 = await t.click(msg, 'poll:vote:1:0', { as: t.alice });
    assert.equal(v1.callbackType, 7, 'the vote updates the poll message');
    assert.match(textOf(v1.followUps[0]), /You voted for \*\*Pizza\*\*/);
    await t.click(msg, 'poll:vote:1:0', { as: t.bob });
    assert.match(textOf(msg), /2 votes/);
    const change = await t.click(msg, 'poll:vote:1:1', { as: t.bob });
    assert.match(textOf(change.followUps[0]), /Changed your vote to \*\*Tacos\*\*/);
    assert.match(msg.embeds[0].description, /\*\*1\. Pizza\*\*\n`[█░]+` 1 vote · 50%/);
    const back = await t.click(msg, 'poll:vote:1:1', { as: t.bob });
    assert.match(textOf(back.followUps[0]), /taken back/);
    assert.match(textOf(msg), /1 vote\b/);
    assert.equal(back.followUps[0]!.flags & 64, 64, 'vote confirmations are private');
  });

  test('only the author or a manager can close it; closing removes the buttons', async () => {
    const msg = (await t.slash('poll', { question: 'Movie night?', answers: 'Yes; No' }, { as: t.alice })).reply!;
    await t.click(msg, 'poll:vote:1:0', { as: t.bob });
    const denied = await t.click(msg, 'poll:close:1', { as: t.bob });
    assert.match(textOf(denied.reply), /Only the person who asked, or a manager/);
    assert.equal(denied.ephemeral, true);
    // A moderator isn't a manager until the owner picks their role.
    assert.match(textOf((await t.click(msg, 'poll:close:1', { as: t.mod })).reply), /Only the person who asked/);
    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    await t.click(msg, 'poll:close:1', { as: t.mod });
    assert.deepEqual(customIds(msg), []);
    assert.match(textOf(msg), /🔒 Movie night\?/);
    assert.match(textOf(msg), /Yes\*\* 🏆/);
  });

  test('closes by itself when the duration is up, even after a restart', async () => {
    const msg = (await t.slash('poll', { question: 'Snacks?', answers: 'Chips; Fruit', duration: '2h' })).reply!;
    assert.match(textOf(msg), /Closes <t:\d+:R>/);
    await t.click(msg, 'poll:vote:1:1', { as: t.bob });
    // Restart: a second bot process on the same database and the same Discord.
    const { db, discord, clock } = t;
    await t.huddle.stop();
    t = await startTestBot({ db, discord, clock });
    await t.advance(2 * 60 * 60_000 + 1000);
    const edited = t.discord.requests.find((q) => q.method === 'PATCH' && q.path === `/channels/${t.general.id}/messages/${msg.id}`);
    assert.ok(edited, 'the poll message was edited through the channel API');
    assert.match(textOf(msg), /🔒 Snacks\?/);
    assert.match(textOf(msg), /Fruit\*\* 🏆/);
    db.close();
  });

  test('rejects too few answers and bad durations with a clear private message', async () => {
    const one = await t.slash('poll', { question: 'Hm?', answers: 'Only one' });
    assert.equal(one.ephemeral, true);
    assert.match(textOf(one.reply), /at least 2 answers/);
    const bad = await t.slash('poll', { question: 'Hm?', answers: 'a; b', duration: 'tomorrow' });
    assert.match(textOf(bad.reply), /like 30m, 2h or 1d/);
    const tooLong = await t.slash('poll', { question: 'Hm?', answers: 'a; b', duration: '8d' });
    assert.match(textOf(tooLong.reply), /between 1 minute and 7 days/);
  });

  test('has a cooldown per member', async () => {
    await t.slash('poll', { question: 'One?', answers: 'a; b' });
    const again = await t.slash('poll', { question: 'Two?', answers: 'a; b' });
    assert.match(textOf(again.reply), /Slow down/);
    await t.advance(11_000);
    const later = await t.slash('poll', { question: 'Three?', answers: 'a; b' });
    assert.equal(later.ephemeral, false);
  });
});
