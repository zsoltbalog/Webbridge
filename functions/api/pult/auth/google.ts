// GET /api/pult/auth/google[?lang=hu|en] – Google-belépés / regisztráció indítása (OpenID Connect, csak e-mail + név).
// GET /api/pult/auth/google?code=…&state=… – visszatérés a Google-tól (ugyanez a végpont a redirect URI).
// Ismeretlen (de a Google által igazolt) e-mail-címnél új fiókot hozunk létre (lib/signup.ts).
import { Env } from "../../../../lib/core";
import { createSession, sessionCookie, page, randToken } from "../../../../lib/portal";
import { findOrCreateUserForEmail, readState, signedInRedirect, clientIp, langOf } from "../../../../lib/signup";

const STATE = "wb_gs";
const PATH = "/api/pult/auth/google";
const clearState = `${STATE}=; Path=${PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

const M = {
  hu: {
    soonT: "Google-belépés hamarosan", soon: "A Google-belépés még nincs bekapcsolva. Addig kérj belépőlinket e-mailben – azzal regisztrálni is tudsz.",
    failT: "Sikertelen belépés", expired: "A belépés nem sikerült (lejárt munkamenet). Próbáld újra.",
    noToken: "A Google nem igazolta a belépést. Próbáld újra, vagy kérj belépőlinket e-mailben.", bad: "Ezzel a Google-fiókkal nem sikerült belépni.",
    cancelT: "Megszakítva", cancel: "A Google-belépést megszakítottad. Bármikor újrakezdheted, vagy kérhetsz belépőlinket e-mailben.",
    limitT: "Túl sok regisztráció", limit: "Erről a hálózatról most túl sok új fiók készült. Próbáld újra egy óra múlva, vagy írj nekünk: hello@webbridge.hu.",
    back: "Vissza",
  },
  en: {
    soonT: "Google sign-in coming soon", soon: "Google sign-in isn't switched on yet. Until then, ask for a sign-in link by email – you can register with it too.",
    failT: "Sign-in failed", expired: "Sign-in didn't work (the session expired). Please try again.",
    noToken: "Google didn't confirm the sign-in. Please try again, or ask for a sign-in link by email.", bad: "We couldn't sign you in with this Google account.",
    cancelT: "Cancelled", cancel: "You cancelled the Google sign-in. You can start again any time, or ask for a sign-in link by email.",
    limitT: "Too many sign-ups", limit: "Too many new accounts were created from this network just now. Please try again in an hour, or write to hello@webbridge.hu.",
    back: "Back",
  },
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const redirect = `${url.origin}${PATH}`;
  const qLang = langOf(url.searchParams.get("lang"));
  const fail = (lang: "hu" | "en", title: keyof typeof M.hu, msg: keyof typeof M.hu, status = 400) =>
    page(lang, M[lang][title], `<p>${M[lang][msg]}</p><p><a class="b" href="/pult/?lang=${lang}">${M[lang].back}</a></p>`, status);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail(qLang, "soonT", "soon", 503);

  const code = url.searchParams.get("code");
  const st = readState(request, STATE, url.searchParams.get("state"));
  if (!code) {
    if (url.searchParams.get("error")) {
      const lang = st?.lang || qLang;
      const r = fail(lang, "cancelT", "cancel", 200);
      r.headers.append("set-cookie", clearState);
      return r;
    }
    const state = randToken();
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, prompt: "select_account", hl: qLang });
    return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "cache-control": "no-store", "set-cookie": `${STATE}=${state}.${qLang}; Path=${PATH}; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } });
  }

  if (!st) return fail(qLang, "failT", "expired");
  const lang = st.lang;

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const tj = (await tr.json().catch(() => ({}))) as { id_token?: string };
  if (!tr.ok || !tj.id_token) return fail(lang, "failT", "noToken");
  // Az id_token közvetlenül a Google token-végpontjától jött (TLS), ezért a tartalmát elfogadjuk; az aud-ot ellenőrizzük.
  let claims: { email?: string; email_verified?: boolean; aud?: string; name?: string; sub?: string } = {};
  try { claims = JSON.parse(atob(tj.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { /* */ }
  const email = (claims.email || "").toLowerCase();
  if (!email || claims.email_verified !== true || claims.aud !== env.GOOGLE_CLIENT_ID) return fail(lang, "failT", "bad");

  const r = await findOrCreateUserForEmail(env, { email, name: claims.name, lang, provider: "google", provider_id: claims.sub || null, ip: clientIp(request) });
  if ("limited" in r) return fail(lang, "limitT", "limit", 429);
  const tok = await createSession(env, r.user.id, request.headers.get("user-agent") || "");
  return signedInRedirect(sessionCookie(tok), clearState, r.created ? `/pult/?lang=${lang}` : "/pult/");
};
