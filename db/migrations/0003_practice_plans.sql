CREATE TABLE practice_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en','ru','az')),
  status TEXT NOT NULL CHECK (status IN ('ready','fallback')),
  focus TEXT NOT NULL,
  plan TEXT NOT NULL,
  practice_tags TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  validation_errors TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX practice_plans_user ON practice_plans(user_id, created_at DESC);
