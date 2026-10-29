// GET /api/pult/works/:id – egy munka verziói és megjegyzései.
// POST /api/pult/works/:id {action:"approve", version_id, chosen?} | {action:"feedback", version_id}
//   | {action:"post", version_id, post_id, decision: ok|change|skip|clear}  – posztonkénti döntés (gazda és véleményező is)
import { Env, json, bad, clean } from "../../../../lib/core";
import { requireUser, workFor } from "../../../../lib/portal";
import { workDetail, approveVersion, feedbackSubmitted, versionPosts, setPostDecision, POST_ID_RE } from "../../../../lib/works";

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const w = await workFor(env, u, String(params.id));
  if (!w || w.status === "draft") return bad("Nincs ilyen munka.", 404);
  return json({ ok: true, work: w, ...(await workDetail(env, w.id)), me: { id: u.id, role: u.role } });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const u = await requireUser(env, request);
  if (u instanceof Response) return u;
  const w = await workFor(env, u, String(params.id));
  if (!w || w.status === "draft") return bad("Nincs ilyen munka.", 404);
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return bad("Érvénytelen kérés."); }
  const action = clean(b.action, 20), vid = clean(b.version_id, 40);
  if (action === "approve") {
    if (u.role !== "owner") return bad(u.lang === "en" ? "Only the account owner can approve." : "Jóváhagyni csak a fiók gazdája tud.", 403);
    const r = await approveVersion(env, w, vid, u, "pult", clean(b.chosen, 300) || null);
    return r.ok ? json(r) : bad(r.error || "Hiba");
  }
  if (action === "feedback") {
    const r = await feedbackSubmitted(env, w, vid, u);
    return r.ok ? json(r) : bad(r.error || "Hiba");
  }
  if (action === "post") {
    if (w.kind !== "posts") return bad("Ismeretlen művelet.");
    const v = await env.DB.prepare("SELECT id,status,files FROM versions WHERE id=?1 AND work_id=?2").bind(vid, w.id).first<{ id: string; status: string; files: string }>();
    if (!v) return bad("Nincs ilyen verzió.", 404);
    if (v.status !== "review" && v.status !== "changes") return bad(u.lang === "en" ? "This version can no longer be changed." : "Ez a verzió már nem módosítható.");
    const pid = typeof b.post_id === "string" ? b.post_id : "";
    const dec = clean(b.decision, 10);
    if (!POST_ID_RE.test(pid) || !["ok", "change", "skip", "clear"].includes(dec)) return bad("Érvénytelen kérés.");
    const posts = await versionPosts(env, v.files);
    if (!posts || !posts.some((p) => p.id === pid)) return bad("Nincs ilyen poszt.", 404);
    if (dec === "clear") await env.DB.prepare("DELETE FROM post_decisions WHERE version_id=?1 AND post_id=?2").bind(v.id, pid).run();
    else await setPostDecision(env, w.id, v.id, pid, dec, u.id);
    return json({ ok: true });
  }
  return bad("Ismeretlen művelet.");
};
