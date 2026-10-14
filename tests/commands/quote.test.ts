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

describe('/quote and "Save as quote"', () => {
  test('add, then random', async () => {
    const added = await t.slash('quote', { text: 'Measure twice, cut once.', by: t.bob }, { sub: 'add', as: t.alice });
    assert.match(textOf(added.reply), /Saved quote #1/);
    assert.match(textOf(added.reply), /— \*\*Bob\*\*/);
    const random = await t.slash('quote', {}, { sub: 'random' });
    assert.match(textOf(random.reply), /Measure twice/);
    assert.match(textOf(random.reply), /Quote #1 of 1/);
    await t.advance(5000); // /quote random has a 3-second cooldown
    const byAlice = await t.slash('quote', { by: t.alice }, { sub: 'random' });
    assert.match(textOf(byAlice.reply), /No quotes by Alice yet/);
  });

  test('save from a message with the context menu, with a link back to it', async () => {
    const said = t.discord.postAs(t.bob, t.general, 'Glue is just patience in a bottle.');
    const r = await t.messageMenu('Save as quote', said, { as: t.alice });
    assert.equal(r.ephemeral, false);
    assert.match(textOf(r.reply), /Glue is just patience/);
    assert.equal(r.reply!.embeds[0].url, `https://discord.com/channels/${t.guild.id}/${t.general.id}/${said.id}`);
    const again = await t.messageMenu('Save as quote', said, { as: t.bob });
    assert.match(textOf(again.reply), /already quote #1/);
  });

  test("won't quote the bot or an empty message", async () => {
    const own = t.discord.postAs(t.discord.botUser, t.general, 'I am a bot');
    assert.match(textOf((await t.messageMenu('Save as quote', own)).reply), /keep quotes for humans/);
    await t.advance(5000); // the menu command has a cooldown
    const empty = t.discord.postAs(t.bob, t.general, '');
    assert.match(textOf((await t.messageMenu('Save as quote', empty)).reply), /no text/);
  });

  test('only moderators delete', async () => {
    await t.slash('quote', { text: 'Hello' }, { sub: 'add' });
    assert.match(textOf((await t.slash('quote', { id: 1 }, { sub: 'delete', as: t.alice })).reply), /Manage Messages/);
    assert.match(textOf((await t.slash('quote', { id: 1 }, { sub: 'delete', as: t.mod })).reply), /Deleted quote #1/);
    assert.match(textOf((await t.slash('quote', {}, { sub: 'random' })).reply), /No quotes yet/);
  });
});
