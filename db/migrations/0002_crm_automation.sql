-- 0002: lead-forrás, szakaszidő (csúszásjelző), automatikus emlékeztetők
ALTER TABLE projects ADD COLUMN stage_at TEXT;
ALTER TABLE projects ADD COLUMN attribution TEXT DEFAULT '{}';
ALTER TABLE customers ADD COLUMN attribution TEXT DEFAULT '{}';
UPDATE projects SET stage_at = updated_at WHERE stage_at IS NULL;
CREATE TABLE IF NOT EXISTS reminders (
  project_id TEXT NOT NULL,           -- projekt, vagy '_' a napi összesítőnél
  key        TEXT NOT NULL,           -- pl. brief_sent, sketches, review, review_request, digest-2026-10-28
  at         TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);
