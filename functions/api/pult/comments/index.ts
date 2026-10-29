// POST /api/pult/comments – új megjegyzés vagy válasz.
// {work_id, version_id, parent_id?, file_key?, page?, x?, y?, action: change|add|remove, body, attachment?}
import { Env, json, bad, clean } from "../../../../lib/core";
import { requireUser, workFor } from "../../../../lib/portal";
import { addComment } from "../../../../lib/works";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const w = await workFor(env, u, clean(b.work_id, 40));
  if (!w || w.status === "draft") return bad("Nincs ilyen munka.", 404);
  const v = await env.DB.prepare("SELECT id,status,files FROM versions WHERE id=?1 AND work_id=?2").bind(clean(b.version_id, 40), w.id).first<{ id: string; status: string; files: string }>();
  if (!v) return bad("Nincs ilyen verzió.", 404);
  const body = clean(b.body, 4000);
  if (!body) return bad(u.lang === "en" ? "Write what you'd like." : "Írd le, mit szeretnél.");
  // napi méltányos használat: 60 megjegyzés ügyfelenként
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM comments c JOIN works w ON w.id=c.work_id WHERE w.customer_id=?1 AND c.created_at > ?2").bind(u.customer_id, new Date(Date.now() - 864e5).toISOString()).first<{ n: number }>();
  if ((n?.n || 0) >= 60) return bad("Mára elérted a megjegyzések korlátját; holnap folytathatod.", 429);

  const files = JSON.parse(v.files || "[]") as { key: string }[];
  const fileKey = clean(b.file_key, 300);
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null);
  let parent: string | null = null;
  if (b.parent_id) {
    const p = await env.DB.prepare("SELECT id FROM comments WHERE id=?1 AND work_id=?2 AND parent_id IS NULL").bind(clean(b.parent_id, 40), w.id).first<{ id: string }>();
    if (!p) return bad("Nincs ilyen megjegyzés.", 404);
    parent = p.id;
  }
  let att: unknown = null;
  if (b.attachment && typeof b.attachment === "object") {
    const a = b.attachment as Record<string, unknown>;
    const key = clean(a.key, 300), url = clean(a.url, 500);
    if (key && key.startsWith(`pult/${u.customer_id}/att/`)) att = { key, name: clean(a.name, 120), type: clean(a.type, 100), size: Number(a.size) || 0 };
    else if (/^https?:\/\//i.test(url)) att = { url };
  }
  const action = clean(b.action, 10);
  const id = await addComment(env, {
    work: w, version_id: v.id, parent_id: parent, author_kind: "customer", user_id: u.id,
    file_key: fileKey && files.some((f) => f.key === fileKey) ? fileKey : null,
    page: num(b.page, 1, 999), x: num(b.x, 0, 1), y: num(b.y, 0, 1),
    action: parent ? null : (["change", "add", "remove"].includes(action) ? action : "change"), body, attachment: att,
  });
  return json({ ok: true, id });
};
