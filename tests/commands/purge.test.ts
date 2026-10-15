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

const DAY = 86_400_000;

describe('/purge', () => {
  test('deletes the last N messages with one bulk delete, privately confirmed', async () => {
    for (let i = 0; i < 6; i++) t.discord.postAs(i % 2 ? t.alice : t.bob, t.general, `message ${i}`);
    const r = await t.slash('purge', { count: 4 }, { as: t.mod });
    assert.equal(r.callbackType, 5, 'deferred while it works');
    assert.equal(r.ephemeral, true);
    assert.match(textOf(r.reply), /Deleted 4 messages/);
    assert.deepEqual(
      t.discord.channelMessages(t.general.id).map((m) => m.content),
      ['message 0', 'message 1'],
    );
    const bulk = t.discord.requests.filter((q) => q.path.endsWith('/bulk-delete'));
    assert.equal(bulk.length, 1);
    assert.equal(bulk[0]!.body.messages.length, 4);
  });

  test('only one member’s messages, keeping pinned ones', async () => {
    t.discord.postAs(t.bob, t.general, 'bob 1');
    t.discord.postAs(t.alice, t.general, 'alice 1');
    t.discord.postAs(t.bob, t.general, 'bob pinned', { pinned: true });
    t.discord.postAs(t.bob, t.general, 'bob 2');
    const r = await t.slash('purge', { count: 10, from: t.bob }, { as: t.mod });
    assert.match(textOf(r.reply), /Deleted 2 messages from <@\d+>/);
    assert.deepEqual(
      t.discord.channelMessages(t.general.id).map((m) => m.content),
      ['alice 1', 'bob pinned'],
    );
  });

  test('skips messages older than 14 days (Discord refuses them)', async () => {
    t.discord.postAs(t.bob, t.general, 'ancient', { at: t.clock.now() - 20 * DAY });
    t.discord.postAs(t.bob, t.general, 'recent 1');
    t.discord.postAs(t.bob, t.general, 'recent 2');
    const r = await t.slash('purge', { count: 10 }, { as: t.mod });
    assert.match(textOf(r.reply), /Deleted 2 messages\. Skipped 1 older than 14 days/);
    assert.deepEqual(t.discord.unhandled, []);
  });

  test('members need Manage Messages; the bot too', async () => {
    const r = await t.slash('purge', { count: 5 }, { as: t.alice });
    assert.match(textOf(r.reply), /You need the \*\*Manage Messages\*\* permission/);
    t.roles.botRole.permissions &= ~(1n << 13n); // take Manage Messages from the bot
    const { db, discord, clock } = t;
    await t.huddle.stop();
    t = await startTestBot({ db, discord, clock });
    const r2 = await t.slash('purge', { count: 5 }, { as: t.mod });
    assert.match(textOf(r2.reply), /I need the \*\*Manage Messages\*\* permission in this channel/);
    db.close();
  });

  test('count must be 1-100', async () => {
    const r = await t.slash('purge', { count: 0 }, { as: t.mod });
    assert.match(textOf(r.reply), /`count`/);
  });
});
