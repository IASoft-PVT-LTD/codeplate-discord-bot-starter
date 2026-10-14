// Screenshots of the bot's replies, drawn from the exact JSON the real handlers
// send (on the fake Discord), so you can look at embeds, buttons, menus and
// forms without a Discord account.
//
//   npm run shots                      every scenario → shots/<name>.png
//   npm run shots -- poll welcome-setup   only these
//   npm run shots -- --list            the scenario names
//   npm run shots -- --width=420       a narrower (phone-like) column
//   npm run shots -- --media           also copy the PNGs to docs/media/
//
// Scenarios live in scripts/preview/scenarios.ts; add one for each new command.
// It's an approximation of Discord's dark theme for checking layout and
// wording: confirm the final look in a real test server.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './lib/browser.ts';
import { buildScenes } from './preview/build.ts';
import { scenarios } from './preview/scenarios.ts';

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of scenarios) console.log(`${s.name.padEnd(18)} ${s.title}`);
  process.exit(0);
}
const width = Number(args.find((a) => a.startsWith('--width='))?.slice(8) ?? 760);
const media = args.includes('--media');
const names = args.filter((a) => !a.startsWith('--'));

const scenes = await buildScenes(names);
mkdirSync('shots', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: 1 });
let failed = 0;
for (const s of scenes) {
  const html = s.html.replace('<div class="scene"', `<div class="scene" style="--w:${width}px"`);
  const htmlPath = join('shots', `${s.name}.html`);
  writeFileSync(htmlPath, html);
  await page.setContent(html);
  const png = join('shots', `${s.name}.png`);
  await page.locator('.scene').screenshot({ path: png });
  if (media) {
    mkdirSync(join('docs', 'media'), { recursive: true });
    copyFileSync(png, join('docs', 'media', `${s.name}.png`));
  }
  for (const p of s.problems) console.log(`  ! ${s.name}: ${p}`);
  failed += s.problems.length ? 1 : 0;
  console.log(`${png}  (${s.title})`);
}
await browser.close();
if (failed) {
  console.log(`${failed} scenario(s) logged problems: fix them.`);
  process.exitCode = 1;
}
