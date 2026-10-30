-- Webbridge CRM (Cloudflare D1: webbridge-crm)
-- Egy ügyfél (customer) → több projekt (project) → idővonal-események (event).

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,              -- cus_xxxxxxxx
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  name          TEXT,                          -- kapcsolattartó neve
  business      TEXT,                          -- vállalkozás neve
  email         TEXT,
  phone         TEXT,
  lang          TEXT DEFAULT 'hu',             -- hu | en
  buyer_type    TEXT,                          -- b2b | b2c
  company       TEXT,
  vat_id        TEXT,
  billing_addr  TEXT,
  currency      TEXT DEFAULT 'HUF',
  source        TEXT,                          -- form | callback | chat | phone | email | manual
  stripe_customer_id TEXT,
  tags          TEXT DEFAULT '',
  attribution   TEXT DEFAULT '{}'              -- első érintés (JSON)
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email ON customers(email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS customers_updated ON customers(updated_at DESC);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,              -- WB-YYMMDD-XXXX (rendelésszám)
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  title         TEXT,
  stage         TEXT NOT NULL DEFAULT 'lead',
  -- lead → brief_sent → brief_ok → sketch_paid → sketches → deposit_paid → building
  --      → review → live → care | lost
  items         TEXT DEFAULT '[]',             -- JSON: kiválasztott tételek (wb_* azonosítók)
  amount        INTEGER DEFAULT 0,             -- becsült végösszeg, minor unit (HUF fillér / EUR cent)
  currency      TEXT DEFAULT 'HUF',
  domain_mode   TEXT,                          -- new | keep | move
  domain_name   TEXT,
  brief         TEXT DEFAULT '{}',             -- JSON: a brief mezői
  due_at        TEXT,                          -- 24 órás határidő
  next_action   TEXT,                          -- mi a következő lépés (belső)
  next_action_at TEXT,
  stage_at      TEXT,                          -- mikor került az aktuális státuszba (csúszásjelző)
  attribution   TEXT DEFAULT '{}'              -- JSON: utm_*, referrer, gclid, fbclid, ref, landing
);
CREATE INDEX IF NOT EXISTS projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS projects_stage ON projects(stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  customer_id   TEXT,
  project_id    TEXT,
  kind          TEXT NOT NULL,                 -- lead | email_out | email_in | payment | stage | note | call | change_request | system
  title         TEXT NOT NULL,
  body          TEXT,
  meta          TEXT DEFAULT '{}',             -- JSON
  actor         TEXT DEFAULT 'system'          -- system | customer | zsolt | assistant
);
CREATE INDEX IF NOT EXISTS events_customer ON events(customer_id, at DESC);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, at DESC);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,              -- Stripe objektum azonosító (cs_ / in_ / pi_)
  at            TEXT NOT NULL,
  customer_id   TEXT,
  project_id    TEXT,
  kind          TEXT,                          -- sketch | deposit | final | subscription | other
  amount        INTEGER,
  currency      TEXT,
  status        TEXT,                          -- paid | open | failed | refunded
  raw           TEXT
);
CREATE INDEX IF NOT EXISTS payments_customer ON payments(customer_id, at DESC);

CREATE TABLE IF NOT EXISTS emails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  customer_id   TEXT,
  project_id    TEXT,
  template      TEXT,
  to_addr       TEXT,
  subject       TEXT,
  status        TEXT,                          -- sent | skipped | failed
  provider_id   TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS emails_customer ON emails(customer_id, at DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  id            TEXT PRIMARY KEY,              -- evt_… (idempotencia)
  at            TEXT NOT NULL,
  type          TEXT
);

CREATE TABLE IF NOT EXISTS reminders (
  project_id TEXT NOT NULL,                    -- projekt, vagy '_' a napi összesítőnél
  key        TEXT NOT NULL,
  at         TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);
-- Webbridge Pult (ügyfélfelület): belépés, munkák, verziók, megjegyzések, meghívás, egykattintásos jóváhagyás.

-- A Pult felhasználói: a fiók gazdája (owner) vagy meghívott véleményező (reviewer).
CREATE TABLE IF NOT EXISTS portal_users (
  id          TEXT PRIMARY KEY,               -- usr_…
  customer_id TEXT NOT NULL REFERENCES customers(id),
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'owner',  -- owner | reviewer
  lang        TEXT DEFAULT 'hu',
  created_at  TEXT NOT NULL,
  invited_by  TEXT,                           -- usr_… (véleményezőnél)
  last_login  TEXT,
  disabled    INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_cust_email ON portal_users(customer_id, email);
CREATE INDEX IF NOT EXISTS portal_users_email ON portal_users(email);

-- Munkamenetek (a süti a token; itt csak a SHA-256 kivonata van).
CREATE TABLE IF NOT EXISTS sessions (
  hash        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ua          TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Egyszer használatos tokenek: belépőlink (login), jóváhagyó link (approve), meghívó (invite).
CREATE TABLE IF NOT EXISTS action_tokens (
  hash        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                  -- login | approve | invite
  user_id     TEXT,
  email       TEXT,
  ref_id      TEXT,                           -- approve: ver_…
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS action_tokens_email ON action_tokens(email, created_at DESC);

-- Munkák: amit az ügyfél véleményez (logó, arculat, szórólap, weboldal, dokumentum…).
CREATE TABLE IF NOT EXISTS works (
  id          TEXT PRIMARY KEY,               -- wrk_…
  customer_id TEXT NOT NULL REFERENCES customers(id),
  project_id  TEXT,
  kind        TEXT NOT NULL DEFAULT 'design', -- logo | brand | flyer | design | web | doc | posts | other
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'review', -- draft | review | changes | approved
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS works_customer ON works(customer_id, updated_at DESC);

-- Verziók: egy munka v1, v2…; egy verzióban több fájl lehet (pl. 3 logóirány, többoldalas PDF).
CREATE TABLE IF NOT EXISTS versions (
  id          TEXT PRIMARY KEY,               -- ver_…
  work_id     TEXT NOT NULL REFERENCES works(id),
  n           INTEGER NOT NULL,
  note        TEXT,                           -- mi változott (Webbridge írja)
  files       TEXT NOT NULL DEFAULT '[]',     -- JSON: [{key,name,type,size,label}]
  status      TEXT NOT NULL DEFAULT 'review', -- review | changes | approved | superseded
  created_at  TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,                           -- usr_…
  approved_via TEXT,                          -- pult | email | implied
  chosen      TEXT                            -- választott irány (fájl key), ha több irány van
);
CREATE UNIQUE INDEX IF NOT EXISTS versions_work_n ON versions(work_id, n);

-- Megjegyzések: rábökés egy fájl pontjára (x,y 0–1 arányban; PDF-nél oldalszám is), vagy általános.
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,               -- cmt_…
  work_id     TEXT NOT NULL,
  version_id  TEXT NOT NULL,
  parent_id   TEXT,                           -- válasz esetén
  author_kind TEXT NOT NULL DEFAULT 'customer', -- customer | staff | email
  user_id     TEXT,
  author_name TEXT,
  file_key    TEXT,
  page        INTEGER,
  x           REAL,
  y           REAL,
  action      TEXT,                           -- change | add | remove
  body        TEXT NOT NULL,
  attachment  TEXT,                           -- JSON: {key,name,type,size} vagy {url}
  status      TEXT NOT NULL DEFAULT 'open',   -- open | doing | done | verified
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_version ON comments(version_id, created_at);
CREATE INDEX IF NOT EXISTS comments_work ON comments(work_id, created_at);

-- Webbridge Pult 2–3. lépés: weboldal-előnézet, dokumentum (szövegkijelölés), posztnaptár.

-- Weboldal-verzió: az előnézet URL-je (külön telepített Cloudflare Pages előnézet).
ALTER TABLE versions ADD COLUMN preview_url TEXT;

-- Weboldal-megjegyzés: nézet (mobile | desktop) és oldal útvonala (pl. /rolunk).
ALTER TABLE comments ADD COLUMN device TEXT;
ALTER TABLE comments ADD COLUMN path TEXT;
-- Dokumentum-megjegyzés: a kijelölt szöveg (max. 500 karakter) és a helye ("blokk:eltolás").
ALTER TABLE comments ADD COLUMN quote TEXT;
ALTER TABLE comments ADD COLUMN anchor TEXT;
-- Poszt-megjegyzés: a poszt azonosítója a verzió JSON-jából; proposal=1: az ügyfél új posztszöveget javasol (body).
ALTER TABLE comments ADD COLUMN post_id TEXT;
ALTER TABLE comments ADD COLUMN proposal INTEGER DEFAULT 0;

-- Posztonkénti döntés: ok (mehet) | change (változtatás) | skip (kihagyjuk).
CREATE TABLE IF NOT EXISTS post_decisions (
  work_id     TEXT NOT NULL,
  version_id  TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  decision    TEXT NOT NULL,
  user_id     TEXT,
  at          TEXT NOT NULL,
  PRIMARY KEY (version_id, post_id)
);
CREATE INDEX IF NOT EXISTS post_decisions_work ON post_decisions(work_id);
-- Bejövő levelek ismétlődésének szűrése (Brevo újraküldés / dupla item)
CREATE TABLE IF NOT EXISTS inbound_seen (key TEXT PRIMARY KEY, at TEXT NOT NULL);
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
