// Every gateway event handler. Add a file here and list it below.
import type { BotEvent } from '../core/event.ts';
import guildCreate from './guild-create.ts';
import guildMemberAdd from './guild-member-add.ts';
import ready from './ready.ts';

export const events: BotEvent[] = [ready, guildCreate, guildMemberAdd];
