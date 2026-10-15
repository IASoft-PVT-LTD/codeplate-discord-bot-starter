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

async function setUp() {
  const panel = (await t.slash('welcome', {}, { sub: 'setup', as: t.owner })).reply!;
  await t.select(panel, 'welcome:channel', [t.welcomeChannel.id], { as: t.owner });
  await t.select(panel, 'welcome:role', [t.roles.member.id], { as: t.owner });
  await t.click(panel, 'welcome:toggle', { as: t.owner });
  return panel;
}

describe('/welcome', () => {
  test('setup shows a private panel with channel and role menus and buttons', async () => {
    const r = await t.slash('welcome', {}, { sub: 'setup', as: t.owner });
    assert.equal(r.ephemeral, true);
    assert.deepEqual(customIds(r.reply), ['welcome:channel', 'welcome:role', 'welcome:edit', 'welcome:test', 'welcome:toggle']);
    assert.match(textOf(r.reply), /Status\nOff/);
    assert.match(textOf(r.reply), /Pick a channel/);
  });

  test('only managers can use it: Manage Server, then the manager role the owner picks', async () => {
    const r = await t.slash('welcome', {}, { sub: 'setup', as: t.alice });
    assert.match(textOf(r.reply), /Only members with the \*\*Manage Server\*\* permission/);
    assert.match(textOf((await t.slash('welcome', {}, { sub: 'setup', as: t.mod })).reply), /Only members with/);
    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    const panel = await t.slash('welcome', {}, { sub: 'setup', as: t.mod });
    assert.deepEqual(customIds(panel.reply).slice(0, 2), ['welcome:channel', 'welcome:role']);
    // The panel's menus and buttons need a manager too.
    const click = await t.click(panel.reply!, 'welcome:toggle', { as: t.alice });
    assert.match(textOf(click.reply), /Only managers/);
  });

  test('a new member gets the message in the channel and the auto-role', async () => {
    const panel = await setUp();
    assert.match(textOf(panel), /Status\nOn/);
    const newbie = t.discord.addUser({ username: 'newbie', globalName: 'Nova' });
    await t.join(newbie);
    const msg = t.discord.lastMessage(t.welcomeChannel.id)!;
    assert.equal(msg.content, `<@${newbie.id}>`);
    assert.match(textOf(msg), /Welcome to \*\*Maple Makers\*\*, <@\d+>! You are member #6/);
    assert.ok(t.guild.members.get(newbie.id)!.roles.includes(t.roles.member.id), 'auto-role given');
    assert.deepEqual(t.problems(), []);
  });

  test('the message is edited in a form, with placeholders', async () => {
    const panel = (await t.slash('welcome', {}, { sub: 'setup', as: t.owner })).reply!;
    const edit = await t.click(panel, 'welcome:edit', { as: t.owner });
    assert.equal(edit.callbackType, 9, 'opens a modal');
    await t.submitModal(edit.modal!, { message: 'Hey {name}, welcome to {server}!' }, { as: t.owner, message: panel });
    assert.match(textOf(panel), /Hey Sam, welcome to Maple Makers!/);
  });

  test('warns when the bot cannot give the role, and logs (not crashes) on join', async () => {
    const vip = t.discord.addRole(t.guild, { name: 'VIP' }); // created after the bot's role: above it
    // Restart so the bot sees the new role.
    const { db, discord, clock } = t;
    await t.huddle.stop();
    t = await startTestBot({ db, discord, clock });
    const panel = (await t.slash('welcome', {}, { sub: 'setup', as: t.owner })).reply!;
    await t.select(panel, 'welcome:channel', [t.welcomeChannel.id], { as: t.owner });
    await t.select(panel, 'welcome:role', [vip.id], { as: t.owner });
    assert.match(textOf(panel), /My role must be above <@&\d+>/);
    await t.click(panel, 'welcome:toggle', { as: t.owner });
    await t.join(t.discord.addUser({ username: 'late' }));
    assert.ok(t.problems().some((l) => /auto-role/.test(l.msg)));
    db.close();
  });

  test('test and off', async () => {
    await setUp();
    const test1 = await t.slash('welcome', {}, { sub: 'test', as: t.owner });
    assert.match(textOf(test1.reply), /Posted a test in <#\d+>/);
    assert.match(textOf(t.discord.lastMessage(t.welcomeChannel.id)), /\(test\)/);
    await t.slash('welcome', {}, { sub: 'off', as: t.owner });
    const count = t.discord.channelMessages(t.welcomeChannel.id).length;
    await t.join(t.discord.addUser({ username: 'quiet' }));
    assert.equal(t.discord.channelMessages(t.welcomeChannel.id).length, count);
  });

  test('cannot turn on without a channel', async () => {
    const panel = (await t.slash('welcome', {}, { sub: 'setup', as: t.owner })).reply!;
    const r = await t.click(panel, 'welcome:toggle', { as: t.owner });
    assert.match(textOf(r.reply), /Pick a channel first/);
  });
});
