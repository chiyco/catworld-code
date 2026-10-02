-- Additive migration: does not replace any existing account or inventory.
CREATE TABLE IF NOT EXISTS friendships (
 a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 requester TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(a,b), CHECK(a<b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b,status);
CREATE TABLE IF NOT EXISTS direct_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 op_id TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(sender_id,op_id)
);
CREATE INDEX IF NOT EXISTS dm_recipient ON direct_messages(recipient_id,sender_id,seq);
CREATE INDEX IF NOT EXISTS dm_sender ON direct_messages(sender_id,recipient_id,seq);
CREATE TABLE IF NOT EXISTS friend_reads (
 user_id TEXT NOT NULL, peer_id TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,peer_id)
);
CREATE TABLE IF NOT EXISTS ai_turns (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 op_id TEXT NOT NULL, content TEXT NOT NULL, response TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),
 error TEXT, created_at INTEGER NOT NULL,
 UNIQUE(user_id,op_id)
);
CREATE INDEX IF NOT EXISTS ai_user ON ai_turns(user_id,seq);
CREATE TABLE IF NOT EXISTS ai_locks (
 user_id TEXT PRIMARY KEY, op_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
