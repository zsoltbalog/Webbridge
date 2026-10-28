-- Revolut Business adatok (csak olvasás), Cloudflare D1
CREATE TABLE IF NOT EXISTS rv_accounts (
  id TEXT PRIMARY KEY,
  name TEXT,
  currency TEXT NOT NULL,
  balance REAL NOT NULL,
  state TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rv_transactions (
  id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  account_id TEXT,
  type TEXT,
  state TEXT,
  created_at TEXT,
  completed_at TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  fee REAL,
  description TEXT,
  counterparty TEXT,
  merchant TEXT,
  reference TEXT,
  category TEXT,           -- saját besorolás: stripe_payout, telnyx, google, brevo, domain, egyéb
  raw TEXT,
  PRIMARY KEY (id, leg_id)
);
CREATE INDEX IF NOT EXISTS rv_tx_created ON rv_transactions(created_at);
CREATE TABLE IF NOT EXISTS rv_state (k TEXT PRIMARY KEY, v TEXT);
