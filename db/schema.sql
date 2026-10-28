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
  tags          TEXT DEFAULT ''
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
  next_action_at TEXT
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
