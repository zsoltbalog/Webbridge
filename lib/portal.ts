// Webbridge Pult: belépés (e-mailes link), munkamenet-süti, jogosultság, egyszer használatos tokenek.
import { Env, json, nowIso, rid, esc } from "./core";

export interface PUser { id: string; customer_id: string; email: string; name: string | null; role: "owner" | "reviewer"; lang: string }

const COOKIE = "wb_s";
const SESSION_DAYS = 30;

export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const randToken = () => rid("", 40);

function cookieOf(req: Request, name: string) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return "";
}

export function sessionCookie(token: string, maxAge = SESSION_DAYS * 86400) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** Új munkamenet; a süti értéke a token, az adatbázisban csak a kivonata. */
export async function createSession(env: Env, userId: string, ua: string) {
  const token = randToken();
  const t = nowIso();
  await env.DB.prepare("INSERT INTO sessions (hash,user_id,created_at,expires_at,ua) VALUES (?1,?2,?3,?4,?5)")
    .bind(await sha256(token), userId, t, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), ua.slice(0, 200)).run();
  await env.DB.prepare("UPDATE portal_users SET last_login=?1 WHERE id=?2").bind(t, userId).run();
  return token;
}

export async function currentUser(env: Env, req: Request): Promise<PUser | null> {
  const tok = cookieOf(req, COOKIE);
  if (!tok || tok.length < 20) return null;
  const row = await env.DB.prepare(
    "SELECT u.id,u.customer_id,u.email,u.name,u.role,u.lang,s.expires_at FROM sessions s JOIN portal_users u ON u.id=s.user_id WHERE s.hash=?1 AND u.disabled=0"
  ).bind(await sha256(tok)).first<PUser & { expires_at: string }>();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return { id: row.id, customer_id: row.customer_id, email: row.email, name: row.name, role: row.role, lang: row.lang };
}

export async function endSession(env: Env, req: Request) {
  const tok = cookieOf(req, COOKIE);
  if (tok) await env.DB.prepare("DELETE FROM sessions WHERE hash=?1").bind(await sha256(tok)).run();
}

/** POST-kérések védelme: azonos origin + JSON (vagy nyers fájl) – a SameSite=Lax süti mellett. */
export function sameOrigin(req: Request) {
  const o = req.headers.get("origin");
  if (!o) return true; // egyes böngészők azonos originnél nem küldik
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}

/** Kérésvédő a /api/pult/* végpontokhoz. */
export async function requireUser(env: Env, req: Request): Promise<PUser | Response> {
  if (req.method !== "GET" && !sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const u = await currentUser(env, req);
  return u || json({ ok: false, error: "login" }, 401);
}

/** A fiók gazdája: a customers.email címhez tartozó owner felhasználó (ha nincs, létrehozzuk). */
export async function ensureOwner(env: Env, customerId: string) {
  const c = await env.DB.prepare("SELECT id,email,name,lang FROM customers WHERE id=?1").bind(customerId).first<{ id: string; email: string; name: string; lang: string }>();
  if (!c || !c.email) return null;
  const email = c.email.toLowerCase();
  let u = await env.DB.prepare("SELECT * FROM portal_users WHERE customer_id=?1 AND email=?2").bind(customerId, email).first<PUser>();
  if (!u) {
    const id = rid("usr_");
    await env.DB.prepare("INSERT INTO portal_users (id,customer_id,email,name,role,lang,created_at) VALUES (?1,?2,?3,?4,'owner',?5,?6)")
      .bind(id, customerId, email, c.name || null, c.lang || "hu", nowIso()).run();
    u = { id, customer_id: customerId, email, name: c.name || null, role: "owner", lang: c.lang || "hu" };
  }
  return u;
}

/** Egyszer használatos token kiadása (login / approve). Visszaadja a nyers tokent. */
export async function issueToken(env: Env, t: { kind: string; user_id?: string; email?: string; ref_id?: string; minutes: number }) {
  const tok = randToken();
  await env.DB.prepare("INSERT INTO action_tokens (hash,kind,user_id,email,ref_id,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")
    .bind(await sha256(tok), t.kind, t.user_id ?? null, t.email ?? null, t.ref_id ?? null, nowIso(), new Date(Date.now() + t.minutes * 6e4).toISOString()).run();
  return tok;
}

/** Token beváltása: csak egyszer, csak lejárat előtt. */
export async function consumeToken(env: Env, kind: string, tok: string) {
  if (!tok || tok.length < 20) return null;
  const h = await sha256(tok);
  const row = await env.DB.prepare("SELECT * FROM action_tokens WHERE hash=?1 AND kind=?2").bind(h, kind)
    .first<{ hash: string; user_id: string; email: string; ref_id: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) return null;
  const r = await env.DB.prepare("UPDATE action_tokens SET used_at=?1 WHERE hash=?2 AND used_at IS NULL").bind(nowIso(), h).run();
  return r.meta.changes ? row : null;
}
export async function peekToken(env: Env, kind: string, tok: string) {
  if (!tok || tok.length < 20) return null;
  const row = await env.DB.prepare("SELECT * FROM action_tokens WHERE hash=?1 AND kind=?2").bind(await sha256(tok), kind)
    .first<{ user_id: string; ref_id: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

/** Belépőlink küldése egy felhasználónak. */
export async function loginLink(env: Env, u: PUser, minutes = 30) {
  const tok = await issueToken(env, { kind: "login", user_id: u.id, email: u.email, minutes });
  return `${env.SITE_URL}/api/pult/auth/verify?t=${tok}`;
}

/** A munkához tartozik-e a felhasználó ügyfele. */
export async function workFor(env: Env, u: PUser, workId: string) {
  return env.DB.prepare("SELECT * FROM works WHERE id=?1 AND customer_id=?2").bind(workId, u.customer_id)
    .first<{ id: string; customer_id: string; project_id: string; kind: string; title: string; status: string; created_at: string; updated_at: string }>();
}

/** Egyszerű, márkázott HTML-oldal (belépés megerősítése, jóváhagyás). */
export function page(lang: string, title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} – Webbridge</title>
<style>:root{--bg:#edeff2;--card:#fff;--ink:#10141b;--mut:#6b7280;--acc:#ff6b2c}@media (prefers-color-scheme:dark){:root{--bg:#0f1217;--card:#181c23;--ink:#eef1f5;--mut:#9aa3af}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Inter,Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.c{background:var(--card);border-radius:16px;padding:28px 24px;max-width:440px;width:100%}h1{font-size:22px;margin:0 0 10px}p{color:var(--mut)}
.b{display:inline-block;border:0;background:var(--acc);color:#fff;font:inherit;font-weight:700;padding:13px 22px;border-radius:10px;cursor:pointer;text-decoration:none}
.logo{font-weight:800;font-size:20px;margin-bottom:16px}.logo i{color:var(--acc);font-style:normal}</style></head>
<body><div class="c"><div class="logo">Webbridge<i>.</i></div><h1>${esc(title)}</h1>${body}</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } });
}

export const KIND_HU: Record<string, string> = { logo: "Logó", brand: "Arculat", flyer: "Szórólap", design: "Grafika", web: "Weboldal", doc: "Dokumentum", posts: "Posztok", other: "Egyéb" };
export const KIND_EN: Record<string, string> = { logo: "Logo", brand: "Brand identity", flyer: "Flyer", design: "Design", web: "Website", doc: "Document", posts: "Posts", other: "Other" };
