# Project decisions

<!-- codeplate:project-stub -->

This file is still the template stub. The agent replaces it after interviewing the user (see "Interview" in AGENTS.md), then adds every later decision here, so a future session knows what was agreed.

Suggested layout once filled in:

- **Bot name and one-line purpose:**
- **The server(s):** what the community is, roughly how many members, one server or many
- **Commands:** keep / change / remove / add, one line each
- **Who can use what:** roles and permissions per command (e.g. "/purge: Manage Messages", "/welcome: managers"), and who manages the bot (the owner picks the manager role with /settings manager-role; Manage Server until then)
- **Time zone:** the community's IANA zone for times of day and "every Monday at 9:00" (`BOT.timezone`, default UTC)
- **Welcome, reminders, polls:** settings and wording decisions
- **Voice:** how the bot talks (friendly, formal, playful), emoji or not
- **Look:** embed colors, avatar
- **Where it runs:** PC while testing, VPS (systemd), Docker, Railway, Fly…; who restarts it
- **Discord setup:** application created? intents switched on? test server id? (never the token itself)
- **Data:** anything that must be kept or exported; backups
- **Open questions:**
- **Log:** one dated line per notable change
