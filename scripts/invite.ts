// Prints the link that adds the bot to a server, with exactly the permissions
// its commands need (computed from botPermissions in src/commands/).
//   npm run invite
// Needs DISCORD_APPLICATION_ID in .env (no token).
import { commands } from '../src/commands/index.ts';
import { loadEnv } from '../src/config.ts';
import { invitePermissions, inviteUrl } from '../src/core/deploy.ts';

const env = loadEnv();
if (!env.DISCORD_APPLICATION_ID) {
  console.error('Set DISCORD_APPLICATION_ID in .env (Developer Portal → your app → General Information → Application ID).');
  process.exit(1);
}
const perms = invitePermissions(commands);
console.log(`Permissions: ${perms.toArray().join(', ')}\n`);
console.log(inviteUrl(env.DISCORD_APPLICATION_ID, perms));
console.log('\nOpen it, pick your server, and keep every permission ticked.');
