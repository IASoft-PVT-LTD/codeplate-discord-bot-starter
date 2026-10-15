// The free CodePlate license asks for the credit "Built with CodePlate
// (codeplate.io)" where the bot describes itself. Keep these tests passing.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { BOT } from '../../src/config.ts';
import { startTestBot, textOf } from '../fake/harness.ts';
import type { TestBot } from '../fake/harness.ts';

const CREDIT = 'Built with CodePlate (codeplate.io)';

let t: TestBot;
beforeEach(async () => {
  t = await startTestBot();
});
afterEach(async () => {
  await t.stop();
});

describe('credit, /help and /about', () => {
  test('the credit text is unchanged', () => {
    assert.equal(BOT.credit, CREDIT);
  });

  test('/help lists commands and has the credit in its footer', async () => {
    const r = await t.slash('help', {}, { as: t.alice });
    const e = r.reply!.embeds[0];
    assert.ok(e.footer.text.includes(CREDIT), `footer: ${e.footer.text}`);
    assert.match(e.description, /\/poll/);
    assert.match(e.description, /\/remind me/);
    assert.match(e.description, /Save as quote/);
    // Members only see what they can use.
    assert.doesNotMatch(e.description, /\/purge/);
    assert.doesNotMatch(e.description, /\/welcome/);
    const asOwner = await t.slash('help', {}, { as: t.owner });
    assert.match(asOwner.reply!.embeds[0].description, /\/purge/);
  });

  test('/about shows the credit and links to codeplate.io', async () => {
    const r = await t.slash('about');
    assert.ok(textOf(r.reply).includes(CREDIT));
    const link = r.reply!.components[0].components[0];
    assert.equal(link.url, 'https://codeplate.io');
    assert.match(textOf(r.reply), /Servers\n1/);
  });
});
