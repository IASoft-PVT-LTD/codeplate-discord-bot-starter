// Registers the slash commands with Discord. Run it after adding a command or
// changing a name, option or description (not after changing only handler code).
//
//   npm run register                 to DEV_GUILD_ID if set (instant), else globally
//   npm run register -- --global     globally (all servers; can take a minute)
//   npm run register -- --dry-run    print the JSON Discord would get; send nothing
//   npm run register -- --clear      remove every command (in DEV_GUILD_ID, or with --global)
//
// Needs DISCORD_TOKEN and DISCORD_APPLICATION_ID in .env.
import { REST } from 'discord.js';
import { commands } from '../src/commands/index.ts';
import { loadEnv } from '../src/config.ts';
import { allCommandJson, validateCommands } from '../src/core/definitions.ts';
import { registerCommands } from '../src/core/deploy.ts';

const args = new Set(process.argv.slice(2));
const problems = validateCommands(commands);
if (problems.length) {
  console.error(`Fix the command definitions first:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

if (args.has('--dry-run')) {
  console.log(JSON.stringify(allCommandJson(commands), null, 2));
  process.exit(0);
}

const env = loadEnv();
if (!env.DISCORD_TOKEN || !env.DISCORD_APPLICATION_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_APPLICATION_ID in .env (see docs/recipes/register-commands-and-invite.md).');
  process.exit(1);
}
const guildId = args.has('--global') ? undefined : env.DEV_GUILD_ID;
const rest = new REST().setToken(env.DISCORD_TOKEN);
const count = await registerCommands(rest, env.DISCORD_APPLICATION_ID, args.has('--clear') ? [] : commands, guildId);
console.log(
  `${args.has('--clear') ? 'Cleared' : `Registered ${count}`} command(s) ${guildId ? `in server ${guildId} (they appear at once)` : 'globally (they can take a minute to appear; restart Discord with Ctrl+R if not)'}.`,
);
