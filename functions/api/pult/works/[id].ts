// GET /api/pult/works/:id – egy munka verziói és megjegyzései.
// POST /api/pult/works/:id {action:"approve", version_id, chosen?} | {action:"feedback", version_id}
import { Env, json, bad, clean } from "../../../../lib/core";
import { requireUser, workFor } from "../../../../lib/portal";
import { workDetail, approveVersion, feedbackSubmitted } from "../../../../lib/works";

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
  return bad("Ismeretlen művelet.");
};
