// Small pieces: settings, options, text helpers, env, logging, registering, the invite link and the avatar script.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { describe, test } from 'node:test';
import { REST } from 'discord.js';
import { commands } from '../../src/commands/index.ts';
import { loadEnv } from '../../src/config.ts';
import { FakeClock } from '../../src/core/clock.ts';
import { openDb } from '../../src/core/db.ts';
import { invitePermissions, inviteUrl, registerCommands } from '../../src/core/deploy.ts';
import { createLogger, memoryLogger } from '../../src/core/log.ts';
import { createSettings } from '../../src/core/settings.ts';
import { fill, formatDuration, parseDuration, permissionName, truncate } from '../../src/core/text.ts';
import { FakeDiscord } from '../fake/discord.ts';
import { avatarRefusal, isTemplateAvatar, pngText, withPngText } from '../../scripts/lib/avatar-mark.ts';

describe('settings', () => {
  test('defaults, partial updates and recovery from bad stored data', () => {
    const db = openDb(':memory:');
    const log = memoryLogger();
    const s = createSettings({ db, clock: new FakeClock(), log });
    assert.equal(s.get('1').welcome.enabled, false);
    assert.match(s.get('1').welcome.message, /\{user\}/);
    s.update('1', { welcome: { enabled: true, channelId: '123456789012345678' } });
    assert.equal(s.get('1').welcome.enabled, true);
    assert.equal(s.get('1').welcome.channelId, '123456789012345678');
    assert.match(s.get('1').welcome.message, /\{user\}/, 'other fields kept');
    assert.equal(s.get('2').welcome.enabled, false, 'per server');
    db.prepare("UPDATE guild_settings SET data = '{\"welcome\":{\"enabled\":\"yes\"}}' WHERE guild_id = '1'").run();
    assert.equal(s.get('1').welcome.enabled, false);
    assert.ok(log.lines.some((l) => l.level === 'warn'));
    assert.throws(() => s.update('1', { welcome: { channelId: 'not-a-snowflake' } }));
  });
});

describe('text helpers', () => {
  test('durations', () => {
    assert.equal(parseDuration('10m'), 600_000);
    assert.equal(parseDuration('1d 4h'), 100_800_000);
    assert.equal(parseDuration('1h30m'), 5_400_000);
    assert.equal(parseDuration('2 W'), 1_209_600_000);
    for (const bad of ['', 'soon', '10', '10x', '5m later', '0m']) assert.equal(parseDuration(bad), null, bad);
    assert.equal(formatDuration(5_400_000), '1h 30m');
    assert.equal(formatDuration(90_061_000), '1d 1h');
  });

  test('fill, truncate, permission names', () => {
    assert.equal(fill('Hi {name}, {missing}', { name: 'Ana' }), 'Hi Ana, {missing}');
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(permissionName('ManageGuild'), 'Manage Server');
  });
});

describe('environment', () => {
  test('empty values mean unset; ids are checked', () => {
    const env = loadEnv({ DISCORD_TOKEN: '', LOG_LEVEL: 'debug' });
    assert.equal(env.DISCORD_TOKEN, undefined);
    assert.equal(env.DATABASE_PATH, '.data/bot.db');
    assert.throws(() => loadEnv({ DISCORD_APPLICATION_ID: 'abc' }), /numeric Application ID/);
  });
});

describe('logging', () => {
  test('JSON lines with fields, errors serialized, levels filtered', () => {
    const out: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => out.push(JSON.stringify(l)), now: () => 0 }).child({ guildId: '1' });
    log.debug('hidden');
    log.error('failed', { err: new Error('boom') });
    assert.equal(out.length, 1);
    const line = JSON.parse(out[0]!);
    assert.equal(line.level, 'error');
    assert.equal(line.guildId, '1');
    assert.equal(line.err.message, 'boom');
    assert.equal(line.time, '1970-01-01T00:00:00.000Z');
  });
});

describe('register and invite', () => {
  test('npm run register sends every definition (to the fake Discord)', async () => {
    const discord = new FakeDiscord(new FakeClock());
    const rest = new REST({ makeRequest: discord.makeRequest as never, retries: 0 }).setToken('fake-token-for-tests');
    const count = await registerCommands(rest, discord.applicationId, commands, '123456789012345678');
    assert.equal(count, commands.length);
    const req = discord.requests.at(-1)!;
    assert.equal(req.method, 'PUT');
    assert.equal(req.path, `/applications/${discord.applicationId}/guilds/123456789012345678/commands`);
    assert.deepEqual(
      req.body.map((c: { name: string }) => c.name),
      commands.map((c) => c.name),
    );
  });

  test('the invite link asks for exactly what the commands need', () => {
    const perms = invitePermissions(commands);
    for (const p of ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory', 'ManageMessages', 'ManageRoles'] as const) assert.ok(perms.has(p), p);
    assert.ok(!perms.has('Administrator'), 'never ask for Administrator');
    const url = new URL(inviteUrl('123456789012345678', perms));
    assert.equal(url.searchParams.get('client_id'), '123456789012345678');
    assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
    assert.equal(url.searchParams.get('permissions'), perms.bitfield.toString());
  });
});

describe('npm run avatar', () => {
  const shipped = readFileSync(new URL('../../assets/avatar.png', import.meta.url));

  test("recognizes the avatar it drew, and refuses to overwrite anyone else's unless forced", () => {
    assert.equal(isTemplateAvatar(shipped), true, 'assets/avatar.png carries the generator mark');
    assert.equal(avatarRefusal(shipped, false), null);
    assert.equal(avatarRefusal(null, false), null, 'no avatar yet: draw one');
    // A picture the user supplied: no mark, or saved by another program.
    const plain = Buffer.from(shipped.toString('latin1').replace(/tEXtSoftware/, 'tEXtXoftware'), 'latin1');
    const theirs = withPngText(plain, 'Software', 'Some Paint Program');
    for (const png of [theirs, plain, Buffer.from('not a png')]) {
      assert.equal(isTemplateAvatar(png), false);
      assert.match(avatarRefusal(png, false) ?? '', /npm run avatar -- --force/);
      assert.equal(avatarRefusal(png, true), null, '--force');
    }
  });

  test('the mark is a valid PNG text chunk', () => {
    const marked = withPngText(shipped, 'Comment', 'hello');
    assert.equal(pngText(marked).Comment, 'hello');
    assert.equal(marked.length, shipped.length + 12 + 'Comment'.length + 1 + 'hello'.length);
    // The chunk's CRC covers its type and data.
    const at = marked.indexOf('tEXtComment', 0, 'latin1');
    const length = marked.readUInt32BE(at - 4);
    assert.equal(marked.readUInt32BE(at + 4 + length), crc32(marked.subarray(at, at + 4 + length)));
  });
});
