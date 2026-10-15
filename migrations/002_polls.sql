-- /poll: a question with 2-5 choices and one vote per member.

CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,                 -- set once the poll message is posted
  author_id TEXT NOT NULL,
  question TEXT NOT NULL,
  choices TEXT NOT NULL,           -- JSON array of strings
  closes_at INTEGER,               -- NULL = open until closed by hand
  closed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  choice INTEGER NOT NULL,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
