// Every command the bot has, in the order /help lists them. A new command
// file must be added here (the checks fail if a file in this folder isn't).
// After changing names, options or descriptions, run `npm run register`.
import type { AnyCommand } from '../core/command.ts';
import about from './about.ts';
import help from './help.ts';
import poll from './poll.ts';
import purge from './purge.ts';
import quote from './quote.ts';
import remind from './remind.ts';
import saveQuote from './save-quote.ts';
import settings from './settings.ts';
import tag from './tag.ts';
import welcome from './welcome.ts';

export const commands: readonly AnyCommand[] = [poll, remind, tag, quote, saveQuote, welcome, purge, settings, help, about];
