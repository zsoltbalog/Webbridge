// POST /api/site-peek – a rendelési űrlap "Átnézem" gombja: beolvassa az ügyfél jelenlegi oldalát,
// és visszaadja a címét, leírását és az aloldalait, hogy oldalanként dönthessen (marad / más legyen / nem kell).
import { Env, json, bad, clean } from "../../lib/core";
import { scanSite } from "../../lib/site";

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const en = clean(b.lang, 2) === "en";
  const s = await scanSite(clean(b.url, 500));
  if (!s) return bad(en ? "We couldn't open this site. Check the address, or just describe it below." : "Ezt az oldalt nem sikerült megnyitni. Ellenőrizd a címet, vagy írd le lent, mi van rajta.", 422);
  const home = { url: s.final_url, title: en ? "Home page" : "Főoldal" };
  const pages = [home, ...s.pages.filter((p) => p.url.replace(/\/$/, "") !== s.final_url.replace(/\/$/, ""))].slice(0, 20);
  return json({ ok: true, url: s.final_url, title: s.title, description: s.description, images: s.images, pages });
};
