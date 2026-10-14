// Finds a browser for screenshots (npm run shots, npm run avatar). In order:
//   1. PW_CHANNEL, if set (chrome, msedge…): that installed browser
//   2. Playwright's own Chromium, if `npm run setup` installed it
//   3. an installed Chrome, then Edge
//   4. otherwise it installs Playwright's Chromium once (about 150 MB)
// The checks never need a browser.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';

export async function launchBrowser(log: (s: string) => void = console.log): Promise<Browser> {
  const channel = process.env.PW_CHANNEL;
  if (channel) {
    log(`browser: ${channel} (from PW_CHANNEL)`);
    return chromium.launch({ channel });
  }
  if (existsSync(chromium.executablePath())) return chromium.launch();
  for (const c of ['chrome', 'msedge']) {
    try {
      const b = await chromium.launch({ channel: c });
      log(`browser: the installed ${c === 'chrome' ? 'Chrome' : 'Edge'} (set PW_CHANNEL to choose, or run \`npm run setup\` for Playwright's Chromium)`);
      return b;
    } catch {
      // not installed; try the next one
    }
  }
  log("browser: none found, so installing Playwright's Chromium once…");
  const r = spawnSync('npx playwright install chromium', { stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error("Couldn't install a browser. Run `npm run setup`, install Chrome or Edge, or set PW_CHANNEL (chrome, msedge).");
  return chromium.launch();
}
