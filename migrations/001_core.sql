-- Per-server settings (one JSON document per server, shape in src/core/settings.ts)
-- and the job queue the scheduler runs (src/core/scheduler.ts).
-- Times are Unix milliseconds (INTEGER); ids from Discord are TEXT (snowflakes
-- don't fit in a JavaScript number).

CREATE TABLE guild_settings (
  guild_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- "<command>:<job>", e.g. "remind:fire"
  run_at INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX jobs_due ON jobs (status, run_at);
