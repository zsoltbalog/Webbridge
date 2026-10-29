// GET /api/admin/works?customer_id=… – egy ügyfél Pult-munkái.
// POST /api/admin/works {customer_id, project_id?, kind, title} – új munka (még piszkozat, amíg nincs verziója).
import { Env, json, bad, clean, nowIso, rid, logEvent } from "../../../../lib/core";
import { sendMail, layout } from "../../../../lib/mail";
import { ensureOwner, loginLink } from "../../../../lib/portal";

const KINDS = ["logo", "brand", "flyer", "design", "web", "doc", "posts", "other"];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cid = new URL(request.url).searchParams.get("customer_id") || "";
  const works = (await env.DB.prepare(
    `SELECT w.*, (SELECT MAX(n) FROM versions v WHERE v.work_id=w.id) AS last_n,
      (SELECT COUNT(*) FROM comments c WHERE c.work_id=w.id AND c.parent_id IS NULL AND c.author_kind<>'staff' AND c.status IN ('open','doing')) AS open_comments
     FROM works w WHERE w.customer_id=?1 ORDER BY w.updated_at DESC`).bind(cid).all()).results;
  const users = (await env.DB.prepare("SELECT id,email,name,role,last_login,disabled FROM portal_users WHERE customer_id=?1 ORDER BY role='owner' DESC, created_at").bind(cid).all()).results;
  return json({ ok: true, works, users });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.action === "invite_owner") {
    const owner = await ensureOwner(env, clean(b.customer_id, 40));
    if (!owner) return bad("Az ügyfélnek nincs e-mail-címe.");
    const hu = owner.lang !== "en";
    const link = await loginLink(env, owner, 60 * 24 * 7);
    const r = await sendMail(env, { to: owner.email, template: "pult_login", customer_id: owner.customer_id, subject: hu ? "A Webbridge Pultod" : "Your Webbridge Desk",
      html: layout(hu ? "hu" : "en", hu ? "A Pultod készen áll" : "Your Desk is ready", hu ? "<p>Itt látod és véleményezed az anyagaidat, itt hagyod jóvá őket, és itt hívhatod meg a kollégádat is. A link 7 napig érvényes; később e-mailes linkkel vagy Google-fiókkal léphetsz be.</p>" : "<p>This is where you see, review and approve your materials, and invite a colleague. The link is valid for 7 days; later you can sign in with an email link or Google.</p>", { label: hu ? "Belépés" : "Sign in", url: link }) });
    return json({ ok: r.ok, error: r.error });
  }
  const cid = clean(b.customer_id, 40), title = clean(b.title, 150), kind = clean(b.kind, 10);
  if (!cid || !title) return bad("Ügyfél és cím kell.");
  const c = await env.DB.prepare("SELECT id FROM customers WHERE id=?1").bind(cid).first();
  if (!c) return bad("Nincs ilyen ügyfél.", 404);
  const pid = clean(b.project_id, 40) || null;
  const id = rid("wrk_"), t = nowIso();
  await env.DB.prepare("INSERT INTO works (id,customer_id,project_id,kind,title,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'draft',?6,?6)")
    .bind(id, cid, pid, KINDS.includes(kind) ? kind : "design", title, t).run();
  await logEvent(env, { customer_id: cid, project_id: pid, kind: "note", actor: "zsolt", title: `Pult-munka létrehozva: ${title}` });
  return json({ ok: true, id });
};
