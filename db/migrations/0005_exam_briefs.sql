CREATE TABLE exam_briefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  drive_id TEXT REFERENCES drives(id) ON DELETE SET NULL,
  comparison TEXT,
  compared_at TEXT
);
CREATE INDEX exam_briefs_user ON exam_briefs(user_id, created_at DESC);
CREATE INDEX exam_briefs_drive ON exam_briefs(drive_id);
