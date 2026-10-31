// GET /api/pult/auth/verify?t=… – a belépő- vagy regisztrációs link. A levelezők linkellenőrzője is megnyithatja,
// ezért GET-re nem váltjuk be a tokent: egy oldal POST-tal (automatikusan) lépteti be a felhasználót.
// Regisztrációs link (kind "signup"): a beváltáskor jön létre a fiók (lib/signup.ts), utána belépés.
import { Env } from "../../../../lib/core";
import { consumeToken, createSession, sessionCookie, peekToken, page } from "../../../../lib/portal";
import { findOrCreateUserForEmail, clientIp, langOf } from "../../../../lib/signup";

const expired = (lang: "hu" | "en") => lang === "en"
  ? page("en", "The link has expired", `<p>This link is no longer valid (it works once, for a limited time).</p><p><a class="b" href="/pult/?lang=en">Get a new link</a></p>`, 410)
  : page("hu", "A link lejárt", `<p>Ez a link már nem érvényes (korlátozott ideig él, és egyszer használható).</p><p><a class="b" href="/pult/">Új link kérése</a></p>`, 410);

async function peekAny(env: Env, t: string) {
  const login = await peekToken(env, "login", t);
  if (login) return { kind: "login" as const, lang: "hu" as const };
  const su = await peekToken(env, "signup", t);
  if (su) return { kind: "signup" as const, lang: langOf(su.ref_id) };
  return null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const t = (new URL(request.url).searchParams.get("t") || "").replace(/[^a-z0-9]/gi, "");
  const ok = await peekAny(env, t);
  if (!ok) return expired("hu");
  const en = ok.lang === "en";
  const title = ok.kind === "signup" ? (en ? "Creating your account…" : "Fiók létrehozása…") : "Belépés…";
  const msg = ok.kind === "signup" ? (en ? "One moment, we're creating your account and signing you in." : "Egy pillanat, létrehozzuk a fiókodat, és beléptetünk a Pultba.") : "Egy pillanat, beléptetünk a Pultba.";
  return page(ok.lang, title, `<p>${msg}</p>
<form method="post" id="f"><input type="hidden" name="t" value="${t}"><button class="b">${en ? "Continue" : ok.kind === "signup" ? "Tovább" : "Belépés"}</button></form>
<script>document.getElementById("f").submit()</script>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const fd = await request.formData().catch(() => null);
  const t = String(fd?.get("t") || "");
  const ua = request.headers.get("user-agent") || "";

  const row = await consumeToken(env, "login", t);
  if (row && row.user_id) {
    const tok = await createSession(env, row.user_id, ua);
    return new Response(null, { status: 303, headers: { location: "/pult/", "set-cookie": sessionCookie(tok), "cache-control": "no-store" } });
  }

  const su = await consumeToken(env, "signup", t);
  if (!su || !su.email) return expired("hu");
  const lang = langOf(su.ref_id);
  const r = await findOrCreateUserForEmail(env, { email: su.email, lang, provider: "email", ip: clientIp(request) });
  if ("limited" in r) return lang === "en"
    ? page("en", "Too many sign-ups", `<p>Too many new accounts were created from this network just now. Please try again in an hour, or write to hello@webbridge.hu.</p><p><a class="b" href="/pult/?lang=en">Back</a></p>`, 429)
    : page("hu", "Túl sok regisztráció", `<p>Erről a hálózatról most túl sok új fiók készült. Próbáld újra egy óra múlva, vagy írj nekünk: hello@webbridge.hu.</p><p><a class="b" href="/pult/">Vissza</a></p>`, 429);
  const tok = await createSession(env, r.user.id, ua);
  return new Response(null, { status: 303, headers: { location: r.created ? `/pult/?lang=${lang}` : "/pult/", "set-cookie": sessionCookie(tok), "cache-control": "no-store" } });
};
