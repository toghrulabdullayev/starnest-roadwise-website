CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en','ru','az')),
  questions TEXT NOT NULL,
  weak_rules TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  answered_at TEXT,
  correct INTEGER,
  total INTEGER NOT NULL
);
CREATE INDEX quiz_attempts_user ON quiz_attempts(user_id, created_at DESC);
CREATE TABLE quiz_answers (
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  chosen_index INTEGER,
  is_correct INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX quiz_answers_rule ON quiz_answers(rule, is_correct);
