// Webbridge Pult: regisztráció (Google, Facebook, e-mailes link) – közös logika.
// Meglévő Pult-felhasználó → azt adjuk vissza; meglévő ügyfél (rendelt már) → a gazdája lesz;
// egyébként új ügyfél (source "signup:<szolgáltató>") + gazda felhasználó, idővonal-esemény és belső értesítő.
import { Env, nowIso, upsertCustomer, logEvent } from "./core";
import { sendMail, layout, rows } from "./mail";
import { ensureOwner, PUser } from "./portal";

export type Provider = "google" | "facebook" | "email";
export const PROVIDER_HU: Record<Provider, string> = { google: "Google", facebook: "Facebook", email: "e-mail" };

/** Regisztrációk IP-címenként óránként (a rate_limit táblában, mint a chat.ts). */
export const SIGNUPS_PER_HOUR = 10;

/** Óránkénti számláló: növeli, és true, ha túllépte a korlátot. */
export async function overHourly(env: Env, key: string, max: number) {
  const k = `${key}:${new Date().toISOString().slice(0, 13)}`;
  const r = await env.DB.prepare("INSERT INTO rate_limit (key,n,at) VALUES (?1,1,?2) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n")
    .bind(k, nowIso()).first<{ n: number }>();
  return (r?.n || 0) > max;
}

export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") || "x";
export const langOf = (v: unknown) => (v === "en" ? "en" : "hu");

/** Meglévő fiók az e-mail-címhez (új nem jön létre): aktív Pult-felhasználó, vagy egy ügyfél gazdája. */
export async function findUserForEmail(env: Env, email: string): Promise<PUser | null> {
  const u = await env.DB.prepare("SELECT * FROM portal_users WHERE email=?1 AND disabled=0 ORDER BY role='owner' DESC, created_at DESC LIMIT 1").bind(email).first<PUser>();
  if (u) return u;
  const c = await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(email).first<{ id: string }>();
  return c ? ensureOwner(env, c.id) : null;
}

export type SignupResult = { user: PUser; created: boolean } | { limited: true };

/**
 * Fiók keresése vagy létrehozása egy igazolt e-mail-címhez (a hívó felel az igazolásért:
 * Google email_verified, Facebook, vagy beváltott e-mailes link).
 */
export async function findOrCreateUserForEmail(env: Env, p: { email: string; name?: string | null; lang?: string; provider: Provider; provider_id?: string | null; ip: string }): Promise<SignupResult> {
  const email = p.email.trim().toLowerCase();
  const name = (p.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100);
  const existing = await findUserForEmail(env, email);
  if (existing) {
    if (!existing.name && name) {
      await env.DB.prepare("UPDATE portal_users SET name=?1 WHERE id=?2").bind(name, existing.id).run();
      existing.name = name;
    }
    if (p.provider_id) await noteIdentity(env, existing, p.provider, p.provider_id);
    return { user: existing, created: false };
  }

  if (await overHourly(env, `signup:${p.ip}`, SIGNUPS_PER_HOUR)) return { limited: true };

  const lang = langOf(p.lang);
  let customerId: string;
  try {
    customerId = (await upsertCustomer(env, { email, name, lang, source: `signup:${p.provider}` })).id;
  } catch {
    // Párhuzamos regisztráció ugyanarra a címre (egyedi index): a másik kérés már létrehozta.
    const c = await env.DB.prepare("SELECT id FROM customers WHERE email=?1").bind(email).first<{ id: string }>();
    if (!c) throw new Error("signup failed");
    customerId = c.id;
  }
  const user = await ensureOwner(env, customerId);
  if (!user) throw new Error("signup failed");

  const via = PROVIDER_HU[p.provider];
  await logEvent(env, {
    customer_id: customerId, kind: "signup", actor: "customer",
    title: `Új regisztráció (${p.provider === "email" ? "e-mail" : via})`,
    body: [name, email].filter(Boolean).join(" · "),
    meta: { provider: p.provider, provider_id: p.provider_id || null, email, user_id: user.id, lang },
  });
  await sendMail(env, {
    to: env.NOTIFY_TO, template: "internal_signup", customer_id: customerId, replyTo: email,
    subject: `🟢 Új Pult-regisztráció (${via}) – ${name || email}`,
    html: layout("hu", "Új Pult-regisztráció", rows([["E-mail", email], ["Név", name], ["Belépés módja", via], ["Nyelv", lang]]) +
      `<p>Még nem rendelt. A Pultban rendelés nélkül is körülnézhet; ha ír vagy rendel, ehhez az ügyfélhez kerül.</p>`,
      { label: "Megnyitás a CRM-ben", url: `${env.SITE_URL}/admin/#c/${customerId}` }),
  });
  return { user, created: true };
}

/**
 * A külső fiók azonosítója (Google sub, Facebook app-scoped id) – egyszer, az idővonalra.
 * Ebből találjuk meg az ügyfelet a Meta adattörlési kérésénél (külön tábla nélkül).
 */
export async function noteIdentity(env: Env, u: PUser, provider: Provider, providerId: string) {
  if (provider === "email" || !providerId) return;
  const ex = await env.DB.prepare(
    "SELECT id FROM events WHERE customer_id=?1 AND kind IN ('signup','identity') AND json_extract(meta,'$.provider')=?2 AND json_extract(meta,'$.provider_id')=?3 LIMIT 1"
  ).bind(u.customer_id, provider, providerId).first();
  if (ex) return;
  await logEvent(env, {
    customer_id: u.customer_id, kind: "identity", actor: "customer",
    title: `${PROVIDER_HU[provider]}-belépés összekötve: ${u.email}`,
    meta: { provider, provider_id: providerId, email: u.email, user_id: u.id },
  });
}

/** Belépés lezárása: munkamenet-süti + az OAuth state-süti törlése, átirányítás a Pultba. */
export function signedInRedirect(sessionCookieHeader: string, clearCookie: string | null, location: string) {
  const h = new Headers({ location, "cache-control": "no-store" });
  h.append("set-cookie", sessionCookieHeader);
  if (clearCookie) h.append("set-cookie", clearCookie);
  return new Response(null, { status: 303, headers: h });
}

/** OAuth state-süti: "<véletlen>.<nyelv>"; visszaadja a state-et és a nyelvet, ha egyezik a visszatérő state-tel. */
export function readState(req: Request, cookieName: string, returned: string | null) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${cookieName}=([a-z0-9]+)\\.(hu|en)(?:;|$)`));
  if (!m || !returned || m[1] !== returned) return null;
  return { state: m[1], lang: m[2] as "hu" | "en" };
}
