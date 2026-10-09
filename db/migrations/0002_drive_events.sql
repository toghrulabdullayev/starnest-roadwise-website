CREATE TABLE drive_events (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor','major')),
  fine_azn REAL,
  t_s REAL NOT NULL,
  x REAL,
  z REAL,
  street TEXT,
  detail TEXT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  UNIQUE (drive_id, event_id)
);
CREATE INDEX drive_events_user_rule ON drive_events(user_id, rule);
CREATE INDEX drive_events_drive ON drive_events(drive_id);
INSERT INTO drive_events (id, drive_id, user_id, event_id, rule, severity, fine_azn, t_s, x, z, street, detail, mode, started_at)
SELECT d.id || ':' || json_extract(e.value, '$.id'),
       d.id,
       d.user_id,
       json_extract(e.value, '$.id'),
       json_extract(e.value, '$.rule'),
       json_extract(e.value, '$.severity'),
       json_extract(e.value, '$.fine_azn'),
       json_extract(e.value, '$.t'),
       json_extract(e.value, '$.x'),
       json_extract(e.value, '$.z'),
       json_extract(e.value, '$.street'),
       json_extract(e.value, '$.detail'),
       d.mode,
       d.started_at
FROM drives d, json_each(d.telemetry, '$.events') e
WHERE json_extract(e.value, '$.type') = 'rule_check'
  AND json_extract(e.value, '$.outcome') = 'fail'
  AND json_extract(e.value, '$.severity') IN ('minor', 'major');
