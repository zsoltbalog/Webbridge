// GET /api/admin/customers?q=&stage=  – ügyféllista a legfrissebb projekt státuszával
// POST /api/admin/customers           – kézi felvétel (pl. telefonos érdeklődő)
import { Env, json, bad, clean, isEmail, upsertCustomer, logEvent, stuckInfo } from "../../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const q = `%${clean(u.searchParams.get("q"), 100)}%`;
  const stage = clean(u.searchParams.get("stage"), 30);
  const r = await env.DB.prepare(
    `SELECT c.id, c.name, c.business, c.email, c.phone, c.lang, c.source, c.tags, c.updated_at, c.created_at,
            p.id AS project_id, p.stage, COALESCE(p.stage_at,p.updated_at) AS stage_at, p.amount, p.currency, p.next_action, p.next_action_at,
            json_extract(c.attribution,'$.source') AS lead_source,
            (SELECT COUNT(*) FROM projects x WHERE x.customer_id=c.id) AS projects,
            (SELECT COALESCE(SUM(amount),0) FROM payments y WHERE y.customer_id=c.id AND y.status='paid') AS paid
       FROM customers c
       LEFT JOIN projects p ON p.id = (SELECT id FROM projects WHERE customer_id=c.id ORDER BY updated_at DESC LIMIT 1)
      WHERE (c.name LIKE ?1 OR c.business LIKE ?1 OR c.email LIKE ?1 OR c.phone LIKE ?1 OR p.id LIKE ?1)
        AND (?2 = '' OR p.stage = ?2)
      ORDER BY c.updated_at DESC LIMIT 300`
  ).bind(q, stage).all();
  return json({ customers: (r.results as any[]).map((c) => ({ ...c, sla: stuckInfo(c.stage, c.stage_at) })) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = clean(b.email, 200).toLowerCase();
  if (email && !isEmail(email)) return bad("Érvénytelen e-mail.");
  if (!email && !clean(b.phone, 40) && !clean(b.name, 200)) return bad("Adj meg legalább nevet, e-mailt vagy telefonszámot.");
  const c = await upsertCustomer(env, { email, name: clean(b.name, 200), business: clean(b.business, 200), phone: clean(b.phone, 40), lang: clean(b.lang, 2) || "hu", source: "manual" });
  await logEvent(env, { customer_id: c.id, kind: "note", actor: "zsolt", title: "Kézzel felvéve", body: clean(b.note, 3000) });
  return json({ ok: true, id: c.id });
};
