// GET /api/pult/auth/facebook[?lang=hu|en][&rerequest=1] – Facebook-belépés / regisztráció indítása (Facebook Login, e-mail + név).
// GET /api/pult/auth/facebook?code=…&state=… – visszatérés a Facebooktól (ugyanez a végpont a Valid OAuth Redirect URI).
// A kódot szerveroldalon váltjuk tokenre (app secret), a /me hívás appsecret_proof-fal megy. Ha nincs e-mail-cím, nem hozunk létre fiókot.
import { Env } from "../../../../lib/core";
import { createSession, sessionCookie, page, randToken } from "../../../../lib/portal";
import { findOrCreateUserForEmail, readState, signedInRedirect, clientIp, langOf } from "../../../../lib/signup";

const GRAPH = "v21.0";
const STATE = "wb_fs";
const PATH = "/api/pult/auth/facebook";
const clearState = `${STATE}=; Path=${PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

const M = {
  hu: {
    soonT: "Facebook-belépés hamarosan", soon: "A Facebook-belépés még nincs bekapcsolva. Addig lépj be Google-lel, vagy kérj belépőlinket e-mailben – azzal regisztrálni is tudsz.",
    failT: "Sikertelen belépés", expired: "A belépés nem sikerült (lejárt munkamenet). Próbáld újra.",
    noToken: "A Facebook nem igazolta a belépést. Próbáld újra, vagy lépj be Google-lel, illetve e-mailes linkkel.",
    cancelT: "Megszakítva", cancel: "A Facebook-belépést megszakítottad. Bármikor újrakezdheted, vagy választhatod a Google-t vagy az e-mailes linket.",
    noEmailT: "Nem kaptuk meg az e-mail-címedet",
    noEmail: "A Facebook nem adta át az e-mail-címedet (nincs megerősített címed a fiókodban, vagy nem engedélyezted). E-mail-cím nélkül nem tudunk fiókot nyitni, mert ide küldjük az anyagaidat és az értesítéseket.",
    noEmailOr: "Lépj be Google-lel, vagy kérj belépőlinket e-mailben – egy kattintás, és kész.",
    retry: "Újrapróbálom, és engedélyezem az e-mail-címet", alt: "Google vagy e-mailes link",
    limitT: "Túl sok regisztráció", limit: "Erről a hálózatról most túl sok új fiók készült. Próbáld újra egy óra múlva, vagy írj nekünk: hello@webbridge.hu.",
    back: "Vissza",
  },
  en: {
    soonT: "Facebook sign-in coming soon", soon: "Facebook sign-in isn't switched on yet. Until then, sign in with Google or ask for a sign-in link by email – you can register with it too.",
    failT: "Sign-in failed", expired: "Sign-in didn't work (the session expired). Please try again.",
    noToken: "Facebook didn't confirm the sign-in. Please try again, or use Google or an email link.",
    cancelT: "Cancelled", cancel: "You cancelled the Facebook sign-in. You can start again any time, or use Google or an email link.",
    noEmailT: "We didn't receive your email address",
    noEmail: "Facebook didn't share your email address (your account has no confirmed address, or you didn't allow it). We can't open an account without an email address, because that's where we send your materials and updates.",
    noEmailOr: "Sign in with Google, or ask for a sign-in link by email – one click and you're in.",
    retry: "Try again and allow my email address", alt: "Google or email link",
    limitT: "Too many sign-ups", limit: "Too many new accounts were created from this network just now. Please try again in an hour, or write to hello@webbridge.hu.",
    back: "Back",
  },
};
type Key = keyof typeof M.hu;

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(s), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const redirect = `${url.origin}${PATH}`;
  const qLang = langOf(url.searchParams.get("lang"));
  const fail = (lang: "hu" | "en", title: Key, msg: Key, status = 400) =>
    page(lang, M[lang][title], `<p>${M[lang][msg]}</p><p><a class="b" href="/pult/?lang=${lang}">${M[lang].back}</a></p>`, status);

  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) return fail(qLang, "soonT", "soon", 503);

  const code = url.searchParams.get("code");
  const st = readState(request, STATE, url.searchParams.get("state"));
  if (!code) {
    if (url.searchParams.get("error")) {
      const r = fail(st?.lang || qLang, "cancelT", "cancel", 200);
      r.headers.append("set-cookie", clearState);
      return r;
    }
    const state = randToken();
    const q = new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, redirect_uri: redirect, state, response_type: "code", scope: "email,public_profile" });
    if (url.searchParams.get("rerequest") === "1") q.set("auth_type", "rerequest");
    return new Response(null, { status: 302, headers: { location: `https://www.facebook.com/${GRAPH}/dialog/oauth?${q}`, "cache-control": "no-store", "set-cookie": `${STATE}=${state}.${qLang}; Path=${PATH}; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } });
  }

  if (!st) return fail(qLang, "failT", "expired");
  const lang = st.lang;

  const tq = new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: redirect, code });
  const tr = await fetch(`https://graph.facebook.com/${GRAPH}/oauth/access_token?${tq}`);
  const tj = (await tr.json().catch(() => ({}))) as { access_token?: string };
  if (!tr.ok || !tj.access_token) return fail(lang, "failT", "noToken");

  const proof = await hmacHex(env.FACEBOOK_APP_SECRET, tj.access_token);
  const mq = new URLSearchParams({ fields: "id,name,email", access_token: tj.access_token, appsecret_proof: proof });
  const mr = await fetch(`https://graph.facebook.com/${GRAPH}/me?${mq}`);
  const me = (await mr.json().catch(() => ({}))) as { id?: string; name?: string; email?: string };
  if (!mr.ok || !me.id) return fail(lang, "failT", "noToken");

  const email = (me.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    const L = M[lang];
    const r = page(lang, L.noEmailT, `<p>${L.noEmail}</p><p>${L.noEmailOr}</p>
<p><a class="b" href="/pult/?lang=${lang}">${L.alt}</a></p>
<p style="margin-top:14px"><a href="${PATH}?lang=${lang}&amp;rerequest=1" style="color:inherit">${L.retry}</a></p>`, 200);
    r.headers.append("set-cookie", clearState);
    return r;
  }

  const r = await findOrCreateUserForEmail(env, { email, name: me.name, lang, provider: "facebook", provider_id: me.id, ip: clientIp(request) });
  if ("limited" in r) return fail(lang, "limitT", "limit", 429);
  const tok = await createSession(env, r.user.id, request.headers.get("user-agent") || "");
  return signedInRedirect(sessionCookie(tok), clearState, r.created ? `/pult/?lang=${lang}` : "/pult/");
};
