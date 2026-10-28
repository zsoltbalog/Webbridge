// GET /api/admin/customers/:id – egy ügyfél teljes képe: adatok, projektek, idővonal, fizetések, levelek
// POST /api/admin/customers/:id – adatok módosítása / jegyzet
import { Env, json, bad, clean, nowIso, logEvent, stuckInfo } from "../../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id);
  const c = await env.DB.prepare("SELECT * FROM customers WHERE id=?1").bind(id).first();
  if (!c) return bad("Nincs ilyen ügyfél.", 404);
  const [projects, events, payments, emails] = await Promise.all([
    env.DB.prepare("SELECT * FROM projects WHERE customer_id=?1 ORDER BY created_at DESC").bind(id).all(),
    env.DB.prepare("SELECT * FROM events WHERE customer_id=?1 ORDER BY id DESC LIMIT 300").bind(id).all(),
    env.DB.prepare("SELECT id,at,project_id,kind,amount,currency,status FROM payments WHERE customer_id=?1 ORDER BY at DESC").bind(id).all(),
    env.DB.prepare("SELECT at,project_id,template,to_addr,subject,status,error FROM emails WHERE customer_id=?1 ORDER BY id DESC LIMIT 100").bind(id).all(),
  ]);
  return json({ customer: c, projects: (projects.results as any[]).map((p) => ({ ...p, sla: stuckInfo(p.stage, p.stage_at || p.updated_at) })), events: events.results, payments: payments.results, emails: emails.results });
};

const FIELDS = ["name", "business", "email", "phone", "lang", "buyer_type", "company", "vat_id", "billing_addr", "currency", "tags"] as const;

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sets: string[] = [], vals: unknown[] = [];
  for (const f of FIELDS) if (typeof b[f] === "string") { sets.push(`${f}=?${vals.length + 1}`); vals.push(clean(b[f], 400)); }
  if (sets.length) {
    vals.push(nowIso(), id);
    await env.DB.prepare(`UPDATE customers SET ${sets.join(",")}, updated_at=?${vals.length - 1} WHERE id=?${vals.length}`).bind(...vals).run();
    await logEvent(env, { customer_id: id, kind: "system", actor: "zsolt", title: "Ügyféladatok módosítva", meta: { fields: Object.keys(b).filter((k) => (FIELDS as readonly string[]).includes(k)) } });
  }
  const note = clean(b.note, 5000);
  if (note) await logEvent(env, { customer_id: id, project_id: clean(b.project_id, 40) || null, kind: "note", actor: "zsolt", title: "Jegyzet", body: note });
  return json({ ok: true });
};
