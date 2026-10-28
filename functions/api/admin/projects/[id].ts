// POST /api/admin/projects/:id – státusz, következő teendő, tételek módosítása
import { Env, json, bad, clean, nowIso, logEvent, STAGES, STAGE_HU, itemById, priceOf } from "../../../../lib/core";

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id=?1").bind(id).first<any>();
  if (!p) return bad("Nincs ilyen projekt.", 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const t = nowIso();
  const stmts: D1PreparedStatement[] = [];

  const stage = clean(b.stage, 30);
  if (stage && stage !== p.stage) {
    if (!(STAGES as readonly string[]).includes(stage)) return bad("Ismeretlen státusz.");
    stmts.push(env.DB.prepare("UPDATE projects SET stage=?1, updated_at=?2 WHERE id=?3").bind(stage, t, id));
    if (stage === "brief_ok") stmts.push(env.DB.prepare("UPDATE projects SET due_at=?1 WHERE id=?2").bind(new Date(Date.now() + 864e5).toISOString(), id));
    await logEvent(env, { customer_id: p.customer_id, project_id: id, kind: "stage", actor: "zsolt", title: `Státusz: ${STAGE_HU[p.stage] || p.stage} → ${STAGE_HU[stage]}` });
  }
  if (typeof b.next_action === "string") {
    stmts.push(env.DB.prepare("UPDATE projects SET next_action=?1, next_action_at=?2, updated_at=?3 WHERE id=?4").bind(clean(b.next_action, 300) || null, clean(b.next_action_at, 40) || null, t, id));
  }
  if (Array.isArray(b.items)) {
    const items = b.items.map((x) => clean(x, 20)).filter((x) => itemById(x));
    const { once } = priceOf(items, p.currency === "EUR" ? "EUR" : "HUF");
    stmts.push(env.DB.prepare("UPDATE projects SET items=?1, amount=?2, updated_at=?3 WHERE id=?4").bind(JSON.stringify(items), once, t, id));
    await logEvent(env, { customer_id: p.customer_id, project_id: id, kind: "system", actor: "zsolt", title: "Tételek módosítva", meta: { items } });
  }
  if (typeof b.title === "string") stmts.push(env.DB.prepare("UPDATE projects SET title=?1, updated_at=?2 WHERE id=?3").bind(clean(b.title, 200), t, id));
  stmts.push(env.DB.prepare("UPDATE customers SET updated_at=?1 WHERE id=?2").bind(t, p.customer_id));
  await env.DB.batch(stmts);
  return json({ ok: true });
};
