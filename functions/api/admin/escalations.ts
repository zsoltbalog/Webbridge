// GET /api/admin/escalations?all=1 – a „Rád vár” lista (nyitott ügyek; all=1: az utolsó 50 lezárt is)
// POST /api/admin/escalations {id, status: "done"|"open"}
import { Env, json, bad, clean, nowIso } from "../../../lib/core";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const all = new URL(request.url).searchParams.get("all") === "1";
  const r = await env.DB.prepare(`SELECT * FROM escalations ${all ? "" : "WHERE status='open'"} ORDER BY CASE urgency WHEN 'urgent' THEN 0 ELSE 1 END, at DESC LIMIT 50`).all();
  return json({ ok: true, items: r.results });
};
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const st = clean(b.status, 10);
  if (!["done", "open"].includes(st)) return bad("Ismeretlen állapot.");
  await env.DB.prepare("UPDATE escalations SET status=?1, done_at=?2 WHERE id=?3").bind(st, st === "done" ? nowIso() : null, clean(b.id, 40)).run();
  return json({ ok: true });
};
