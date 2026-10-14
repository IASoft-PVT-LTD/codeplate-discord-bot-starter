// Command definitions: what Discord receives, and Discord's rules for it.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ApplicationCommandOptionType, ApplicationCommandType, PermissionFlagsBits } from 'discord.js';
import { commands } from '../../src/commands/index.ts';
import { defineCommand, defineMessageMenu, subcommand } from '../../src/core/command.ts';
import { allCommandJson, commandJson, validateCommands } from '../../src/core/definitions.ts';
import { opt } from '../../src/core/options.ts';

describe('command definitions', () => {
  test("every command follows Discord's rules", () => {
    assert.deepEqual(validateCommands(commands), []);
  });

  test('every file in src/commands/ is listed in src/commands/index.ts', () => {
    const files = readdirSync(new URL('../../src/commands/', import.meta.url)).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
    assert.equal(files.length, commands.length, `files: ${files.join(', ')}; listed: ${commands.map((c) => c.name).join(', ')}`);
  });

  test('the JSON Discord receives for /poll', () => {
    const poll = allCommandJson(commands).find((c) => c.name === 'poll')!;
    assert.equal(poll.type, ApplicationCommandType.ChatInput);
    assert.deepEqual(poll.contexts, [0], 'servers only');
    assert.deepEqual(
      poll.options!.map((o) => [o.name, o.type, 'required' in o && o.required === true]),
      [
        ['question', ApplicationCommandOptionType.String, true],
        ['answers', ApplicationCommandOptionType.String, true],
        ['duration', ApplicationCommandOptionType.String, false],
      ],
    );
    assert.equal(poll.default_member_permissions, null, 'everyone sees /poll');
  });

  test('member permissions hide moderator commands by default', () => {
    const purge = commandJson(commands.find((c) => c.name === 'purge')!);
    assert.equal(purge.default_member_permissions, PermissionFlagsBits.ManageMessages.toString());
  });

  test("manager-only commands stay visible (Discord can't know the manager role)", () => {
    const welcome = commandJson(commands.find((c) => c.name === 'welcome')!);
    assert.equal(welcome.default_member_permissions, null);
  });

  test('subcommands and context menus', () => {
    const remind = commandJson(commands.find((c) => c.name === 'remind')!);
    assert.deepEqual(
      remind.options!.map((o) => [o.name, o.type]),
      [
        ['me', ApplicationCommandOptionType.Subcommand],
        ['every', ApplicationCommandOptionType.Subcommand],
        ['list', ApplicationCommandOptionType.Subcommand],
        ['cancel', ApplicationCommandOptionType.Subcommand],
      ],
    );
    const menu = commandJson(commands.find((c) => c.name === 'Save as quote')!);
    assert.equal(menu.type, ApplicationCommandType.Message);
    assert.equal(menu.description, '');
  });

  test('catches the mistakes Discord would reject', () => {
    const bad = [
      defineCommand({ name: 'Bad Name', description: 'x', async run() {} }),
      defineCommand({ name: 'long', description: 'x'.repeat(101), async run() {} }),
      defineCommand({
        name: 'order',
        description: 'Optional before required',
        options: { a: opt.string('A').optional(), b: opt.string('B') },
        async run() {},
      }),
      defineCommand({
        name: 'auto',
        description: 'Autocomplete without a handler',
        subcommands: { go: subcommand({ description: 'Go', options: { q: opt.string('Q').autocomplete() }, async run() {} }) },
      }),
      defineCommand({ name: 'nothing', description: 'No run and no subcommands' }),
      defineCommand({
        name: 'choices',
        description: 'Too many choices',
        options: { c: opt.string('C').choices(...Array.from({ length: 26 }, (_, i) => `c${i}`)) },
        async run() {},
      }),
      defineCommand({ name: 'range', description: 'Min above max', options: { n: opt.integer('N').min(5).max(1) }, async run() {} }),
      defineCommand({ name: 'dup', description: 'One', async run() {} }),
      defineCommand({ name: 'dup', description: 'Two', async run() {} }),
      defineMessageMenu({ name: 'x'.repeat(33), async run() {} }),
    ];
    const problems = validateCommands(bad).join('\n');
    for (const want of [
      /\/Bad Name: name must be 1-32 lowercase/,
      /\/long: description must be 1-100 characters \(it is 101\)/,
      /\/order \[b\]: required options must come before optional ones/,
      /\/auto \[q\]: marked .autocomplete\(\) but has no autocomplete handler/,
      /\/nothing: needs a run function/,
      /\/choices \[c\]: 1-25 choices \(has 26\)/,
      /\/range \[n\]: min value is above max value/,
      /dup: defined 2 times/,
      /menu command names are 1-32 characters/,
    ]) {
      assert.match(problems, want);
    }
  });
});
