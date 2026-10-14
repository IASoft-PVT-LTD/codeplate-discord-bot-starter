// What `npm run shots` shows: each scenario drives the test bot (the real
// handlers on the fake Discord, tests/fake/) and returns the messages, forms
// and menus to draw. Add a scenario when you add a command, so you (and the
// agent) can look at it. Names are what you pass to `npm run shots -- <name>`.
import type { InteractionRecord } from '../../tests/fake/discord.ts';
import type { TestBot } from '../../tests/fake/harness.ts';
import type { Scene, Shown } from './render.ts';

export interface Scenario {
  name: string;
  title: string;
  run(t: TestBot): Promise<Omit<Scene, 'name' | 'title'>>;
}

const MIN = 60_000;

// "/poll question:… answers:…" → "/poll" (Discord shows only the command's name).
function commandName(label: string): string {
  if (label.startsWith('Apps → ')) return label.slice(7);
  const words: string[] = [];
  for (const w of label.split(' ')) {
    if (w.includes(':')) break;
    words.push(w);
  }
  return words.join(' ');
}

// The response of an interaction as something to draw.
function shown(r: InteractionRecord, opts: { followUps?: boolean } = {}): Shown[] {
  const out: Shown[] = [];
  const msg = r.reply ?? r.updated;
  if (msg) out.push({ kind: 'message', message: msg, label: r.kind === 'command' || r.kind === 'menu' ? commandName(r.label) : undefined });
  if (opts.followUps) for (const f of r.followUps) out.push({ kind: 'message', message: f });
  if (r.modal) out.push({ kind: 'modal', modal: r.modal });
  return out;
}

async function extraMembers(t: TestBot, names: string[]) {
  return names.map((n) => {
    const u = t.discord.addUser({ username: n.toLowerCase(), globalName: n });
    t.discord.addMember(t.guild, u, [t.roles.member]);
    return u;
  });
}

export const scenarios: Scenario[] = [
  {
    name: 'help',
    title: '/help, as an admin',
    async run(t) {
      return { channel: 'general', items: shown(await t.slash('help', {}, { as: t.owner })) };
    },
  },
  {
    name: 'about',
    title: '/about with the credit',
    async run(t) {
      return { channel: 'general', items: shown(await t.slash('about')) };
    },
  },
  {
    name: 'poll',
    title: 'A poll after a few votes',
    async run(t) {
      const r = await t.slash('poll', { question: 'Where should the June meetup be?', answers: 'Library room; Café on Main St; Online', duration: '2d' }, { as: t.alice });
      const voters = [t.bob, t.mod, t.owner, ...(await extraMembers(t, ['Priya', 'Jonas', 'Mei']))];
      const picks = [0, 1, 0, 0, 2, 0];
      let last: InteractionRecord = r;
      for (const [i, v] of voters.entries()) last = await t.click(r.reply!, `poll:vote:1:${picks[i]}`, { as: v });
      return { channel: 'general', items: [...shown(r), { kind: 'message', message: last.followUps[0]! }] };
    },
  },
  {
    name: 'poll-closed',
    title: 'A poll closed by its timer',
    async run(t) {
      const r = await t.slash('poll', { question: 'Pizza or tacos for the party?', answers: 'Pizza; Tacos', duration: '1h' }, { as: t.alice });
      for (const [i, v] of [t.bob, t.mod, t.owner].entries()) await t.click(r.reply!, `poll:vote:1:${i === 0 ? 0 : 1}`, { as: v });
      await t.advance(61 * MIN);
      return { channel: 'general', items: shown(r) };
    },
  },
  {
    name: 'remind',
    title: '/remind me, then the reminder',
    async run(t) {
      const r = await t.slash('remind', { when: '2h', what: 'Post the meeting notes in #announcements' }, { sub: 'me', as: t.alice });
      await t.advance(2 * 60 * MIN + 1000);
      const fired = t.discord.lastMessage(t.general.id)!;
      return { channel: 'general', items: [...shown(r), { kind: 'note', text: '2 hours later' }, { kind: 'message', message: fired }] };
    },
  },
  {
    name: 'remind-every',
    title: '/remind every, then the Monday reminder',
    async run(t) {
      const r = await t.slash('remind', { day: '1', time: '09:00', what: 'Post the agenda for the Thursday meetup in #announcements' }, { sub: 'every', as: t.alice });
      await t.advance((4 * 24 + 21) * 60 * MIN + 30_000); // Wednesday 12:00 → Monday 09:00
      const fired = t.discord.lastMessage(t.general.id)!;
      return { channel: 'general', items: [...shown(r), { kind: 'note', text: 'Monday morning' }, { kind: 'message', message: fired }] };
    },
  },
  {
    name: 'remind-list',
    title: '/remind list',
    async run(t) {
      await t.slash('remind', { when: '2h', what: 'Post the meeting notes' }, { sub: 'me' });
      await t.advance(5000);
      await t.slash('remind', { when: '1d 4h', what: 'Renew the room booking' }, { sub: 'me' });
      await t.advance(5000);
      await t.slash('remind', { day: '5', time: '17:30', what: 'Water the shared plants' }, { sub: 'every' });
      return { channel: 'general', items: shown(await t.slash('remind', {}, { sub: 'list' })) };
    },
  },
  {
    name: 'welcome-setup',
    title: '/welcome setup, after picking a channel and a role',
    async run(t) {
      const r = await t.slash('welcome', {}, { sub: 'setup', as: t.owner });
      await t.select(r.reply!, 'welcome:channel', [t.welcomeChannel.id], { as: t.owner });
      await t.select(r.reply!, 'welcome:role', [t.roles.member.id], { as: t.owner });
      await t.click(r.reply!, 'welcome:toggle', { as: t.owner });
      return { channel: 'general', items: shown(r) };
    },
  },
  {
    name: 'welcome-message',
    title: 'Editing the welcome message (a modal)',
    async run(t) {
      const r = await t.slash('welcome', {}, { sub: 'setup', as: t.owner });
      return { channel: 'general', items: shown(await t.click(r.reply!, 'welcome:edit', { as: t.owner })) };
    },
  },
  {
    name: 'welcome-join',
    title: 'A new member is welcomed',
    async run(t) {
      const r = await t.slash('welcome', {}, { sub: 'setup', as: t.owner });
      await t.select(r.reply!, 'welcome:channel', [t.welcomeChannel.id], { as: t.owner });
      await t.click(r.reply!, 'welcome:toggle', { as: t.owner });
      await t.join(t.discord.addUser({ username: 'nova', globalName: 'Nova' }));
      return { channel: 'welcome', items: [{ kind: 'message', message: t.discord.lastMessage(t.welcomeChannel.id)! }] };
    },
  },
  {
    name: 'settings',
    title: 'The owner picks the manager role; /settings show',
    async run(t) {
      const set = await t.slash('settings', { role: t.roles.moderator }, { sub: 'manager-role', as: t.owner });
      const show = await t.slash('settings', {}, { sub: 'show', as: t.mod });
      return { channel: 'general', items: [...shown(set), ...shown(show)] };
    },
  },
  {
    name: 'help-member',
    title: '/help, as a member: only what they can run',
    async run(t) {
      return { channel: 'general', items: shown(await t.slash('help', {}, { as: t.alice })) };
    },
  },
  {
    name: 'tag',
    title: '/tag show, pointed at a member',
    async run(t) {
      const open = await t.slash('tag', {}, { sub: 'add', as: t.mod });
      await t.submitModal(open.modal!, { name: 'how-to-verify', content: '1. Read **#rules**\n2. Pick your roles in **#roles**\n3. Say hi in **#general**: a mod will verify you within a day.' }, { as: t.mod });
      return { channel: 'general', items: shown(await t.slash('tag', { name: 'how-to-verify', for: t.bob }, { sub: 'show', as: t.mod })) };
    },
  },
  {
    name: 'tag-add',
    title: '/tag add opens a form',
    async run(t) {
      return { channel: 'general', items: shown(await t.slash('tag', {}, { sub: 'add', as: t.mod })) };
    },
  },
  {
    name: 'tag-autocomplete',
    title: 'Tag names autocomplete while typing',
    async run(t) {
      for (const [name, content] of [['rules', 'Be kind.'], ['roles', 'Pick them in #roles.'], ['server-rules-long', 'The long version.']]) {
        const open = await t.slash('tag', {}, { sub: 'add', as: t.mod });
        await t.submitModal(open.modal!, { name: name!, content: content! }, { as: t.mod });
        await t.advance(1000);
      }
      const r = await t.autocomplete('tag', 'name', 'ru', { sub: 'show' });
      return { channel: 'general', items: [{ kind: 'autocomplete', typed: '/tag show name: ru', choices: r.choices ?? [] }] };
    },
  },
  {
    name: 'quote',
    title: 'Right-click → Apps → Save as quote',
    async run(t) {
      const said = t.discord.postAs(t.bob, t.general, 'Glue is just patience in a bottle.');
      const r = await t.messageMenu('Save as quote', said, { as: t.alice });
      return { channel: 'general', items: [{ kind: 'message', message: said }, ...shown(r)] };
    },
  },
  {
    name: 'purge',
    title: '/purge, as a moderator',
    async run(t) {
      for (let i = 0; i < 8; i++) t.discord.postAs(t.bob, t.general, `spam ${i}`);
      return { channel: 'general', items: shown(await t.slash('purge', { count: 8, from: t.bob }, { as: t.mod })) };
    },
  },
  {
    name: 'errors',
    title: 'What members see when something is not allowed',
    async run(t) {
      const denied = await t.slash('purge', { count: 5 }, { as: t.alice });
      const notManager = await t.slash('welcome', {}, { sub: 'setup', as: t.alice });
      const bad = await t.slash('remind', { when: 'next tuesday', what: 'x' }, { sub: 'me', as: t.alice });
      await t.slash('poll', { question: 'One?', answers: 'a; b' }, { as: t.bob });
      const slow = await t.slash('poll', { question: 'Two?', answers: 'a; b' }, { as: t.bob });
      return { channel: 'general', items: [...shown(denied), ...shown(notManager), ...shown(bad), ...shown(slow)] };
    },
  },
];
