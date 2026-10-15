-- /remind: each reminder has a job (jobs.id) that fires it, even after a restart.

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  job_id INTEGER REFERENCES jobs (id),
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX reminders_user ON reminders (guild_id, user_id, sent_at);
