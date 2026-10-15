-- Repeating jobs ("every Monday at 09:00", src/core/scheduler.ts `repeat`) and
-- repeating reminders (/remind every). `repeat` is a JSON rule such as
-- {"every":"week","day":1,"at":"09:00"}, read in the bot's time zone; NULL
-- means "once". A repeating job keeps its id: after each run the scheduler
-- moves its run_at to the next occurrence.

ALTER TABLE jobs ADD COLUMN repeat TEXT;

ALTER TABLE reminders ADD COLUMN repeat TEXT;
