// Egyszerű védelem a belső CRM-hez: HTTP Basic Auth, jelszó az ADMIN_PASSWORD titokból.
// (Később lecserélhető Cloudflare Accessre Google-belépéssel.)
import { Env } from "./core";

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const adminGuard: PagesFunction<Env> = async ({ request, env, next }) => {
  if (!env.ADMIN_PASSWORD) {
    return new Response("A CRM még nincs bekapcsolva: állítsd be az ADMIN_PASSWORD titkot a Cloudflare-ben.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const h = request.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    let dec = "";
    try { dec = atob(h.slice(6)); } catch { /* */ }
    const pass = dec.slice(dec.indexOf(":") + 1);
    if (safeEq(pass, env.ADMIN_PASSWORD)) {
      const res = await next();
      const r = new Response(res.body, res);
      r.headers.set("cache-control", "no-store");
      r.headers.set("x-robots-tag", "noindex");
      return r;
    }
  }
  return new Response("Belépés szükséges", { status: 401, headers: { "www-authenticate": 'Basic realm="Webbridge CRM", charset="UTF-8"' } });
};
