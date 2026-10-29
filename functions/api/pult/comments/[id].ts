// POST /api/pult/comments/:id {action:"verify"|"reopen"|"delete"}
// verify: az ügyfél ellenőrizte, hogy kész; reopen: mégsem jó; delete: saját, még nyitott megjegyzés törlése.
import { Env, json, bad, clean, nowIso } from "../../../../lib/core";
import { requireUser } from "../../../../lib/portal";

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const c = await env.DB.prepare("SELECT c.id,c.user_id,c.status,c.work_id FROM comments c JOIN works w ON w.id=c.work_id WHERE c.id=?1 AND w.customer_id=?2")
    .bind(String(params.id), u.customer_id).first<{ id: string; user_id: string; status: string; work_id: string }>();
  if (!c) return bad("Nincs ilyen megjegyzés.", 404);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const a = clean(b.action, 10), t = nowIso();
  if (a === "verify" && c.status === "done") await env.DB.prepare("UPDATE comments SET status='verified', updated_at=?1 WHERE id=?2").bind(t, c.id).run();
  else if (a === "reopen" && (c.status === "done" || c.status === "verified")) await env.DB.prepare("UPDATE comments SET status='open', updated_at=?1 WHERE id=?2").bind(t, c.id).run();
  else if (a === "delete" && c.user_id === u.id && c.status === "open") await env.DB.prepare("DELETE FROM comments WHERE id=?1 OR parent_id=?1").bind(c.id).run();
  else return bad("Ez a művelet most nem lehetséges.");
  return json({ ok: true });
};
