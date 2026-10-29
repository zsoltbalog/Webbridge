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
