-- Egyszerű óránkénti korlát (pl. chat: IP-címenként)
CREATE TABLE IF NOT EXISTS rate_limit (key TEXT PRIMARY KEY, n INTEGER NOT NULL, at TEXT NOT NULL);
