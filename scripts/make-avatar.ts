// Draws the bot's avatar (assets/avatar.png, 512×512) from the SVG below.
// Upload it in the Developer Portal (your app → Bot → Icon). To use your own
// picture instead, replace assets/avatar.png with any 512×512 PNG and update
// assets.json (size, license, credit, source).
//   npm run avatar              redraw it (e.g. after changing BOT.colors)
//   npm run avatar -- --force   also when assets/avatar.png is someone's own picture
// It only overwrites an avatar it drew itself (marked inside the PNG, see
// scripts/lib/avatar-mark.ts): a picture the user supplied is left alone
// unless they pass --force.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BOT } from '../src/config.ts';
import { AVATAR_MARK, avatarRefusal, withPngText } from './lib/avatar-mark.ts';
import { launchBrowser } from './lib/browser.ts';

const out = new URL('../assets/avatar.png', import.meta.url);
const refusal = avatarRefusal(existsSync(out) ? readFileSync(out) : null, process.argv.includes('--force'));
if (refusal) {
  console.error(refusal);
  process.exit(1);
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
// Three heads leaning together around a speech bubble: a huddle.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex(BOT.colors.brand)}"/><stop offset="1" stop-color="#3d5fc4"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="#ffffff">
    <circle cx="156" cy="250" r="46" opacity="0.85"/>
    <path d="M86 392c0-52 31-86 70-86s70 34 70 86z" opacity="0.85"/>
    <circle cx="356" cy="250" r="46" opacity="0.85"/>
    <path d="M286 392c0-52 31-86 70-86s70 34 70 86z" opacity="0.85"/>
    <circle cx="256" cy="282" r="54"/>
    <path d="M172 420c0-62 37-102 84-102s84 40 84 102z"/>
  </g>
  <g>
    <rect x="186" y="96" width="140" height="92" rx="30" fill="#ffffff"/>
    <path d="M232 184l-6 36 34-36z" fill="#ffffff"/>
    <circle cx="222" cy="142" r="11" fill="${hex(BOT.colors.brand)}"/>
    <circle cx="256" cy="142" r="11" fill="${hex(BOT.colors.brand)}"/>
    <circle cx="290" cy="142" r="11" fill="${hex(BOT.colors.brand)}"/>
  </g>
</svg>`;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
const png = await page.locator('svg').screenshot({ omitBackground: false });
await browser.close();
writeFileSync(out, withPngText(png, AVATAR_MARK.key, AVATAR_MARK.value));
console.log('wrote assets/avatar.png (512×512)');
