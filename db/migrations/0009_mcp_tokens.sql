-- Saját AI-asszisztens bekötése (MCP): személyes connector-linkek a Pult felhasználóinak.
-- A link a /mcp?k=<token> címet tartalmazza; itt csak a token SHA-256 kivonata van.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           TEXT PRIMARY KEY,               -- mcp_…
  user_id      TEXT NOT NULL REFERENCES portal_users(id),
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  token_hash   TEXT NOT NULL,                  -- sha256(token)
  label        TEXT,                           -- pl. „Claude a laptopon”
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_hash ON mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id, created_at DESC);
-- Megjegyzés forrása: NULL = Pult / e-mail; 'mcp' = az ügyfél saját AI-asszisztense írta be.
ALTER TABLE comments ADD COLUMN via TEXT;
