// The checks: one command that tells you whether the bot still works.
//   npm run check
// No Discord token, no network, no browser. Runs, in order:
//   env         every environment variable the code reads is documented in .env.example
//   migrations  migrations/ is numbered without gaps and applies to an empty database
//   commands    every command follows Discord's rules (names, descriptions ≤ 100,
//               option limits, choices…) and is listed in src/commands/index.ts;
//               writes the JSON Discord would receive to .data/commands.json
//   typecheck   tsc (strict)
//   lint        eslint
//   test        node --test: every command end-to-end through the real handlers
//               and the real discord.js client on a fake Discord (tests/fake/),
//               reminders and polls with a fake clock, restarts, permissions, the credit
//   preview     renders every screenshot scenario to HTML (scripts/preview/), so
//               `npm run shots` keeps working; no browser needed
// A failing step doesn't stop the later ones, so one run shows every problem.
// The last line is CODEPLATE CHECKS: PASS or CODEPLATE CHECKS: FAIL (<n> failed).
//   --skip=lint,preview   skip steps (for a quick loop; always finish with a full run)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const skip = new Set((process.argv.find((a) => a.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean));
const results = [];
let stepOutput = '';

// Runs a command through the shell (npx needs one on Windows) and captures its output.
function sh(command) {
  const r = spawnSync(command, { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out);
  stepOutput += out;
  return r.status === 0;
}

async function step(name, fn) {
  if (skip.has(name)) {
    console.log(`\n--- ${name}: skipped`);
    results.push({ name, ok: true, skipped: true });
    return;
  }
  console.log(`\n--- ${name}`);
  const start = Date.now();
  stepOutput = '';
  const log = console.log;
  console.log = (...a) => {
    stepOutput += `${a.join(' ')}\n`;
    log(...a);
  };
  let ok = false;
  try {
    ok = await fn();
  } catch (e) {
    console.log(e?.stack ?? String(e));
  } finally {
    console.log = log;
  }
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`--- ${name}: ${ok ? 'pass' : 'FAIL'} (${seconds}s)`);
  results.push({ name, ok, seconds, tail: ok ? '' : stepOutput.trim().split('\n').slice(-40).join('\n') });
}

function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Set by Node or the tools, not by the bot's owner.
const PLATFORM_VARS = new Set(['NODE_ENV', 'CI', 'PW_CHANNEL', 'FORCE_COLOR']);

await step('env', async () => {
  const documented = new Set([...readFileSync('.env.example', 'utf8').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const { ENV_KEYS } = await import('../src/config.ts');
  const read = new Map(ENV_KEYS.map((k) => [k, 'src/config.ts']));
  for (const f of [...sourceFiles('src'), ...sourceFiles('scripts')]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!PLATFORM_VARS.has(m[1])) read.set(m[1], f);
  }
  let ok = true;
  for (const [v, f] of read) {
    if (!documented.has(v)) {
      console.log(`${v} (read in ${f}) is not in .env.example: add it there with a comment.`);
      ok = false;
    }
  }
  for (const v of documented) {
    if (!read.has(v)) {
      console.log(`${v} is in .env.example but nothing reads it: remove it, or add it to EnvSchema in src/config.ts.`);
      ok = false;
    }
  }
  if (ok) console.log(`${documented.size} variables, all documented in .env.example`);
  return ok;
});

await step('migrations', async () => {
  const { loadMigrations, migrate } = await import('../src/core/db.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const migrations = loadMigrations();
  const db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  const again = migrate(db, migrations);
  db.close();
  console.log(`${migrations.length} migrations apply cleanly: ${migrations.map((m) => m.file).join(', ')}`);
  return again.length === 0;
});

await step('commands', async () => {
  const { commands } = await import('../src/commands/index.ts');
  const { validateCommands, allCommandJson } = await import('../src/core/definitions.ts');
  const problems = validateCommands(commands);
  const files = readdirSync('src/commands').filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  if (files.length !== commands.length) {
    problems.push(`src/commands/ has ${files.length} command files but src/commands/index.ts lists ${commands.length}: add the new file to the list.`);
  }
  for (const p of problems) console.log(p);
  mkdirSync('.data', { recursive: true });
  writeFileSync('.data/commands.json', JSON.stringify(allCommandJson(commands), null, 2));
  if (!problems.length) console.log(`${commands.length} commands follow Discord's rules (the JSON is in .data/commands.json)`);
  return problems.length === 0;
});

await step('typecheck', () => sh('npx tsc --noEmit'));

await step('lint', () => sh('npx eslint .'));

await step('test', () => sh('node --test --test-reporter=dot "tests/**/*.test.ts"') || (sh('node --test --test-reporter=spec "tests/**/*.test.ts"'), false));

await step('preview', async () => {
  const { buildScenes } = await import('../scripts/preview/build.ts');
  const scenes = await buildScenes();
  mkdirSync('.data/preview', { recursive: true });
  let ok = true;
  for (const s of scenes) {
    writeFileSync(join('.data/preview', `${s.name}.html`), s.html);
    for (const p of s.problems) {
      console.log(`${s.name}: ${p}`);
      ok = false;
    }
  }
  console.log(`${scenes.length} scenarios rendered to .data/preview/ (npm run shots makes PNGs)`);
  return ok;
});

const failed = results.filter((r) => !r.ok);
for (const r of failed.filter((f) => f.tail)) console.log(`\n=== ${r.name} failed; the end of its output:\n${r.tail}`);
console.log(`\n${results.map((r) => `${r.ok ? (r.skipped ? 'skip' : 'pass') : 'FAIL'}  ${r.name}${r.seconds ? ` (${r.seconds}s)` : ''}`).join('\n')}`);
console.log(failed.length ? `CODEPLATE CHECKS: FAIL (${failed.length} failed)` : 'CODEPLATE CHECKS: PASS');
process.exitCode = failed.length ? 1 : 0;
