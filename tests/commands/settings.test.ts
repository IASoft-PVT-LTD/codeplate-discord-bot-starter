// The manager role: the owner picks it in Discord with /settings manager-role;
// `who: 'manager'` commands (/welcome) and data rules (closing a poll) follow it.
// Test server: owner (Admin role, owns the server), mod (Moderator: Manage
// Messages), alice and bob (Member).
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
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

const canSetUpWelcome = async (as: TestBot['alice']) => !/Only/.test(textOf((await t.slash('welcome', {}, { sub: 'setup', as })).reply));
const helpFor = async (as: TestBot['alice']) => textOf((await t.slash('help', {}, { as })).reply);

describe('/settings and the manager role', () => {
  test('only the server owner picks the manager role', async () => {
    const r = await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.mod });
    assert.match(textOf(r.reply), /Only the server owner/);
    assert.equal(t.huddle.bot.settings.get(t.guild.id).managers.roleId, null);
    const ok = await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    assert.equal(ok.ephemeral, true);
    assert.match(textOf(ok.reply), new RegExp(`Members with <@&${t.roles.moderator.id}> are now managers`));
    assert.equal(t.huddle.bot.settings.get(t.guild.id).managers.roleId, t.roles.moderator.id);
  });

  test('refuses @everyone and roles managed by an integration', async () => {
    const everyone = t.guild.roles[0]!;
    assert.match(textOf((await t.slash('settings', { role: everyone }, { sub: 'manager-role', as: t.owner })).reply), /everyone a manager/);
    assert.match(textOf((await t.slash('settings', { role: t.roles.botRole }, { sub: 'manager-role', as: t.owner })).reply), /belongs to a bot or integration/);
  });

  test('without a role, Manage Server decides; with one, the role does; the owner always counts', async () => {
    const organizer = await t.createRole({ name: 'Organizer', permissions: PermissionFlagsBits.ManageGuild });
    await t.setRoles(t.bob, [t.roles.member, organizer]);
    assert.equal(await canSetUpWelcome(t.bob), true, 'Manage Server');
    assert.equal(await canSetUpWelcome(t.mod), false);
    assert.equal(await canSetUpWelcome(t.alice), false);

    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    assert.equal(await canSetUpWelcome(t.mod), true, 'the manager role');
    assert.equal(await canSetUpWelcome(t.bob), false, 'Manage Server no longer counts');
    assert.equal(await canSetUpWelcome(t.owner), true, 'the owner, without the role');
    const denied = await t.slash('welcome', {}, { sub: 'setup', as: t.alice });
    assert.match(textOf(denied.reply), new RegExp(`Only managers \\(members with <@&${t.roles.moderator.id}>\\)`));

    // Clearing it (no role given) goes back to Manage Server.
    const cleared = await t.slash('settings', {}, { sub: 'manager-role', as: t.owner });
    assert.match(textOf(cleared.reply), /No manager role now/);
    assert.equal(await canSetUpWelcome(t.bob), true);
    assert.equal(await canSetUpWelcome(t.mod), false);
  });

  test('Administrators always count', async () => {
    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    await t.setRoles(t.alice, [t.roles.member, t.roles.admin]);
    assert.equal(await canSetUpWelcome(t.alice), true);
  });

  test('if the manager role is deleted, Manage Server counts again, and /settings show says so', async () => {
    const helpers = await t.createRole({ name: 'Helpers' });
    await t.setRoles(t.alice, [t.roles.member, helpers]);
    await t.slash('settings', { role: helpers }, { sub: 'manager-role', as: t.owner });
    assert.equal(await canSetUpWelcome(t.alice), true);
    await t.deleteRole(helpers);
    assert.equal(await canSetUpWelcome(t.alice), false);
    const denied = await t.slash('welcome', {}, { sub: 'setup', as: t.alice });
    assert.match(textOf(denied.reply), /Manage Server/);
    assert.equal(await canSetUpWelcome(t.owner), true);
    const show = await t.slash('settings', {}, { sub: 'show', as: t.alice });
    assert.match(textOf(show.reply), /Manage Server.*\n.*has been deleted/);
    assert.deepEqual(t.problems(), []);
  });

  test('/settings show: the managers and the time zone', async () => {
    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    const show = await t.slash('settings', {}, { sub: 'show', as: t.bob });
    assert.equal(show.ephemeral, true);
    assert.match(textOf(show.reply), new RegExp(`Members with <@&${t.roles.moderator.id}>`));
    assert.match(textOf(show.reply), /Time zone\nUTC \(now Wed 14 Oct 2026, 12:00 UTC\)/);
  });

  test('/help lists only what the member can run, following the manager role', async () => {
    assert.doesNotMatch(await helpFor(t.mod), /\/welcome/);
    assert.match(await helpFor(t.mod), /\/settings/, '/settings show is for everyone');
    assert.doesNotMatch(await helpFor(t.mod), /manager-role/, 'owner only');
    assert.match(await helpFor(t.owner), /`\/settings manager-role`/);
    assert.match(await helpFor(t.owner), /\/welcome/);
    await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
    assert.match(await helpFor(t.mod), /\/welcome setup/);
    assert.doesNotMatch(await helpFor(t.alice), /\/welcome/);
  });
});
