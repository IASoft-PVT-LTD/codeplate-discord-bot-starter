-- /tag (saved answers, one name per server) and /quote.

CREATE TABLE tags (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,              -- lowercase
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT,                  -- who said it, if they're a member
  author_name TEXT NOT NULL,       -- shown even if they leave
  saved_by TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,                 -- set when saved from a message ("Save as quote")
  created_at INTEGER NOT NULL
);

CREATE INDEX quotes_guild ON quotes (guild_id);
