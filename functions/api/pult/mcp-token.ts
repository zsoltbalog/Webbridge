// Saját AI-asszisztens bekötése (MCP connector-linkek).
// GET  /api/pult/mcp-token                 – a belépett felhasználó linkjei (titok nélkül)
// POST /api/pult/mcp-token {label?}        – új link; a teljes URL-t csak most adjuk vissza
// POST /api/pult/mcp-token {revoke:id}     – visszavonás (DELETE ?id=… / {id} is működik)
// Gazda és véleményező is létrehozhat linket; a linken át ugyanazok a jogok érvényesek, mint a Pultban.
import { Env, json, bad, clean, nowIso, logEvent } from "../../../lib/core";
import { requireUser, PUser } from "../../../lib/portal";
import { createToken } from "../../../lib/mcp";

const MAX_ACTIVE = 10;

async function list(env: Env, u: PUser) {
  return (await env.DB.prepare("SELECT id,label,created_at,last_used_at FROM mcp_tokens WHERE user_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC").bind(u.id).all()).results;
}

async function revoke(env: Env, u: PUser, id: string) {
  const r = await env.DB.prepare("UPDATE mcp_tokens SET revoked_at=?1 WHERE id=?2 AND user_id=?3 AND revoked_at IS NULL").bind(nowIso(), id, u.id).run();
  if (!r.meta.changes) return bad(u.lang === "en" ? "No such link." : "Nincs ilyen link.", 404);
  await logEvent(env, { customer_id: u.customer_id, kind: "note", actor: "customer", title: `Saját AI-asszisztens (MCP) link visszavonva: ${u.email}` });
  return json({ ok: true, tokens: await list(env, u) });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  return json({ ok: true, tokens: await list(env, u), public_url: `${env.SITE_URL}/mcp`, role: u.role });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const hu = u.lang !== "en";
  if (u.role !== "owner" && u.role !== "reviewer") return bad("Tiltott.", 403);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  if (b.revoke) return revoke(env, u, clean(b.revoke, 40));
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM mcp_tokens WHERE user_id=?1 AND revoked_at IS NULL").bind(u.id).first<{ n: number }>();
  if ((n?.n || 0) >= MAX_ACTIVE) return bad(hu ? `Legfeljebb ${MAX_ACTIVE} aktív linked lehet; vonj vissza egy régit.` : `You can have at most ${MAX_ACTIVE} active links; revoke an old one.`);
  const t = await createToken(env, u, clean(b.label, 60));
  await logEvent(env, { customer_id: u.customer_id, kind: "note", actor: "customer", title: `Saját AI-asszisztens (MCP) link létrehozva: ${u.email}`, meta: { token_id: t.id, role: u.role } });
  return json({ ok: true, id: t.id, url: t.url, tokens: await list(env, u) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  let id = new URL(request.url).searchParams.get("id") || "";
  if (!id) { try { id = clean(((await request.json()) as Record<string, unknown>).id, 40); } catch { /* */ } }
  return id ? revoke(env, u, clean(id, 40)) : bad("Hiányzó azonosító.");
};
