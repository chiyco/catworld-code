PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS player_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scene TEXT NOT NULL DEFAULT '/',
  status TEXT NOT NULL DEFAULT '在线',
  last_seen INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS presence_seen_idx ON presence(last_seen);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('ft', 'shoot')),
  challenger_id TEXT NOT NULL REFERENCES users(id),
  opponent_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('INVITED', 'PICKS', 'BATTLE', 'FINISHED', 'CANCELLED')),
  seed TEXT,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rooms_challenger_idx ON rooms(challenger_id, status);
CREATE INDEX IF NOT EXISTS rooms_opponent_idx ON rooms(opponent_id, status);

CREATE TABLE IF NOT EXISTS auth_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS operations (user_id TEXT NOT NULL, op_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,op_id));
CREATE INDEX IF NOT EXISTS operations_expiry ON operations(created_at);
CREATE TABLE IF NOT EXISTS settlements (room_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS match_history (id TEXT PRIMARY KEY, mode TEXT NOT NULL, challenger_id TEXT NOT NULL, opponent_id TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
