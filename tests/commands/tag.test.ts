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

async function addTag(name: string, content: string) {
  const open = await t.slash('tag', {}, { sub: 'add', as: t.mod });
  assert.equal(open.callbackType, 9, 'opens the form');
  return t.submitModal(open.modal!, { name, content }, { as: t.mod });
}

describe('/tag', () => {
  test('moderators add tags through a form; anyone shows them', async () => {
    const saved = await addTag('How To Verify', 'Read #rules, then react with ✅.');
    assert.match(textOf(saved.reply), /Saved the tag `how-to-verify`/);
    const shown = await t.slash('tag', { name: 'how-to-verify', for: t.bob }, { sub: 'show', as: t.alice });
    assert.equal(shown.ephemeral, false);
    assert.equal(shown.reply!.content, `<@${t.bob.id}>`);
    assert.match(textOf(shown.reply), /Read #rules/);
    const list = await t.slash('tag', {}, { sub: 'list' });
    assert.match(textOf(list.reply), /`how-to-verify` · 1 use/);
  });

  test('members without Manage Messages cannot add or delete', async () => {
    const r = await t.slash('tag', {}, { sub: 'add', as: t.alice });
    assert.match(textOf(r.reply), /Manage Messages/);
    const d = await t.slash('tag', { name: 'x' }, { sub: 'delete', as: t.alice });
    assert.match(textOf(d.reply), /Manage Messages/);
  });

  test('autocomplete suggests matching names, prefix matches first', async () => {
    await addTag('rules', 'Be kind.');
    await addTag('roles', 'Ask a mod.');
    await addTag('server-rules-long', 'Long version.');
    const r = await t.autocomplete('tag', 'name', 'ru', { sub: 'show' });
    assert.deepEqual(
      r.choices!.map((c) => c.value),
      ['rules', 'server-rules-long'],
    );
  });

  test('editing an existing tag prefills the form and updates it', async () => {
    await addTag('faq', 'Old answer');
    const open = await t.slash('tag', { name: 'faq' }, { sub: 'add', as: t.mod });
    assert.match(JSON.stringify(open.modal), /Old answer/);
    const r = await t.submitModal(open.modal!, { content: 'New answer' }, { as: t.mod });
    assert.match(textOf(r.reply), /Updated the tag `faq`/);
    const shown = await t.slash('tag', { name: 'faq' }, { sub: 'show' });
    assert.match(textOf(shown.reply), /New answer/);
  });

  test('bad names, missing tags and deletes', async () => {
    const bad = await addTag('no spaces!', 'x');
    assert.match(textOf(bad.reply), /lowercase letters, digits and dashes/);
    const missing = await t.slash('tag', { name: 'nope' }, { sub: 'show' });
    assert.match(textOf(missing.reply), /no tag called `nope`/);
    await addTag('temp', 'x');
    const del = await t.slash('tag', { name: 'temp' }, { sub: 'delete', as: t.mod });
    assert.match(textOf(del.reply), /Deleted the tag `temp`/);
  });
});
