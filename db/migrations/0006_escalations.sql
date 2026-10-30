-- Ügyek, amiket a virtuális asszisztens nem tudott elintézni, és Zsoltra várnak
CREATE TABLE IF NOT EXISTS escalations (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'phone',   -- phone | chat
  reason      TEXT NOT NULL,                   -- price | complaint | urgent | human | unknown | other
  urgency     TEXT NOT NULL DEFAULT 'normal',  -- normal | urgent
  caller_name TEXT,
  phone       TEXT,
  email       TEXT,
  summary     TEXT NOT NULL,
  callback    TEXT,                            -- mikor/hogyan kéri a választ
  customer_id TEXT,
  status      TEXT NOT NULL DEFAULT 'open',    -- open | done
  done_at     TEXT,
  meta        TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS escalations_open ON escalations(status, at DESC);
