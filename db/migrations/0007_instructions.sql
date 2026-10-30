-- E-mailes utasítások Zsolttól (utasitas@REPLY_DOMAIN) – a webes és marketing-munkák sora
CREATE TABLE IF NOT EXISTS instructions (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  from_email  TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'unconfirmed', -- unconfirmed | queued | in_progress | needs_ok | approved | done | rejected | failed
  confirm_token TEXT,                              -- a beérkezéskor küldött „Indulhat” link kulcsa
  ok_token    TEXT,                                -- a javaslat jóváhagyó linkjének kulcsa (needs_ok)
  proposal    TEXT,                                -- mit tennénk, jóváhagyásra (nyilvános változásnál)
  result      TEXT,                                -- mit csináltunk
  notify      INTEGER NOT NULL DEFAULT 0,          -- 1: a feldolgozó frissítette, az óránkénti cron e-mailt küld Zsoltnak
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS instructions_status ON instructions(status, at);
