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
