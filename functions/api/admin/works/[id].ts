// GET /api/admin/works/:id – munka verziókkal és megjegyzésekkel.
// POST /api/admin/works/:id
//   {action:"version", files:[{key,name,type,size,label?}], preview_url?, note?, notify?:true}  – új verzió (az előző "superseded")
//     weboldalnál (kind "web") elég a preview_url (https), a fájl nem kötelező
//   {action:"reply", parent_id, body}                                            – Webbridge-válasz egy megjegyzésre
//   {action:"comment_status", comment_id, status: open|doing|done}
//   {action:"status", status: draft|review|changes|approved}
//   {action:"invite_owner"}                                                       – Pult-belépő a fiók gazdájának
import { Env, json, bad, clean, nowIso, rid, logEvent } from "../../../../lib/core";
import { sendMail, layout } from "../../../../lib/mail";
import { ensureOwner, loginLink } from "../../../../lib/portal";
import { workDetail, addComment, notifyNewVersion, Work } from "../../../../lib/works";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const w = await env.DB.prepare("SELECT * FROM works WHERE id=?1").bind(String(params.id)).first<Work>();
  if (!w) return bad("Nincs ilyen munka.", 404);
  return json({ ok: true, work: w, ...(await workDetail(env, w.id)) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const w = await env.DB.prepare("SELECT * FROM works WHERE id=?1").bind(String(params.id)).first<Work>();
  if (!w) return bad("Nincs ilyen munka.", 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = clean(b.action, 20), t = nowIso();

  if (action === "version") {
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 30).map((f) => {
      const o = (f || {}) as Record<string, unknown>;
      return { key: clean(o.key, 300), name: clean(o.name, 120), type: clean(o.type, 100), size: Number(o.size) || 0, label: clean(o.label, 80) || undefined };
    }).filter((f) => f.key.startsWith(`pult/${w.customer_id}/works/${w.id}/`));
    let preview: string | null = null;
    const pu = clean(b.preview_url, 500);
    if (pu) {
      if (w.kind !== "web") return bad("Előnézeti URL csak weboldalnál adható meg.");
      try { const u = new URL(pu); if (u.protocol !== "https:" || u.username || u.password) throw 0; preview = u.toString(); } catch { return bad("Az előnézeti URL legyen érvényes https:// cím."); }
    }
    if (!files.length && !preview) return bad(w.kind === "web" ? "Adj meg előnézeti URL-t vagy tölts fel fájlt." : "Legalább egy fájl kell.");
    const last = await env.DB.prepare("SELECT MAX(n) n FROM versions WHERE work_id=?1").bind(w.id).first<{ n: number | null }>();
    const n = (last?.n || 0) + 1, id = rid("ver_"), note = clean(b.note, 2000) || null;
    await env.DB.batch([
      env.DB.prepare("UPDATE versions SET status='superseded' WHERE work_id=?1 AND status IN ('review','changes')").bind(w.id),
      env.DB.prepare("INSERT INTO versions (id,work_id,n,note,files,preview_url,status,created_at) VALUES (?1,?2,?3,?4,?5,?6,'review',?7)").bind(id, w.id, n, note, JSON.stringify(files), preview, t),
      env.DB.prepare("UPDATE works SET status='review', updated_at=?1 WHERE id=?2").bind(t, w.id),
    ]);
    await logEvent(env, { customer_id: w.customer_id, project_id: w.project_id, kind: "note", actor: "zsolt", title: `Pult: ${w.title} v${n} feltöltve (${preview ? "előnézet" + (files.length ? ` + ${files.length} fájl` : "") : `${files.length} fájl`})`, body: note || undefined });
    const mail = b.notify === false ? { ok: true, skipped: true } : await notifyNewVersion(env, w, { id, n, note });
    return json({ ok: true, id, n, mail });
  }
  if (action === "reply") {
    const body = clean(b.body, 4000), parent = clean(b.parent_id, 40);
    const p = await env.DB.prepare("SELECT id,version_id FROM comments WHERE id=?1 AND work_id=?2").bind(parent, w.id).first<{ id: string; version_id: string }>();
    if (!p || !body) return bad("Hiányzó adat.");
    const id = await addComment(env, { work: w, version_id: p.version_id, parent_id: p.id, author_kind: "staff", author_name: "Webbridge", body });
    return json({ ok: true, id });
  }
  if (action === "comment_status") {
    const st = clean(b.status, 10);
    if (!["open", "doing", "done"].includes(st)) return bad("Ismeretlen állapot.");
    await env.DB.prepare("UPDATE comments SET status=?1, updated_at=?2 WHERE id=?3 AND work_id=?4").bind(st, t, clean(b.comment_id, 40), w.id).run();
    return json({ ok: true });
  }
  if (action === "status") {
    const st = clean(b.status, 10);
    if (!["draft", "review", "changes", "approved"].includes(st)) return bad("Ismeretlen állapot.");
    await env.DB.prepare("UPDATE works SET status=?1, updated_at=?2 WHERE id=?3").bind(st, t, w.id).run();
    return json({ ok: true });
  }
  if (action === "invite_owner") {
    const owner = await ensureOwner(env, w.customer_id);
    if (!owner) return bad("Az ügyfélnek nincs e-mail-címe.");
    const hu = owner.lang !== "en";
    const link = await loginLink(env, owner, 60 * 24 * 7);
    const r = await sendMail(env, { to: owner.email, template: "pult_login", customer_id: w.customer_id, subject: hu ? "Belépés a Webbridge Pultba" : "Your Webbridge Desk",
      html: layout(hu ? "hu" : "en", hu ? "A Pultod készen áll" : "Your Desk is ready", hu ? "<p>Itt látod és véleményezed az anyagaidat. A link 7 napig érvényes; később e-mailes linkkel vagy Google-fiókkal léphetsz be.</p>" : "<p>This is where you see and review your materials. The link is valid for 7 days; later you can sign in with an email link or Google.</p>", { label: hu ? "Belépés" : "Sign in", url: link }) });
    return json({ ok: r.ok, error: r.error });
  }
  return bad("Ismeretlen művelet.");
};
