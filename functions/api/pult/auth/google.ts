// GET /api/pult/auth/google – Google-belépés indítása (OpenID Connect, csak e-mail + név).
// GET /api/pult/auth/google?code=…&state=… – visszatérés a Google-tól (ugyanez a végpont a redirect URI).
import { Env } from "../../../../lib/core";
import { createSession, sessionCookie, ensureOwner, page, randToken, PUser } from "../../../../lib/portal";

const STATE = "wb_gs";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const redirect = `${url.origin}/api/pult/auth/google`;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page("hu", "Google-belépés hamarosan", `<p>A Google-belépés még nincs bekapcsolva. Addig kérj belépőlinket e-mailben.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 503);

  const code = url.searchParams.get("code");
  if (!code) {
    const st = randToken();
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state: st, prompt: "select_account" });
    return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "set-cookie": `${STATE}=${st}; Path=/api/pult/auth/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } });
  }

  const cookie = (request.headers.get("cookie") || "").match(new RegExp(`${STATE}=([a-z0-9]+)`))?.[1];
  if (!cookie || cookie !== url.searchParams.get("state")) return page("hu", "Sikertelen belépés", `<p>A belépés nem sikerült (lejárt munkamenet). Próbáld újra.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 400);

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const tj = (await tr.json().catch(() => ({}))) as { id_token?: string };
  if (!tr.ok || !tj.id_token) return page("hu", "Sikertelen belépés", `<p>A Google nem igazolta a belépést. Próbáld újra, vagy kérj belépőlinket e-mailben.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 400);
  // Az id_token közvetlenül a Google token-végpontjától jött (TLS), ezért a tartalmát elfogadjuk; az aud-ot ellenőrizzük.
  let claims: { email?: string; email_verified?: boolean; aud?: string; name?: string } = {};
  try { claims = JSON.parse(atob(tj.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { /* */ }
  const email = (claims.email || "").toLowerCase();
  if (!email || claims.email_verified !== true || claims.aud !== env.GOOGLE_CLIENT_ID) return page("hu", "Sikertelen belépés", `<p>Ezzel a Google-fiókkal nem sikerült belépni.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 400);

  let user = await env.DB.prepare("SELECT * FROM portal_users WHERE email=?1 AND disabled=0 ORDER BY role='owner' DESC, created_at DESC LIMIT 1").bind(email).first<PUser>();
  if (!user) {
    const c = await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(email).first<{ id: string }>();
    if (c) user = await ensureOwner(env, c.id);
  }
  if (!user) return page("hu", "Nincs fiók ehhez a címhez", `<p>A(z) <b>${email.replace(/[<>&"]/g, "")}</b> címhez nem tartozik Pult-fiók. Lépj be azzal a címmel, amellyel rendeltél, vagy kérd meg a fiók gazdáját, hogy hívjon meg.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 403);
  if (!user.name && claims.name) await env.DB.prepare("UPDATE portal_users SET name=?1 WHERE id=?2").bind(claims.name.slice(0, 100), user.id).run();
  const tok = await createSession(env, user.id, request.headers.get("user-agent") || "");
  const h = new Headers({ location: "/pult/", "cache-control": "no-store" });
  h.append("set-cookie", sessionCookie(tok));
  h.append("set-cookie", `${STATE}=; Path=/api/pult/auth/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 303, headers: h });
};
