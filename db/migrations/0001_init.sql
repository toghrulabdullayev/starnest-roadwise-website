CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ru','az')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);

CREATE TABLE device_links (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','consumed','expired')),
  client TEXT,
  client_version TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE game_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  client TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE drives (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_drive_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'game' CHECK (source IN ('game','fixture')),
  mode TEXT NOT NULL,
  district TEXT,
  route_id TEXT,
  started_at TEXT,
  duration_s REAL,
  distance_m REAL,
  exam_passed INTEGER,
  telemetry TEXT NOT NULL,
  metrics TEXT,
  readiness TEXT,
  history TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, client_drive_id)
);
CREATE INDEX drives_user_started ON drives(user_id, started_at DESC);

CREATE TABLE drive_debriefs (
  drive_id TEXT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','fallback','error')),
  debrief TEXT,
  model TEXT,
  prompt_version TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  attempts INTEGER DEFAULT 0,
  validation_errors TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (drive_id, locale)
);
