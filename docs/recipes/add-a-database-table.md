# Add a database table

Use this when a feature must remember things: birthdays, RSVPs, warnings, a reading list, points. For a per-server option, use settings instead (`per-server-settings.md`).

## Steps

1. **Write a migration**: `migrations/NNN_<what>.sql` with the next number (after `004_tags_and_quotes.sql` comes `005_…`). Never edit a migration that has run anywhere; add a new one to change a table.

   ```sql
   -- /birthday: one birthday per member per server.
   CREATE TABLE birthdays (
     guild_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
     day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (guild_id, user_id)
   );
   CREATE INDEX birthdays_date ON birthdays (month, day);
   ```

   Conventions: Discord ids are `TEXT`; times are Unix milliseconds `INTEGER`; every row that belongs to a server has `guild_id` (servers' data must never mix); add the indexes your queries need. Changing a table later: `ALTER TABLE … ADD COLUMN …` in a new migration (SQLite can't drop or change columns easily: create a new table, copy, drop, rename, in one migration).

2. **Write the data functions** in `src/data/<feature>.ts`: a TypeScript interface, a row type, a `toX(row)` mapper (snake_case → camelCase) and small functions that take the `Db` first (copy `src/data/tags.ts`). Always pass values as `?` parameters, never by building SQL strings. Use `transaction(db, () => …)` from `src/core/db.ts` for several writes that must all happen.

3. **Use them** from the command file. The database is `bot.db`; it's synchronous (no `await`), and fast for a bot's scale.

4. **Test it.** Data functions can be tested on `openDb(':memory:')` directly; the command test (`tests/commands/<feature>.test.ts`) exercises them end to end. `tests/core/db.test.ts` already checks that every migration applies to an empty database.

5. **Existing bots:** the new migration runs automatically when the bot starts (`openDb` → `migrate`). Back up `.data/bot.db` before deploying a migration that changes existing tables (`deploy.md`).

## Verify

1. `npm run check` ends with `CODEPLATE CHECKS: PASS` (the `migrations` step applies every migration to an empty database; the tests use them).
2. A test reads back what a command stored, and a test shows one server can't see another's rows.
3. If the table holds personal data, note in `docs/project.md` what's stored and how a member can have it removed.
