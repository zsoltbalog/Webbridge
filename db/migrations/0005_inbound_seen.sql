-- Bejövő levelek ismétlődésének szűrése (Brevo újraküldés / dupla item)
CREATE TABLE IF NOT EXISTS inbound_seen (key TEXT PRIMARY KEY, at TEXT NOT NULL);
