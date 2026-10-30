// GET /api/admin/instructions?all=1 – az e-mailes utasítások listája (alapból a nem lezártak)
// POST /api/admin/instructions {id, status, result?} – állapot kézi módosítása a CRM-ből
import { Env, json, bad, clean, nowIso } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const r = await env.DB.prepare(`SELECT id,at,from_email,subject,body,attachments,status,proposal,result,updated_at FROM instructions ${all ? "" : "WHERE status NOT IN ('done','rejected')"} ORDER BY at DESC LIMIT 50`).all();
  return json({ ok: true, items: r.results });
};
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const st = clean(b.status, 15);
  if (!["queued", "done", "rejected", "failed"].includes(st)) return bad("Ismeretlen állapot.");
  await env.DB.prepare("UPDATE instructions SET status=?1, result=COALESCE(?2,result), updated_at=?3 WHERE id=?4").bind(st, clean(b.result, 4000) || null, nowIso(), clean(b.id, 40)).run();
  return json({ ok: true });
};
