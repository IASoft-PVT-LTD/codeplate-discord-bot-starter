// Runs scenarios and returns their HTML pages (no browser needed). Each
// scenario gets a fresh test bot. Used by scripts/shots.ts and by the checks'
// `preview` step.
import { readFileSync } from 'node:fs';
import { startTestBot } from '../../tests/fake/harness.ts';
import { Renderer } from './render.ts';
import { scenarios } from './scenarios.ts';

export interface BuiltScene {
  name: string;
  title: string;
  html: string;
  problems: string[];
}

const AVATAR = `data:image/png;base64,${readFileSync(new URL('../../assets/avatar.png', import.meta.url)).toString('base64')}`;

export async function buildScenes(names: string[] = []): Promise<BuiltScene[]> {
  const unknown = names.filter((n) => !scenarios.some((s) => s.name === n));
  if (unknown.length) throw new Error(`No scenario called ${unknown.join(', ')}. There are: ${scenarios.map((s) => s.name).join(', ')}`);
  const chosen = names.length ? scenarios.filter((s) => names.includes(s.name)) : scenarios;
  const out: BuiltScene[] = [];
  for (const s of chosen) {
    const t = await startTestBot();
    try {
      const scene = await s.run(t);
      const problems = [
        ...t.discord.unhandled.map((u) => `fake Discord has no route for ${u}`),
        ...t.problems()
          .filter((l) => l.level === 'error')
          .map((l) => `${l.msg}: ${JSON.stringify(l.err ?? '')}`),
      ];
      if (!scene.items.length) problems.push('the scenario showed nothing');
      out.push({ name: s.name, title: s.title, html: new Renderer(t.discord, AVATAR, t.huddle.bot.timezone).page({ name: s.name, title: s.title, ...scene }), problems });
    } finally {
      await t.stop();
    }
  }
  return out;
}
