// The router: checks, errors and unknown interactions, with test-only commands.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { UserError, customId, defineCommand } from '../../src/core/command.ts';
import { opt } from '../../src/core/options.ts';
import { startTestBot, textOf } from '../fake/harness.ts';
import type { TestBot } from '../fake/harness.ts';

const boom = defineCommand({
  name: 'boom',
  description: 'Throws',
  options: { kind: opt.string('Which error').choices('user', 'bug') },
  async run(_ctx, { kind }) {
    if (kind === 'user') throw new UserError('That tag does not exist.');
    throw new Error('database on fire');
  },
});

const echo = defineCommand({
  name: 'echo',
  description: 'Typed options',
  options: {
    text: opt.string('Text').max(10),
    times: opt.integer('Times').min(1).max(3).optional(),
    who: opt.member('Someone').optional(),
  },
  async run({ interaction }, { text, times, who }) {
    const button = new ButtonBuilder().setCustomId(customId('echo', 'again', text)).setLabel('Again').setStyle(ButtonStyle.Primary);
    await interaction.reply({
      content: `${text.repeat(times ?? 1)}${who ? ` ${who.displayName} (${who.roles.cache.size} roles)` : ''}`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
  },
  components: {
    again: {
      public: true,
      async run({ interaction }, [text]) {
        await interaction.reply({ content: `again: ${text}` });
      },
    },
  },
});

let t: TestBot;
afterEach(async () => {
  await t.stop();
});

describe('router', () => {
  test('a UserError is shown as-is; any other error is logged and the user gets an apology', async () => {
    t = await startTestBot({ extraCommands: [boom] });
    const user = await t.slash('boom', { kind: 'user' });
    assert.equal(user.ephemeral, true);
    assert.match(textOf(user.reply), /That tag does not exist/);
    assert.deepEqual(t.problems(), []);
    const bug = await t.slash('boom', { kind: 'bug' });
    assert.match(textOf(bug.reply), /Something went wrong on my side/);
    assert.doesNotMatch(textOf(bug.reply), /database on fire/, 'internal details stay in the log');
    const logged = t.problems().find((l) => l.msg === 'handler failed')!;
    assert.equal((logged.err as { message: string }).message, 'database on fire');
    assert.equal(logged.command, 'boom');
  });

  test('options arrive typed and validated (zod)', async () => {
    t = await startTestBot({ extraCommands: [echo] });
    const ok = await t.slash('echo', { text: 'hi', times: 3, who: t.bob });
    assert.equal(ok.reply!.content, 'hihihi Bob (2 roles)'); // Member + @everyone
    const tooLong = await t.slash('echo', { text: 'this is too long' });
    assert.match(textOf(tooLong.reply), /`text`: Too big|`text`:.*10/);
    const tooMany = await t.slash('echo', { text: 'x', times: 9 });
    assert.match(textOf(tooMany.reply), /`times`/);
  });

  test('fixed choices are enforced for strings, integers and numbers', async () => {
    const picked: unknown[] = [];
    const pick = defineCommand({
      name: 'pick',
      description: 'Choices',
      options: {
        size: opt.integer('Size').choices({ name: 'Small', value: 1 }, { name: 'Large', value: 3 }),
        speed: opt.number('Speed').choices({ name: 'Slow', value: 0.5 }, { name: 'Fast', value: 2 }).optional(),
        color: opt.string('Color').choices('red', 'blue').optional(),
      },
      async run({ interaction }, values) {
        picked.push(values);
        await interaction.reply({ content: 'ok' });
      },
    });
    t = await startTestBot({ extraCommands: [pick] });
    assert.equal((await t.slash('pick', { size: 3, speed: 0.5, color: 'red' })).reply!.content, 'ok');
    // A stale client or a crafted request can send values that aren't choices.
    assert.match(textOf((await t.slash('pick', { size: 2 })).reply), /`size`: must be one of: 1, 3/);
    assert.match(textOf((await t.slash('pick', { size: 1, speed: 1 })).reply), /`speed`: must be one of: 0.5, 2/);
    assert.match(textOf((await t.slash('pick', { size: 1, color: 'green' })).reply), /`color`: must be one of: red, blue/);
    assert.deepEqual(picked, [{ size: 3, speed: 0.5, color: 'red' }]);
  });

  test('buttons route by custom id; unknown ids get a friendly message', async () => {
    t = await startTestBot({ extraCommands: [echo] });
    const msg = (await t.slash('echo', { text: 'yo' })).reply!;
    const again = await t.click(msg, 'echo:again:yo', { as: t.bob });
    assert.equal(again.reply!.content, 'again: yo');
    msg.components[0].components[0].custom_id = 'gone:handler';
    const stale = await t.click(msg, 'gone:handler');
    assert.match(textOf(stale.reply), /no longer active/);
  });

  test('a command Discord has but the code does not tells admins to run npm run register', async () => {
    t = await startTestBot();
    const r = await t.slash('ghost', {}, { unknown: true });
    assert.match(textOf(r.reply), /npm run register/);
    assert.ok(t.problems().some((l) => /unknown command/.test(l.msg)));
  });

  test('every interaction gets exactly one response (no double replies)', async () => {
    t = await startTestBot();
    await t.slash('poll', { question: 'Q?', answers: 'a; b' });
    await t.slash('help');
    await t.slash('about');
    const doubles = t.discord.requests.filter((r) => r.status === 400);
    assert.deepEqual(doubles, []);
    assert.deepEqual(t.discord.unhandled, []);
  });
});
